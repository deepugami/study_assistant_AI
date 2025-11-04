## Study Assistant — End‑to‑End Project Report (Frontend + RAG)

Written from the perspective of an engineering student who implemented the frontend and the Retrieval‑Augmented Generation (RAG) chat system, with a full understanding of the overall application.

---

## Executive summary

Study Assistant is a personal learning app where a student can upload study materials (PDF, DOCX, TXT) and then:
- Chat with an AI that answers strictly from their own notes (RAG).
- Auto‑generate practice tests (MCQ, Short, Long) sourced from those notes.

It’s built with Next.js 15 (App Router, TypeScript), React 19, Tailwind v4, and a lightweight local SQLite database (via better‑sqlite3). Authentication uses `iron-session`. For AI, it integrates Google Generative AI (Gemini) for text/JSON generation and embeddings, with an offline‑friendly local embedding fallback to keep ingestion and retrieval usable even without an API key.

Why this matters: it turns scattered notes into a searchable, testable knowledge base so learners can study faster and with more confidence.

---

## Recent changes (Nov 2025)

- Background animation: added a full‑screen animated background (`BackgroundPathsOverlay`) to Chat and Test pages; fixed overlay so it covers the entire viewport.
- Fresh session semantics: after a full browser refresh, previously uploaded “active docs” are cleared automatically (client component `SessionFreshReset` in `layout.tsx`). Regular navigation does not clear uploads.
- Dashboard‑first gating: the Dashboard’s action buttons (Chat, MCQ, SA, LA) now check whether a file is uploaded. If not, navigation is blocked and a toast appears on the Dashboard itself. Chat/Test pages don’t show upload toasts.
- Test generation reliability: added a local MCQ fallback generator (cloze‑style). Short/Long already had local fallbacks. With an API key, Test still uses Gemini; otherwise it falls back gracefully.
- No past uploads reuse: Chat/Test won’t auto‑use old uploads after reload; you must upload again each fresh session.

## Goals and problem statement

Problems I wanted to solve:
- Searching notes is slow and manual, especially near exams.
- Generic chatbots hallucinate and don’t respect my materials.
- Making practice tests is tedious and rarely aligned with what I actually studied.

Project goals:
- Centralize personal study materials in one place, locally.
- Ground all AI answers on my uploaded content (RAG) to reduce hallucinations.
- Generate targeted practice tests from the same materials.
- Keep setup minimal (no managed services required) and preserve privacy by default.

---

## System architecture (high‑level)

Key flows: Upload → Ingest → Chunk → Embed → Store → Retrieve → Prompt → Generate → Display.

ASCII overview:

```
[Client (Next.js/React)]
   ├── Upload files  ──────────────▶  POST /api/upload
   │                                 └─ parse (pdf-parse/mammoth/txt)
   │                                    chunk (word window + overlap)
   │                                    embed (Gemini or local fallback)
   │                                    persist (SQLite: documents + chunks)
   │
   ├── Chat message ───────────────▶  POST /api/chat
   │                                 └─ embed query
   │                                    cosine similarity over chunks
   │                                    construct grounded prompt
   │                                    generate answer (Gemini)
   │                                    return answer + source chunk IDs
   │
   └── Test lifecycle ─────────────▶  POST/GET/PUT /api/test + /api/test-questions
                                     └─ sample chunk text
                           generate JSON questions (Gemini; local fallback on failure)
                                        store questions
                                        submit + score

[SQLite (better-sqlite3)]
  ├─ users           ├─ documents
  ├─ chunks (text + embedding JSON)
  ├─ tests           ├─ test_questions
  ├─ test_submissions └─ test_answers

[Sessions: iron-session cookie]
  └─ active-docs (current upload scope) cleared on full reload
```

Why this design:
- Simple local dev: no external DB/vector service required.
- Embedding fallback keeps ingestion/search usable when offline.
- Next.js App Router co‑locates APIs and pages; easy to deploy as a single app.

---

## Technology stack and rationale

- Next.js 15 (App Router, TypeScript)
  - Why: modern file‑based routing for pages and API routes, middleware for auth gates, great DX with Turbopack.
- React 19
  - Why: latest React features and compatibility with Next 15; simple state for chat UI.
- Tailwind CSS v4, Framer Motion, `lucide-react`/`react-icons`
  - Why: build a modern, responsive UI quickly; pair with subtle motion to make study UX feel alive.
- `iron-session`
  - Why: stateless, signed, HTTP‑only cookie sessions; no DB session table required.
- SQLite + `better-sqlite3`
  - Why: zero‑config DB with strong local performance; WAL mode for durability; great for single‑user/student use case.
- `zod`
  - Why: input validation on server; reduce malformed payloads.
- AI via `@google/generative-ai`
  - Why: Gemini models offer fast text generation and an embeddings model. Unified client. Local fallback for embeddings guarantees minimal offline capability.
- Parsing via `pdf-parse` and `mammoth`
  - Why: robust text extraction from PDFs and DOCX; TXT handled natively.
- Utilities: `uuid`, `bcryptjs`, `cosine-similarity`, ESLint 9, TypeScript 5
  - Why: IDs, password hashing, ranking, and developer ergonomics.

Note: `langchain` packages are installed but not wired into the main flows; I kept the app lean with direct SDK usage for clarity and control.

---

## Data model (SQLite) and reasoning

Implemented in `src/server/db.ts`. Tables:
- users(id, email, passwordHash, createdAt)
- documents(id, userId, name, mime, createdAt)
- chunks(id, documentId, content, embedding)
  - embedding is stored as a JSON‑stringified number[]; trade‑off: simple to bootstrap, not as fast as a vector DB.
- tests, test_questions, test_submissions, test_answers
  - persistent record of generated tests and user submissions.
- chats, messages (reserved for future chat history)

Why SQLite:
- No ops overhead, good enough performance for thousands of chunks.
- The entire app remains self‑contained; great for students running locally.

---

## Authentication, authorization, and middleware

- `iron-session` stores `userId` in a signed, HTTP‑only cookie `study_assistant_session`.
- Current mode: public by default. If no session exists, the server assigns `userId = "public"` so the app works without login.
- Middleware (`src/middleware.ts`) is a no‑op at present; it does not guard routes.
- Security flags: `SameSite=Lax`, `secure` in production, `httpOnly`.

Why sessions (vs JWT): simplicity and fewer moving parts. Auth endpoints exist, but the app runs fine without logging in.

---

## RAG pipeline in depth (my core contribution)

1) Ingestion and chunking
- Uploads handled in `POST /api/upload` using `request.formData()` (no Multer needed in Next 15 runtime).
- Extraction:
  - PDF → `pdf-parse` (compat path `pdf-parse/lib/pdf-parse.js` to work across envs).
  - DOCX → `mammoth.extractRawText`.
  - TXT → direct `utf8` decode.
- Chunking (`chunkText`): word‑based sliding window with overlap to preserve context across boundaries. Defaults: size≈800 words, overlap≈150.

Why word‑based chunks: tokenizers vary; words are a stable proxy. Overlap keeps references intact when content bridges chunk edges.

2) Embeddings
- Primary: Gemini `text-embedding-004`.
- Fallback: `localEmbed` — deterministic character‑hash bucketing into a 256‑dimensional vector normalized to unit length. This keeps retrieval usable offline and avoids hard failure for uploads.

Trade‑offs: Local vectors are cruder than model embeddings but sufficient for short‑range lexical retrieval on small corpora.

3) Storage
- Each chunk is inserted into `chunks(content, embedding)`; embeddings stored as JSON string.

4) Retrieval
- Query message → embed (same function as chunks).
- Load user’s chunks → compute cosine similarity → sort → take top 8.

5) Grounded prompting and generation
- Prompt pattern: “Answer using ONLY the provided context. If not enough, say you are not sure.”
- Model: `gemini-1.5-flash` for fast iteration.
- Returns: `{ answer, sources: [chunkIds...] }`.

Safety against hallucination: strict instruction + abstain clause. Future: cite highlighted excerpts inline.

Edge cases I handled:
- Missing API key → generation endpoints throw clear errors; ingestion still works with local embeddings.
- Empty/low‑text files return early with user‑friendly messages.
- Chunking handles short docs without creating zero‑length segments.

---

## Frontend implementation (my core contribution)

Pages and UX:
- `app/page.tsx` → animated landing.
- `(auth)/login` and `(auth)/signup` → simple forms posting to `/api/auth/*`.
- `dashboard/page.tsx` → action cards + upload control (hidden input + styled button) posting to `/api/upload`. Navigation buttons (Chat/MCQ/SA/LA) are gated: if no file is uploaded, navigation is blocked and a toast is shown on the Dashboard.
- `chat/page.tsx` with `components/AIChatCard.tsx` → chat interface.
- `test/page.tsx` → start test, fetch questions, collect answers, submit.

Chat UI details (`AIChatCard`):
- Local state for messages and typing indicator.
- Send on Enter/click → POST `/api/chat` → push AI response to the feed.
- Subtle motion with Framer Motion; responsive Tailwind classes; accessible color contrast for dark theme.

Why a custom chat component (vs a library): full control over states, styling, and future streaming.

Background animation:
- `components/BackgroundPaths.tsx` provides `BackgroundPathsOverlay`, now fixed to the viewport for a full‑screen effect across Chat and Test pages.
- Ensures the animation isn’t confined to a smaller container.

Accessibility and usability:
- Keyboard submit, visible focus states, readable sizes.
- Network errors surface a friendly message and don’t break the session.

---

## API surface (what/why/how)

Auth:
- POST `/api/auth/signup` — create user, hash with `bcryptjs`, start session.
- POST `/api/auth/login` — verify credentials, start session.
- POST `/api/auth/logout` — destroy session.
- GET `/api/auth/me` — return `{ user }` or `{ user: null }`.

Documents & RAG:
- POST `/api/upload` — accepts 1–3 files, extracts text, chunks, embeds, persists.
- POST `/api/chat` — embeds query, ranks top chunks, constructs grounded prompt, returns AI answer.

Testing:
- POST `/api/test` — generate test JSON via model and persist.
- GET `/api/test-questions?testId=...` — fetch stored questions for the test run.
- PUT `/api/test` — submit answers; auto‑score MCQ/Short; Long is placeholder.

Why JSON questions: deterministic client rendering and future analytics on question difficulty.

Session & state:
- GET `/api/state/active-docs` — `{ hasActiveDocs: boolean }` used to gate navigation and actions.
- DELETE `/api/state/active-docs` — clears current active document IDs; invoked automatically on full page reload for a fresh session.

---

## Performance considerations

- Chunk size and overlap tuned for small study corpora; reduces prompt size while retaining context.
- Embeddings are computed sequentially; parallelization could speed large uploads.
- SQLite with WAL is fast for local workloads; consider indexes on `documents.userId` and `chunks.documentId` for scale.
- Prompt is non‑streaming to keep server logic simple; streaming could improve UX on long answers.
- Test generation now supports a local MCQ fallback, avoiding hard failures when model calls are slow/unavailable.

---

## Security, privacy, and safety

- Passwords hashed with `bcryptjs`.
- Sessions are HTTP‑only, `SameSite=Lax`, `secure` in prod.
- Server input validated with `zod`.
- File parsing only for PDF/DOCX/TXT; rejects others, limiting attack surface.
- Data stays local in SQLite; the only external calls are to Gemini when an API key is configured. Test generation has a local fallback for MCQ/Short/Long to preserve functionality when the model is unavailable.
- Missing features to add later: rate limiting, file type allow‑list tightening, content moderation for prompts.

---

## Testing and validation

Current state:
- Manual end‑to‑end testing of auth, upload, chat, and test workflows.
- Deterministic local embeddings help validate ranking without needing the network.

Planned additions:
- Unit tests for `chunkText`, similarity, and test scoring.
- Integration tests for `/api/upload` and `/api/chat` with small fixtures.
- Snapshot tests for prompt templates.

---

## Developer setup (Windows/PowerShell)

Environment variables (create a `.env.local`):
- `API_KEY` — Google Generative AI key. Required for chat and test generation.
- `SESSION_SECRET` — strong random string for sessions.
- `SQLITE_PATH` — optional path; defaults to `./data.sqlite`.

Install and run locally:

```powershell
npm install
npm run dev
# open http://localhost:3000
```

Production build (optional):

```powershell
npm run build
npm start
```

---

## How to use (quick start)

1) Sign up (email + password) → redirected to Dashboard.
2) Upload 1–3 files (PDF/DOCX/TXT). Wait for processing to complete.
3) Use the Dashboard buttons to go to Chat/Test. If no file is uploaded, navigation is blocked and a toast appears on the Dashboard.
4) Go to Chat → ask questions grounded in your notes.
5) Go to Test → choose mode (MCQ/Short/Long), generate questions, answer, and submit for a score.
Note: After a full browser refresh, the session is reset for safety; upload again to start a new session.

Tip: Without `API_KEY`, uploads and retrieval work (local embeddings). Chat/Test attempt model calls; if they fail, generation falls back (MCQ/Short/Long) so you can continue practicing.

---

## Troubleshooting

- “Missing API_KEY for text/JSON generation”
  - Set `API_KEY` in your environment. Embeddings still work locally. If model calls fail, tests fall back to local generation (MCQ/Short/Long); chat falls back to a concise extract when possible.
- “Failed to parse PDF”
  - Re‑export your PDF as text‑based or upload as DOCX/TXT.
- “Upload 1–3 files”
  - The endpoint currently enforces a small batch to keep processing times predictable.
- Empty answers or strange retrieval
  - Ensure your files contain selectable text (not scanned images), or try TXT.
 - “Dashboard buttons do nothing”
   - If no file is uploaded, navigation is intentionally blocked and a toast is shown on the Dashboard. Upload a file first.
 - “Uploads disappeared after refresh”
   - On a full browser reload, the session clears the active document scope by design; upload again to start a fresh session.

---

## Limitations and roadmap

- No chat history yet (tables exist but not wired).
- Long answer grading is a placeholder (0 points); plan: LLM‑assisted rubric scoring.
- No citations UI yet; plan: show highlighted excerpts and per‑message sources.
- Retrieval is pure cosine over embeddings; plan: add hybrid search (BM25 + vectors) and reranking.
- Non‑streaming chat; plan: server‑sent events or chunked streaming for better UX.
- Performance: batch/parallel embed, background indexing, and DB indexes.
- Security: add rate limiting and stricter file validation.

---

## Personal contributions, trade‑offs, and learnings

My scope: frontend UX and the full RAG pipeline (ingestion → chunking → embedding → retrieval → prompting → response), and close collaboration on API design.

Key decisions I made:
- Use Tailwind v4 + Framer Motion to quickly craft a clean, responsive interface.
- Build a small custom chat component for full control and future streaming support.
- Keep embeddings local‑fallback to avoid blocking uploads when offline; document the trade‑off clearly.
- Store vectors as JSON in SQLite to minimize external dependencies and keep onboarding simple.

What I learned:
- How chunk size/overlap drastically affect retrieval quality and prompt budget.
- The value of explicit “answer only from context” prompts for reducing hallucinations.
- That parsed PDFs can be noisy; cleaning and sampling text improves test question quality.

---

## Appendix A — Key prompts

Chat prompt (simplified):
> “You are a helpful study assistant. Answer the user's question using ONLY the provided context. If the context is not enough, say you are not sure.”

Test generation (JSON‑only):
> “Given these materials, produce ONLY valid JSON with an array of questions (MCQ/Short/Long) with options/answer keys as appropriate.”

---

## Appendix B — Important files

- `src/app/api/upload/route.ts` — parsing, chunking, embedding, persistence.
- `src/app/api/chat/route.ts` — query embedding, ranking, prompting.
- `src/app/api/state/active-docs/route.ts` — GET hasActiveDocs; DELETE clears current active docs on demand.
- `src/server/ai.ts` — Gemini integration + local embedding fallback.
- `src/server/rag.ts` — chunking and ranking utilities.
- `src/server/db.ts` — schema and DB lifecycle.
- `src/middleware.ts` — route protection.
- `src/components/AIChatCard.tsx` — chat UI.
- `src/components/BackgroundPaths.tsx` — full‑screen animated background overlay.
- `src/components/SessionFreshReset.tsx` — clears active docs only on full page reload.

---

## Quality gates (current change)

- Build: Not executed in this report.
- Lint/Typecheck: PASS for modified files.
- Tests: N/A (manual flows verified; future automated tests planned).

---

This report documents what the project is, why each choice was made, and how it works end‑to‑end, with a focus on the frontend and RAG components I implemented.

---

## Deep technical appendix

### A. Detailed API contracts (schemas, responses, errors)

Notes:
- All endpoints return JSON.
- Auth-required endpoints return 401 when no valid `iron-session` cookie is present.

1) POST `/api/auth/signup`
- Request body (Zod):
  - `{ email: string (email), password: string (min 6) }`
- Success 200:
  - `{ id: string, email: string }` and sets `study_assistant_session` cookie
- Errors:
  - 400 `{ error: "Invalid input" }`
  - 409 `{ error: "Email already in use" }`

2) POST `/api/auth/login`
- Request body (Zod): same as signup
- Success 200:
  - `{ id: string, email: string }` and sets session cookie
- Errors:
  - 400 `{ error: "Invalid input" }`
  - 401 `{ error: "Invalid credentials" }`

3) POST `/api/auth/logout`
- Success 200: `{ ok: true }` and destroys session

4) GET `/api/auth/me`
- Success 200:
  - `{ user: { id: string, email: string, createdAt: string } | null }`

5) POST `/api/upload` (multipart)
- FormData: `files` (1–3 files; allowed: .pdf, .docx, .txt)
- Success 200: `{ ok: true }`
- Errors:
  - 400 `{ error: "Upload 1-3 files" }`
  - 400 `{ error: "Failed to parse PDF: <name>" }`
  - 401 `{ error: "Unauthorized" }`
  - 500 `{ error: "<message>" }`

6) POST `/api/chat`
- Request body (Zod): `{ message: string (min 1) }`
- Success 200: `{ answer: string, sources: string[] /*chunk IDs*/ }`
- Errors:
  - 400 `{ error: "Invalid input" }`
  - 401 `{ error: "Unauthorized" }`
  - 500 `{ error: "Missing API_KEY for text generation" | other }`

7) POST `/api/test`
- Request body (Zod): `{ mode: "mcq"|"short"|"long"|"mixed", durationSec: number, numQuestions: number }`
- Success 200: `{ testId: string }`
- Errors:
  - 400 `{ error: "Invalid input" }`
  - 400 `{ error: "No documents uploaded" }` (if applicable)
  - 401 `{ error: "Unauthorized" }`
  - 500 `{ error: "Missing API_KEY for JSON generation" | other }`

8) GET `/api/test-questions?testId=<id>`
- Success 200: `{ testId: string, questions: Array<{ id: string, type: "mcq"|"short"|"long", question: string, options?: string[], answerKey?: string, maxScore: number }> }`
- Errors: 400 invalid/missing testId, 401 unauthorized

9) PUT `/api/test`
- Request body: `{ testId: string, answers: Array<{ questionId: string, answer: string }> }`
- Success 200: `{ submissionId: string, score: number, maxScore: number }`
- Errors: 400 invalid input, 401 unauthorized

---

### B. Database schema (annotated DDL) and indexing recommendations

Current DDL (simplified from `src/server/db.ts`):

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(userId) REFERENCES users(id)
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  FOREIGN KEY(documentId) REFERENCES documents(id)
);

CREATE TABLE tests (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  mode TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(userId) REFERENCES users(id)
);

CREATE TABLE test_questions (
  id TEXT PRIMARY KEY,
  testId TEXT NOT NULL,
  type TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT,
  answerKey TEXT,
  maxScore REAL NOT NULL,
  FOREIGN KEY(testId) REFERENCES tests(id)
);

CREATE TABLE test_submissions (
  id TEXT PRIMARY KEY,
  testId TEXT NOT NULL,
  userId TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  submittedAt TEXT,
  score REAL,
  FOREIGN KEY(testId) REFERENCES tests(id),
  FOREIGN KEY(userId) REFERENCES users(id)
);

CREATE TABLE test_answers (
  id TEXT PRIMARY KEY,
  submissionId TEXT NOT NULL,
  questionId TEXT NOT NULL,
  answer TEXT NOT NULL,
  scoreAwarded REAL,
  FOREIGN KEY(submissionId) REFERENCES test_submissions(id),
  FOREIGN KEY(questionId) REFERENCES test_questions(id)
);
```

Recommended indexes for scale:
- `CREATE INDEX idx_documents_user ON documents(userId);`
- `CREATE INDEX idx_chunks_doc ON chunks(documentId);`
- `CREATE INDEX idx_tests_user ON tests(userId);`
- `CREATE INDEX idx_questions_test ON test_questions(testId);`
- `CREATE INDEX idx_submissions_test_user ON test_submissions(testId, userId);`

Note: embeddings are stored as JSON strings; for heavy workloads consider a vector DB (e.g., SQLite extensions like `vss` or external services) or store embeddings in compressed binary.

---

### C. RAG math and heuristics

Embedding normalization:
- Gemini embeddings are already in a vector space suitable for cosine similarity.
- Local fallback embeds into a fixed dimension d=256 by character hashing + bucket counts, then L2‑normalizes: $\hat{v} = v / \|v\|_2$.

Cosine similarity:
$$\text{cos}(a,b) = \frac{\sum_i a_i b_i}{\sqrt{\sum_i a_i^2} \cdot \sqrt{\sum_i b_i^2} + 10^{-8}}$$
The small epsilon stabilizes division when norms are near zero.

Chunking heuristics:
- Window size ~800 words, overlap ~150 words.
- Rationale: maintain semantic continuity across chunk boundaries without exploding storage; good balance for typical lecture notes and textbooks.

Top‑K selection:
- K=8 for response context. This caps prompt size and improves latency while preserving breadth.

Potential improvements:
- Hybrid retrieval (BM25 + vectors), MMR reranking, or cross‑encoder reranking for better precision at K.

---

### D. Prompt templates (full examples)

Chat (grounded):

```
You are a helpful study assistant. Answer the user's question using ONLY the provided context. 
If the context is not enough, say you are not sure.

Context:
<top-8 chunk texts delimited with --->

User: <message>
Assistant:
```

Test generation (JSON only, robust to markdown code fences in responses):

```
You are a question generator. Using the material below, return ONLY valid JSON describing an array of questions.
Each question is one of: "mcq" | "short" | "long". MCQ must include options and an answerKey.

JSON shape:
{
  "questions": [
    {
      "type": "mcq" | "short" | "long",
      "question": string,
      "options": string[]?,
      "answerKey": string?,
      "maxScore": number
    }, ...
  ]
}

Return ONLY JSON, no prose.
```

Parsing is resilient: the server extracts fenced ```json blocks if present; else attempts to parse the raw body as JSON.

---

### E. Frontend architecture details

Component map (high‑level):
- `app/layout.tsx` — global shell (nav, fonts, container) + `globals.css`.
- `app/page.tsx` — landing with `HeroGeometric`.
- `(auth)/login/page.tsx`, `(auth)/signup/page.tsx` — forms that POST to auth APIs.
- `dashboard/page.tsx` — actions (Chat/Test) and upload control.
- `chat/page.tsx` — wraps `AIChatCard`.
- `components/AIChatCard.tsx` — chat UI: message list, input, send/typing state.

State flows:
- Chat messages: local component state; fetch on send, append assistant response.
- Auth gate: on mount, fetch `/api/auth/me`; redirect to `/login` if no user.

Styling and motion:
- Tailwind utility classes for layout, spacing, and theming.
- Framer Motion for enter/fade and subtle background animation.

Accessibility:
- Keyboard submit via Enter.
- Visible focus rings and readable contrast on dark background.
- Errors rendered as inline assistant messages to keep context.

---

### F. Configuration matrix

Environment variables:
- `API_KEY` — required for text and JSON generation (chat, test). If missing, embeddings fallback to local, but generation endpoints error.
- `SESSION_SECRET` — strong secret string for signing cookies.
- `SQLITE_PATH` — optional custom path (default `./data.sqlite`).

Runtime notes:
- `export const runtime = "nodejs"` in `upload` route ensures Node APIs are available for PDF/DOCX parsing.
- Other routes can run in the default runtime; PDF parsing specifically needs Node.

---

### G. Security and threat model (expanded)

Threats considered and mitigations:
- Credential theft → bcrypt password hashing; never store plaintext.
- Session theft → HTTP‑only, signed cookies; `secure` in production; `SameSite=Lax` to reduce CSRF.
- CSRF on state‑changing routes → Lax cookies + app‑only usage reduces risk; optional CSRF token can be added later.
- XSS → No server‑rendered untrusted HTML; chat output is plain text; avoid `dangerouslySetInnerHTML`.
- File upload attacks → Only accept PDF/DOCX/TXT; parse via vetted libs; limit count (1–3 files).
- Prompt injection → Strict instruction to answer only from provided context; still consider server‑side sanitation and source display.

Additional hardening to consider:
- Size limits on uploads; MIME and extension allow‑list enforcement.
- Rate limiting on `/api/chat` and `/api/upload`.
- Content scanning for risky files.

---

### H. Performance and scalability (expanded)

Complexity:
- Upload N files with M total words → chunking O(M), embedding O(C) where C=#chunks.
- Retrieval: similarity O(K + Nchunks). Current loads all user chunks; for very large corpora, consider pre‑filtering or DB‑level paging.

Latency tips:
- Batch/parallel embeddings where API limits allow.
- Cache query embeddings for repeated prompts during the same session.
- Reduce K or chunk size if prompt tokens become large.

Storage:
- Rough order: each chunk stores text (~1–4KB) + JSON embedding (~1–2KB for 256 dims) → on the order of a few KB per chunk.

---

### I. Testing strategy (proposed specifics)

Unit tests:
- `chunkText` — boundaries, overlap correctness, short/empty inputs.
- Similarity — known vectors produce expected ordering.
- Scoring — MCQ exact match (case‑insensitive), Short exact match, Long=0.

Integration tests:
- `/api/upload` — small fixture files (TXT/PDF) create documents and chunks.
- `/api/chat` — with local embeddings and a small corpus, answer includes expected source.

Contract tests:
- Validate `generateJSON` robust extraction from fenced code blocks and raw JSON.

---

### J. Deployment, operations, and observability

Deployment options:
- Self‑hosted Node.js (recommended for full PDF/DOCX parsing support).
- Managed platforms supporting Node runtime; ensure the upload route runs in Node (not Edge) due to `pdf-parse`/`mammoth`.

Operational considerations:
- Persist `data.sqlite` and WAL files (`data.sqlite-wal`, `data.sqlite-shm`).
- Backups: periodic copy of SQLite files when the service is stopped (or use `VACUUM INTO`).
- Logs: add minimal request/error logging (e.g., `pino`) for debugging.

Monitoring ideas:
- Track upload counts, #chunks, average chat latency, topK sizes.
- Error rate on PDF parsing and model calls.

---

### K. Alternatives considered

- Auth: NextAuth vs `iron-session` → chose `iron-session` for simplicity and no DB tables.
- DB: Postgres + pgvector vs SQLite → chose SQLite for zero‑ops local usage.
- Vector store: external vs JSON in SQLite → started with JSON to minimize dependencies; can upgrade later.
- LLM provider: kept to Gemini SDK; LangChain unused to reduce abstraction overhead.

---

### L. Data governance

- Export: implement endpoint to export a user’s documents, chunks, and tests as JSON.
- Delete: endpoint to delete user data (documents + chunks + tests) and account.
- Privacy: by default, all data local; LLM calls only when `API_KEY` is set.

---

### M. Roadmap checklist (granular)

- [ ] Add DB indexes listed above.
- [ ] Persist chat history (reuse `chats`/`messages` tables).
- [ ] Citations UI with highlighted excerpts and source list.
- [ ] Streaming chat responses.
- [ ] Hybrid retrieval (BM25 + vectors) and reranking.
- [ ] Fuzzy short‑answer scoring (normalize, stem, synonyms).
- [ ] Rate limiting and upload size limits.
- [ ] Unit/integration test suite with fixtures.
- [ ] Data export/delete endpoints.

---

### N. Glossary

- RAG — Retrieval‑Augmented Generation: retrieve relevant passages, feed to an LLM to ground responses.
- Embedding — numeric vector representation of text for similarity search.
- Cosine similarity — metric for measuring angle (similarity) between vectors.
- Chunk — a segment of source text produced by a sliding window.



