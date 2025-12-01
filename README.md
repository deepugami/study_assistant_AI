## Study Assistant

A local-first app to upload notes (PDF/DOCX/TXT), chat with them (RAG), and generate tests (MCQ/Short/Long).

Features:
- Chat grounded on your uploaded notes (RAG)
- Generate tests (MCQ/Short/Long) with local fallbacks
- Interview (voice): browser ASR + TTS with resume-grounded questions

### Prerequisites

- Node.js 22 LTS recommended. `better-sqlite3` is a native module.
  - Windows: consider nvm-windows (https://github.com/coreybutler/nvm-windows)
- SQLite database files are created locally in the project folder by default.

### Environment

Create `.env` (or `.env.local`) and set:

- `API_KEY` — Google Generative AI API key (enables chat/test generation). Optional; tests/chat have fallbacks.
- `SESSION_SECRET` — any long random string (sessions). Optional.
- `SQLITE_PATH` — optional custom path to `data.sqlite`.
- `AI_TEXT_MODEL` — optional text model override (default from server code)
- `AI_EMBED_MODEL` — optional embedding model override (default `text-embedding-004`)

### Run (dev)

```bash
npm install
npm run dev
```

Open http://localhost:3000

Browser notes:
- Voice interview uses the Web Speech API. Chrome is recommended for the most reliable ASR/TTS implementation.

### How to use

1) Go to Dashboard and upload 1–3 files (PDF/DOCX/TXT). Wait for processing to finish.
2) Use the Dashboard buttons to navigate:
   - Chat — ask grounded questions about your notes.
   - Test — MCQ/Short/Long modes to generate and answer questions.
   - If no file is uploaded, navigation is blocked and a toast appears on the Dashboard.
3) After a full page refresh, the session clears the active docs for safety. Upload again to start a new session.

Notes:
- With an API key, the app uses Gemini for generation; without it, tests fall back locally and chat provides a conservative fallback.
- Data stays local in SQLite; uploads are parsed on your machine.
 - Voice interview: click the recorder, speak, then wait for the interviewer’s reply by voice. If ASR is unsupported, try Chrome.

### Scripts

- `npm run dev` — start Next.js dev server
- `npm run build` — production build
- `npm start` — start production server

### Tech

- Next.js 15 (App Router, TypeScript), React 19, Tailwind v4
- SQLite via better-sqlite3
- `iron-session` for sessions (public mode by default)
- Google Generative AI (Gemini) for text/JSON + embeddings (with local fallbacks)

### Diagnostics

- Check AI configuration and connectivity at: `GET /api/diag/ai` (open `/api/diag/ai` in the browser). It reports text/embedding model status and lists available models when possible.
