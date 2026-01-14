## Study Assistant — Technical Report

This report lists only the technical design: what is used and how it is used. It also includes the latest updates to features and APIs.

---

## Stack

- Next.js 15 (App Router, TypeScript), React 19, Tailwind v4
- SQLite via `better-sqlite3` (WAL mode) for all persistence
- Sessions via `iron-session` (HTTP‑only, signed cookie)
- AI via `@google/generative-ai` (text + embeddings) with local embedding fallback
- Parsing: `pdf-parse` (PDF), `mammoth` (DOCX), TXT native
- Validation: `zod` (server request payloads)

---

## Stack: How & Why (Deep Dive)

- Next.js 15 (App Router)
  - How: Pages and API routes live under `src/app/*`. Handlers use the Next.js `Request`/`NextResponse` API. Routes that need Node features declare `export const runtime = "nodejs"` to enable file parsing (PDF/DOCX) and reliable SDK networking.
  - Why: Co-locating UI and server eliminates a separate backend. App Router yields cleaner server/client boundaries and reduces boilerplate.

- React 19
  - How: Client components with hooks (`useState`, `useEffect`, `useRef`) power chat, test, and voice UIs. Server Components provide static shells via App Router.
  - Why: Mature ecosystem and predictable state model; integrates well with Next for SSR and future streaming.

- Tailwind v4
  - How: Utility classes across components; minimal custom CSS. Motion via CSS animations or small Framer Motion helpers for backgrounds.
  - Why: Rapid iteration and consistent design without heavy CSS architecture.

- SQLite + `better-sqlite3`
  - How: Synchronous prepared statements in `src/server/db.ts`. Embeddings stored as JSON arrays. Tables: `documents`, `chunks`, `tests`, `test_questions`, `test_submissions`, `test_answers`, `chats`, `messages`.
  - Why: Zero-ops, great single-user performance, and simple persistence. JSON embeddings keep schema portable until a vector DB/extension is warranted.

- `iron-session`
  - How: Stores `userId` and transient scopes (`currentDocIds`, `currentInterviewChatId`) in a signed, HTTP-only cookie. Helpers in `src/server/session.ts`.
  - Why: Stateless, secure sessions without DB tables; simpler than NextAuth for this app.

- Google Generative AI SDK
  - How: `generateTextSmart()` uses a text model (env-configurable); `embedText()` uses `text-embedding-004`. If `API_KEY` is absent, text calls error while embeddings fall back locally.
  - Why: Unified SDK for text and embeddings; easy model overrides via env.

- Local Embedding Fallback
  - How: Character hashing into 256 buckets → counts → L2 normalization; cosine similarity at query time. Deterministic and fast.
  - Why: Ensures ingestion/search function offline; avoids hard dependency on a remote embedding model.

- Parsing (`pdf-parse`, `mammoth`)
  - How: Executed under Node runtime routes. PDFs via `pdf-parse`; DOCX via `mammoth.extractRawText`; TXT via UTF-8 decode.
  - Why: Reliable extraction with minimal dependencies and good cross-platform behavior.

- Validation (`zod`)
  - How: Parse/validate JSON bodies; return 400 on failure.
  - Why: Strong contracts at route boundaries reduce bugs and undefined states.

---

## Recent Technical Updates

- Voice Interview feature (client + server):
  - Client (`src/app/interview/page.tsx`): Web Speech API ASR (continuous + interim), Web Speech TTS, Web Audio API VAD (AnalyserNode energy threshold), auto turn‑taking and recognition auto‑restart, integrated with a tap‑to‑record UI (`PulseVoiceRecorder`).
  - Server (`src/app/api/interview/route.ts`): maintains an interview chat in `chats/messages`, grounds questions on uploaded resume chunks, uses `embedText` + cosine similarity for retrieval and `generateTextSmart` for responses; resets interview session on GET.
- Diagnostics endpoint (`GET /api/diag/ai`): probes configured Gemini text/embedding models and lists available models; useful for environment checks.
- Session freshness: full page reload clears active document scope; navigation between pages preserves scope (`SessionFreshReset`).
- Dashboard gating: Chat/Test routes are gated by `active-docs`; actions blocked until a file is uploaded.
- Test fallbacks: local MCQ generator added; Short/Long fallbacks retained.
- Background overlay: full‑viewport fix in `BackgroundPaths.tsx` used by Chat/Test pages.
- Basic CI: added GitHub Actions workflow (`.github/workflows/ci.yml`) to run lint and build on push/PR.
- Initial tests: added Vitest with unit tests for `chunkText`, similarity ordering via `topKSimilar`, and `POST /api/test` input validation; configured Vitest to avoid PostCSS plugin loading during tests.

---

## Architecture

Flows: Upload → Ingest/Chunk → Embed → Store → Retrieve → Prompt → Render.

- Upload (`POST /api/upload`):
  - Extract text (PDF/DOCX/TXT), chunk with word window + overlap, embed via Gemini or local fallback, persist in SQLite tables `documents` and `chunks`.
- Chat (`POST /api/chat`):
  - Embed query, cosine rank top‑K chunks, build grounded prompt, generate with Gemini, return `{ answer, sources }`.
- Test (`/api/test`, `/api/test-questions`):
  - Generate/Store questions as JSON; submit and score (MCQ/Short auto, Long placeholder).
- Interview (`GET/POST /api/interview`):
  - GET resets/creates session chat; POST persists user message, retrieves resume‑grounded context from `chunks` filtered by `session.currentDocIds`, generates interviewer reply, stores in `messages`.

Data model (in `src/server/db.ts`):
- `users`, `documents`, `chunks(content TEXT, embedding TEXT JSON)`, `tests`, `test_questions`, `test_submissions`, `test_answers`, `chats`, `messages` (used by Interview).

---

## Client Implementation Highlights
 
## RAG: How & Why

- Chunking
  - How: Word-window (~800 words) with ~150 overlap at upload time.
  - Why: Tokenizer-agnostic and simple; overlap preserves context across boundaries.

- Embeddings
  - How: Prefer Gemini embeddings; fallback to local hash vectors (256 dims, L2-normalized) when no API key.
  - Why: Maintain functionality offline and avoid hard failures during ingestion/search.

- Retrieval
  - How: Restrict to `session.currentDocIds` scope; compute cosine similarity; sort; top K≈8–10 for prompts.
  - Why: Balances grounding breadth with latency/prompt size.

- Prompting
  - How: Strict context-use instruction with abstain-on-insufficient-context clause; interview adds role/style.
  - Why: Reduces hallucinations and keeps responses concise and relevant.

- Fallbacks
  - How: If generation fails, tests and interview return controlled, context-based fallbacks.
  - Why: Preserve UX continuity under failures.

- Interview page (`src/app/interview/page.tsx`):
  - ASR: `window.SpeechRecognition || webkitSpeechRecognition`, `continuous=true`, `interimResults=true`, auto‑restart on `onend`/`onerror` while listening.
  - Debounce silence: inactivity timeout finalizes and stops recognition; pending transcript is POSTed.
  - TTS: `speechSynthesis` with `SpeechSynthesisUtterance`; on `onend`, schedules VAD start for next turn.
  - VAD: `AudioContext` + `AnalyserNode.getByteFrequencyData` to estimate energy; threshold triggers `startListening()`; loop via `requestAnimationFrame`.
  - UI: `PulseVoiceRecorder` exposes `onStart/onStop`; visual pulse and timer only on client.

- Chat/Test UI: standard React state + fetch POST/GET; Tailwind for styling; optional Framer Motion backgrounds.

---

## Server Implementation Highlights

- AI adapter (`src/server/ai.ts`):
  - `embedText(text)`: Gemini `text-embedding-004`; local 256‑dim hash‑bucket fallback, L2‑normalized.
  - `generateTextSmart(prompt, { deep? })`: Gemini text model (configurable via env), basic retries; used in chat/test/interview.

- Interview API (`src/app/api/interview/route.ts`):
  - GET: resets prior interview chat (deletes `messages`/`chats`), seeds a system prompt, stores new chatId in `session.currentInterviewChatId`.
  - POST: Zod‑validated `{ message, deep? }`; persists user message; retrieves `chunks` for active document IDs; scores by cosine; builds interviewer prompt; generates reply; persists assistant message; returns `{ answer, sources }` with graceful fallback text on model errors.

- Diagnostics API (`src/app/api/diag/ai/route.ts`):
  - GET: verifies API key, pings text + embed models, returns status and preview; optionally lists models via Google endpoint.

---

## Voice Interview: How & Why

- ASR
  - How: Web Speech API (`SpeechRecognition/webkitSpeechRecognition`) with `continuous` and `interimResults`. Auto-restart on `onend`/`onerror` if listening remains intended.
  - Why: Zero external cost and low latency (best in Chrome) fits local-first goals.

- Turn Taking
  - How: Debounced silence (~2s) finalizes user speech and stops listening; after TTS `onend`, a VAD loop begins to await user speech before starting recognition again.
  - Why: Avoids TTS/ASR overlap and yields a natural conversation rhythm.

- VAD
  - How: `AudioContext` + `AnalyserNode.getByteFrequencyData` implement simple energy thresholding with minimum speech frames; loop via `requestAnimationFrame`.
  - Why: Lightweight, dependency-free approach sufficient for speech start detection.

- Server Lifecycle
  - How: `GET /api/interview` resets previous interview chat, seeds system persona, and stores `currentInterviewChatId`. `POST` persists user text, retrieves resume-scoped context from `chunks`, generates interviewer reply, persists it, and returns `{ answer, sources }`.
  - Why: Deterministic sessions and resume grounding ensure relevance and predictability.

---

## API Summary

- Auth: `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Upload & RAG: `POST /api/upload`, `POST /api/chat`
- Test: `POST /api/test`, `GET /api/test-questions`, `PUT /api/test`
- State: `GET/DELETE /api/state/active-docs`
- Interview: `GET/POST /api/interview`
- Diagnostics: `GET /api/diag/ai`

All endpoints return JSON; request bodies validated with `zod` where applicable. Routes requiring Node features declare `export const runtime = "nodejs"`.

---

## Testing & CI: How & Why

- Unit tests (Vitest)
  - How: Configured via `vitest.config.ts` with Node environment and `@` alias to `src`. Disabled PostCSS in tests to avoid plugin resolution (Tailwind v4) during Node-only runs.
  - What: `chunkText` overlap/windowing; similarity ordering through `topKSimilar`; `POST /api/test` input validation. For API validation, mocks replace `@/server/session` (public user), `@/server/db` (noop), and `@/server/ai` to avoid network calls.
  - Why: Fast checks on core correctness without booting Next.js; avoids flakiness and keeps scope minimal yet meaningful.

- Continuous Integration
  - How: `.github/workflows/ci.yml` runs on push/PR with Node 22 → `npm ci` → `npm run lint` → `npm run build`.
  - Why: Ensure code quality and build health for every change. Tests can be added as a step later if desired.

---

## Configuration

- `API_KEY`: Google Generative AI key (text + embeddings)
- `AI_TEXT_MODEL` / `AI_EMBED_MODEL` (optional overrides)
- `SESSION_SECRET`: secret for `iron-session`
- `SQLITE_PATH`: optional DB path (default `./data.sqlite`)
- Testing: Vitest is configured in `vitest.config.ts` (Node environment, alias `@` to `src`, PostCSS disabled for tests)

---

## Performance & Security Notes

- Retrieval: cosine over stored JSON embeddings; K≈8–10. Consider DB indexes on `documents.userId`, `chunks.documentId`.
- Chunking tuned for small corpora (≈800 words, 150 overlap).
- Sessions: HTTP‑only, `SameSite=Lax`, `secure` in production.
- Uploads allowed: PDF/DOCX/TXT only; parsed on Node runtime endpoints.

---

## Important Files

- `src/app/api/upload/route.ts` — ingestion (parse, chunk, embed, persist)
- `src/app/api/chat/route.ts` — RAG chat
- `src/app/api/interview/route.ts` — resume‑grounded interview
- `src/app/api/diag/ai/route.ts` — AI diagnostics
- `src/app/api/state/active-docs/route.ts` — active docs state
- `src/server/ai.ts`, `src/server/rag.ts`, `src/server/db.ts` — AI utils, chunking/similarity, DB
- `src/app/interview/page.tsx`, `src/components/PulseVoiceRecorder.tsx` — voice client
 - `vitest.config.ts` — Vitest config (Node env, `@` alias, PostCSS disabled for tests)
 - `tests/rag/chunkText.test.ts` — chunking window/overlap tests
 - `tests/rag/topKSimilar.test.ts` — cosine ranking order via `topKSimilar`
 - `tests/api/test.validation.test.ts` — `POST /api/test` Zod validation (mocks session/DB/AI)
 - `.github/workflows/ci.yml` — CI workflow to run lint and build on push/PR

---

This technical report reflects the current implementation and recent voice interview updates, focusing strictly on components, APIs, configuration, and runtime behavior.



