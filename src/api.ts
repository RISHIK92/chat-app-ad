export const BASE_URL = 'http://10.7.1.89:3000';

export type User = { id: string; name: string; bio?: string | null };
export type Conversation = {
  id: string;
  name?: string | null;
  type: 'DM' | 'GROUP';
  createdAt: string;
  createdBy: string;
  participants_ids: string[];
};
export type FileInfo = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'IMAGE' | 'FILE';
  uploadedBy: string;
  createdAt: string;
  downloadUrl: string;
};
export type Message = {
  id: string;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  fileId?: string | null;
  file?: FileInfo | null;
  createdAt: string;
  senderId: string;
  conversationId: string;
  status: Record<string, { delivered: boolean; read: boolean }>;
};
export type MessagesPage = { data: Message[]; nextCursor?: string | null; count: number };

let authHeader = '';

export function setCredentials(username: string, password: string) {
  // The backend expects the raw "username:password", not base64.
  authHeader = `Basic ${username}:${password}`;
}

// Long strings (e.g. base64 file data) are cut so logs stay readable. Never log the Authorization header.
const trim = (_key: string, value: unknown) =>
  typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…(${value.length} chars)` : value;
const preview = (value: unknown) => (value === undefined ? '' : JSON.stringify(value, trim));

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const started = Date.now();
  if (__DEV__) console.log(`[api] → ${method} ${path}`, init.body ? preview(JSON.parse(init.body as string)) : '');

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...init.headers },
    });
  } catch (e: any) {
    if (__DEV__) console.log(`[api] ✗ ${method} ${path} network error after ${Date.now() - started}ms:`, e.message);
    throw e;
  }

  const body = await res.json().catch(() => null);
  if (__DEV__) {
    console.log(`[api] ${res.ok ? '←' : '✗'} ${res.status} ${method} ${path} (${Date.now() - started}ms)`, preview(body));
  }
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export const getProfile = () => request<User>('/user/profile');
export const getUsers = () => request<User[]>('/user');
export const getConversations = () => request<Conversation[]>('/conversation');
export const createConversation = (participants_ids: string[], name?: string) =>
  request<Conversation>('/conversation', {
    method: 'POST',
    body: JSON.stringify({ type: participants_ids.length > 1 ? 'GROUP' : 'DM', participants_ids, name }),
  });
export const getMessages = (conversationId: string, cursor?: string | null) =>
  request<MessagesPage>(
    `/message?conversation_id=${conversationId}${cursor ? `&from_message_cursor=${cursor}` : ''}`,
  );
export type FileWithData = FileInfo & { data: string };
export const getFile = (id: string) => request<FileWithData>(`/file/${id}`);
export const uploadFile = (file_name: string, mime_type: string, base64: string) =>
  request<FileInfo>('/file', {
    method: 'POST',
    body: JSON.stringify({ file_name, mime_type, data: base64 }),
  });
/** `content` is the caption when `fileId` is given. */
export const sendMessage = (conversationId: string, content?: string, fileId?: string) =>
  request<Message>('/message', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, content: content || undefined, file_id: fileId }),
  });
