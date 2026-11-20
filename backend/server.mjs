import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB for base64 media payloads
const DEFAULT_PAGE_SIZE = 30;

fs.mkdirSync(FILES_DIR, { recursive: true });

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], conversations: [], messages: [], files: [] };
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
    };
  } catch (err) {
    console.error('[backend] Failed to read db.json, starting fresh:', err.message);
    return { users: [], conversations: [], messages: [], files: [] };
  }
}

const db = loadDb();

function saveDb() {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function publicUser(u) {
  return { id: u.id, name: u.name, bio: u.bio ?? null };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, data) {
  setCors(res);
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large (max 20 MB)'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const raw = header.slice(6);
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const username = raw.slice(0, sep).trim();
  const password = raw.slice(sep + 1);
  if (!username || !password) return null;

  let user = db.users.find((u) => u.name.toLowerCase() === username.toLowerCase());
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      name: username,
      bio: 'Hey there! I am using Chat.',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDb();
    return user;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return 'INVALID_PASSWORD';
  }
  return user;
}

function inferKind(mimeType = '') {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith('image/')) return 'IMAGE';
  if (lower.startsWith('audio/')) return 'AUDIO';
  return 'FILE';
}

function attachFile(msg) {
  if (!msg.fileId) return msg;
  const file = db.files.find((f) => f.id === msg.fileId) || null;
  return { ...msg, file };
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, users: db.users.length, conversations: db.conversations.length });
  }

  const authResult = authenticate(req);
  if (authResult === null) {
    return sendJson(res, 401, { message: 'Missing or invalid Authorization header' });
  }
  if (authResult === 'INVALID_PASSWORD') {
    return sendJson(res, 401, { message: 'Incorrect password for this username' });
  }
  const me = authResult;

  try {
    // GET /user/profile
    if (req.method === 'GET' && pathname === '/user/profile') {
      return sendJson(res, 200, publicUser(me));
    }

    // PATCH /user/profile
    if (req.method === 'PATCH' && pathname === '/user/profile') {
      const body = await readJsonBody(req);
      if (typeof body.bio === 'string') me.bio = body.bio.trim().slice(0, 160);
      saveDb();
      return sendJson(res, 200, publicUser(me));
    }

    // GET /user?q=...
    if (req.method === 'GET' && pathname === '/user') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let list = db.users;
      if (q) {
        list = list.filter(
          (u) =>
            u.name.toLowerCase().includes(q) ||
            (u.bio && u.bio.toLowerCase().includes(q)),
        );
      }
      return sendJson(res, 200, list.map(publicUser));
    }

    // GET /conversation
    if (req.method === 'GET' && pathname === '/conversation') {
      const mine = db.conversations
        .filter((c) => c.participants_ids.includes(me.id))
        .map((c) => {
          const lastMsg = db.messages
            .filter((m) => m.conversationId === c.id)
            .at(-1);
          return { convo: c, sortKey: lastMsg ? lastMsg.createdAt : c.createdAt };
        })
        .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
        .map((x) => x.convo);
      return sendJson(res, 200, mine);
    }

    // POST /conversation
    if (req.method === 'POST' && pathname === '/conversation') {
      const body = await readJsonBody(req);
      const incoming = Array.isArray(body.participants_ids) ? body.participants_ids.filter(Boolean) : [];
      const participants = Array.from(new Set([me.id, ...incoming]));
      if (participants.length < 2) {
        return sendJson(res, 400, { message: 'At least one other participant is required' });
      }
      const type = body.type === 'GROUP' || participants.length > 2 ? 'GROUP' : 'DM';

      // Reuse existing DM between the same two users
      if (type === 'DM') {
        const existing = db.conversations.find(
          (c) =>
            c.type === 'DM' &&
            c.participants_ids.length === 2 &&
            participants.every((id) => c.participants_ids.includes(id)),
        );
        if (existing) return sendJson(res, 200, existing);
      }

      const convo = {
        id: crypto.randomUUID(),
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
        type,
        createdAt: new Date().toISOString(),
        createdBy: me.id,
        participants_ids: participants,
      };
      db.conversations.push(convo);
      saveDb();
      return sendJson(res, 201, convo);
    }

    // GET /message?conversation_id=...&from_message_cursor=...&limit=...
    if (req.method === 'GET' && pathname === '/message') {
      const conversationId = url.searchParams.get('conversation_id');
      if (!conversationId) {
        return sendJson(res, 400, { message: 'conversation_id is required' });
      }
      const convo = db.conversations.find((c) => c.id === conversationId);
      if (!convo || !convo.participants_ids.includes(me.id)) {
        return sendJson(res, 404, { message: 'Conversation not found' });
      }

      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_PAGE_SIZE, 1), 100);
      const cursor = url.searchParams.get('from_message_cursor');

      const all = db.messages.filter((m) => m.conversationId === conversationId);

      // Mark messages from other participants as delivered & read when fetched
      let dirty = false;
      for (const m of all) {
        if (m.senderId !== me.id) {
          if (!m.status) m.status = {};
          const cur = m.status[me.id];
          if (!cur || !cur.delivered || !cur.read) {
            m.status[me.id] = { delivered: true, read: true };
            dirty = true;
          }
        }
      }
      if (dirty) saveDb();

      let endIdx = all.length;
      if (cursor) {
        const cursorIdx = all.findIndex((m) => m.id === cursor);
        if (cursorIdx !== -1) endIdx = cursorIdx;
      }
      const startIdx = Math.max(0, endIdx - limit);
      const page = all.slice(startIdx, endIdx).map(attachFile);
      const nextCursor = startIdx > 0 ? page[0]?.id ?? null : null;

      return sendJson(res, 200, { data: page, nextCursor, count: page.length });
    }

    // POST /message
    if (req.method === 'POST' && pathname === '/message') {
      const body = await readJsonBody(req);
      const conversationId = body.conversation_id;
      const content = typeof body.content === 'string' ? body.content : '';
      const fileId = typeof body.file_id === 'string' ? body.file_id : null;
      const durationMs = typeof body.duration_ms === 'number' && Number.isFinite(body.duration_ms)
        ? Math.max(0, Math.round(body.duration_ms))
        : undefined;
      const waveform = Array.isArray(body.waveform)
        ? body.waveform.slice(0, 40).map((n) => Math.max(0.05, Math.min(1, Number(n) || 0.2)))
        : undefined;

      if (!conversationId) {
        return sendJson(res, 400, { message: 'conversation_id is required' });
      }
      const convo = db.conversations.find((c) => c.id === conversationId);
      if (!convo || !convo.participants_ids.includes(me.id)) {
        return sendJson(res, 404, { message: 'Conversation not found' });
      }
      if (!content.trim() && !fileId) {
        return sendJson(res, 400, { message: 'Either content or file_id is required' });
      }

      let type = 'TEXT';
      let file = null;
      if (fileId) {
        file = db.files.find((f) => f.id === fileId);
        if (!file) return sendJson(res, 404, { message: 'File not found' });
        type = file.kind; // 'IMAGE' | 'AUDIO' | 'FILE'
      }

      const status = {};
      for (const pid of convo.participants_ids) {
        status[pid] = pid === me.id
          ? { delivered: true, read: true }
          : { delivered: true, read: false };
      }

      const message = {
        id: crypto.randomUUID(),
        content,
        type,
        fileId,
        durationMs: durationMs ?? file?.durationMs ?? null,
        waveform: waveform ?? null,
        createdAt: new Date().toISOString(),
        senderId: me.id,
        conversationId,
        status,
      };
      db.messages.push(message);
      saveDb();
      return sendJson(res, 201, attachFile(message));
    }

    // POST /file
    if (req.method === 'POST' && pathname === '/file') {
      const body = await readJsonBody(req);
      const fileName = typeof body.file_name === 'string' && body.file_name.trim()
        ? body.file_name.trim()
        : `file-${Date.now()}`;
      const mimeType = typeof body.mime_type === 'string' && body.mime_type.trim()
        ? body.mime_type.trim()
        : 'application/octet-stream';
      const base64 = typeof body.data === 'string' ? body.data : '';
      const durationMs = typeof body.duration_ms === 'number' && Number.isFinite(body.duration_ms)
        ? Math.max(0, Math.round(body.duration_ms))
        : null;

      if (!base64) {
        return sendJson(res, 400, { message: 'Base64 file data is required' });
      }

      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 12 * 1024 * 1024) {
        return sendJson(res, 413, { message: 'File exceeds 12 MB limit' });
      }

      const id = crypto.randomUUID();
      fs.writeFileSync(path.join(FILES_DIR, id), buffer);

      const fileInfo = {
        id,
        name: fileName,
        mimeType,
        size: buffer.length,
        kind: inferKind(mimeType),
        durationMs,
        uploadedBy: me.id,
        createdAt: new Date().toISOString(),
        downloadUrl: `/file/${id}/raw`,
      };
      db.files.push(fileInfo);
      saveDb();
      return sendJson(res, 201, fileInfo);
    }

    // GET /file/:id/raw
    const rawMatch = pathname.match(/^\/file\/([^/]+)\/raw$/);
    if (req.method === 'GET' && rawMatch) {
      const fileInfo = db.files.find((f) => f.id === rawMatch[1]);
      if (!fileInfo) return sendJson(res, 404, { message: 'File not found' });
      const filePath = path.join(FILES_DIR, fileInfo.id);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { message: 'File data missing' });

      const stat = fs.statSync(filePath);
      const range = req.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? parseInt(match[1], 10) : 0;
        const end = match?.[2] ? parseInt(match[2], 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Type': fileInfo.mimeType,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': fileInfo.mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Length': stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // GET /file/:id
    const fileMatch = pathname.match(/^\/file\/([^/]+)$/);
    if (req.method === 'GET' && fileMatch) {
      const fileInfo = db.files.find((f) => f.id === fileMatch[1]);
      if (!fileInfo) return sendJson(res, 404, { message: 'File not found' });
      const filePath = path.join(FILES_DIR, fileInfo.id);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { message: 'File data missing' });
      const data = fs.readFileSync(filePath).toString('base64');
      return sendJson(res, 200, { ...fileInfo, data });
    }

    return sendJson(res, 404, { message: `Route not found: ${req.method} ${pathname}` });
  } catch (err) {
    const status = err?.status || 500;
    console.error(`[backend] Error on ${req.method} ${pathname}:`, err);
    return sendJson(res, status, { message: err?.message || 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[backend] Chat server listening on http://${HOST}:${PORT}`);
  console.log(`[backend] Data directory: ${DATA_DIR}`);
});
