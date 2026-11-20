# Chat App

A WhatsApp-inspired cross-platform mobile chat app built with **Expo (React Native)** and a self-contained **Node.js backend** — featuring voice messages with waveforms, camera photo capture, gallery uploads, and live contact search.

## Features

- **Custom Zero-Dependency Backend (`backend/server.mjs`)**: Pure Node.js HTTP server with persistent JSON + binary file storage (`backend/data/`), salted `scrypt` password hashing, DM deduplication, cursor-based message pagination, and delivery/read receipts.
- **Voice Messages (WhatsApp-style)**:
  - Dynamic **🎤 / ➤** action button — switches to microphone when the text box is empty.
  - Live recording bar with pulsing indicator, elapsed timer, real-time waveform bars, discard (`🗑`), and send (`➤`).
  - Interactive voice note bubbles with play/pause, tap-to-seek waveform bars, elapsed/total duration, and `1x` / `1.5x` / `2x` playback speed toggle.
- **Camera & Photo Sharing**:
  - Take photos directly from the chat bar (**📷**) or pick from your photo library (**📎**).
  - Automatic client-side resize & JPEG compression (`expo-image-manipulator`), preview with optional caption, and fullscreen image viewer on tap.
- **Contact & Chat Search**:
  - Search existing conversations and matching contacts directly from the Chats screen.
  - Live backend-powered contact search (`GET /user?q=...`) inside the **New Chat (`+`)** modal.
- **Auto-Registering Auth & Configurable Server URL**:
  - Enter any username and password to sign in (new usernames register automatically).
  - Auto-detects the local dev host or lets you set a custom backend URL right from the login screen.

## Project Structure

```text
├── App.tsx                   # Root auth & screen navigation state
├── app.json                  # Expo config & native permissions (camera, photos, mic)
├── backend/
│   └── server.mjs            # Self-contained Node.js REST & media server
└── src/
    ├── api.ts                # API client & automatic host URL resolution
    ├── Avatar.tsx            # Deterministic initial-based avatars
    ├── ChatListScreen.tsx    # Chat list, search bar, and contact picker modal
    ├── ChatScreen.tsx        # Chat view, camera/gallery capture, voice recorder
    ├── LoginScreen.tsx       # Login/auto-register screen + server URL toggle
    ├── VoiceMessage.tsx      # Voice note playback bubble & recording bar
    └── theme.ts              # WhatsApp-inspired color palette & time helpers
```

## Quick Start

### Prerequisites

- **Node.js 18+** (tested on Node 22)
- **Expo Go** (for quick testing) or a development build (`npx expo run:ios` / `npx expo run:android`) for full native audio & camera permissions

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Backend

```bash
npm run backend
```

The server listens on `http://0.0.0.0:3000` by default (override with `PORT=4000 npm run backend`). Data and uploaded media are persisted in `backend/data/`.

### 3. Start the Expo App

In a second terminal:

```bash
npx expo start
```

From the Expo CLI menu:
- Press `i` for iOS Simulator
- Press `a` for Android Emulator
- Press `w` for Web
- Scan the QR code with Expo Go on a physical device (make sure your phone is on the same Wi-Fi network; you can tap **Server: ...** on the login screen to point to your machine's LAN IP, e.g. `http://192.168.x.x:3000`, or set `EXPO_PUBLIC_API_URL`)

## Backend API Reference

All endpoints except `GET /health` expect `Authorization: Basic <username>:<password>`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Server health check and basic stats |
| `GET` | `/user/profile` | Get authenticated user profile (auto-registers new usernames) |
| `PATCH` | `/user/profile` | Update user bio (`{ bio }`) |
| `GET` | `/user?q=<query>` | List all users, optionally filtered by name or bio |
| `GET` | `/conversation` | List conversations for the current user, sorted by latest activity |
| `POST` | `/conversation` | Create or reuse a `DM` / create a `GROUP` conversation |
| `GET` | `/message?conversation_id=<id>&from_message_cursor=<cursor>` | Paginated messages (automatically marks incoming messages as delivered & read) |
| `POST` | `/message` | Send a `TEXT`, `IMAGE`, `AUDIO`, or `FILE` message (`duration_ms` & `waveform` supported for voice notes) |
| `POST` | `/file` | Upload a base64-encoded file (`file_name`, `mime_type`, `data`, optional `duration_ms`) |
| `GET` | `/file/:id` | Fetch file metadata + base64 payload |
| `GET` | `/file/:id/raw` | Stream raw binary file with `Content-Type` and HTTP `Range` support |

## Useful Commands

```bash
npm run backend    # Start the Node.js backend server on port 3000
npx expo start     # Start the Expo dev server
npx tsc --noEmit   # Typecheck TypeScript
```

## License

MIT — see [LICENSE](LICENSE).
