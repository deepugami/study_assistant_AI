## Study Assistant — Comprehensive Technical Report

### Overview
Study Assistant is a personal learning companion that lets a student upload their own study materials (PDF, DOCX, TXT), indexes them locally with embeddings, and then:
- Chat with a contextual AI over their materials (RAG: Retrieval-Augmented Generation)
- Generate practice tests (MCQ, short, long answer) based entirely on those materials

Authentication is session-based. All data is stored locally in SQLite. The AI layer uses Google Generative AI (Gemini) when an API key is provided; otherwise, a local embedding fallback keeps the app usable without cloud access (chat requires an API key).

### Problem Statement — What it solves
- Students often have scattered notes across documents. Finding answers is slow.
- Generic AI chat often hallucinates and does not respect a student’s own material.
- Creating practice tests is time-consuming and rarely tailored to one’s notes.

Study Assistant centralizes a student’s materials, grounds AI responses on them, and auto-generates practice tests, improving focus, recall, and preparation efficiency.

### How it works (end-to-end)
1) Sign up / Log in
- Credentials are stored with a hashed password (bcrypt) in SQLite.
- A session cookie (`iron-session`) keeps users logged in.

2) Upload documents (Dashboard → Upload)
- Accepts 1–3 files per upload: PDF, DOCX, or TXT.
- Text is extracted (pdf-parse, mammoth, or direct text), then chunked into overlapping segments.
- Each chunk is embedded to a vector (Google "text-embedding-004" if `API_KEY` is set; otherwise a deterministic local fallback embedding).
- Chunks + embeddings are stored in SQLite for the user.

3) Chat over your notes
- When the user sends a message, the message is embedded and compared with all of their document chunks via cosine similarity.
- Top-k relevant chunks form the context. The app prompts Gemini ("gemini-1.5-flash") to answer strictly from this context.
- The response plus IDs of source chunks are returned to the UI.

4) Generate and take tests
- The server samples the user’s chunk content and prompts the model to produce a JSON payload of questions.
- Questions are stored in SQLite and fetched by the UI.
- On submission: MCQs and short answers are auto-scored (exact-match for short); long answers are currently not LLM-graded (awarded 0 by design for now).

5) Routing & protection (middleware)
- Unauthenticated users are redirected from protected pages (`/dashboard`, `/chat`, `/test`) to `/login`.
- Authenticated users are redirected from `/login` and `/signup` to `/dashboard`.

### Tech Stack
- Web framework: Next.js 15 (App Router, TypeScript)
- Runtime: Node.js (for API routes and file processing)
- UI: React 19, Tailwind CSS v4, Framer Motion, `lucide-react`, `react-icons`
- Auth/session: `iron-session`
- Database: SQLite via `better-sqlite3`
- Validation: `zod`
- Crypto: `bcryptjs`
- AI: Google Generative AI (`@google/generative-ai`) for text generation and embeddings; local embedding fallback implemented
- Parsing: `pdf-parse`, `mammoth` (DOCX)
- Tooling: Turbopack (`next dev --turbopack`), ESLint 9

Note: `langchain` packages are present but not currently used by the core flows.

### Dependencies (versions and purpose)
- `next@15.5.2`: App Router, API routes, middleware
- `react@19.1.0`, `react-dom@19.1.0`: UI framework and renderer
- `tailwindcss@^4`, `@tailwindcss/postcss@^4`: styling via Tailwind v4 with PostCSS plugin
- `framer-motion@^12.23.12`: animations
- `lucide-react@^0.542.0`, `react-icons@^5.5.0`: icon sets
- `clsx@^2.1.1`: conditional classNames
- `iron-session@^8.0.4`: stateless, signed, HTTP-only session cookies
- `better-sqlite3@^11.10.0`: fast SQLite bindings for Node.js
- `zod@^3.25.76`: runtime input validation
- `bcryptjs@^3.0.2`: password hashing (pure JS)
- `uuid@^12.0.0`: ID generation
- `@google/generative-ai@^0.24.1`: Gemini models (text, embeddings)
- `pdf-parse@^1.1.1`: PDF text extraction
- `mammoth@^1.10.0`: DOCX text extraction
- `multer@^2.0.2`: present but not used (upload handled via Web API `formData()`)
- `cosine-similarity@^1.0.1`: cosine similarity utility (used in `rag.ts` helpers)
- `langchain@^0.3.33`, `@langchain/community@^0.3.55`, `@langchain/google-genai@^0.2.17`: installed but not used in core logic
- Dev: `eslint@^9`, `eslint-config-next@15.5.2`, `@eslint/eslintrc@^3`, `typescript@^5`, `@types/*@`: linting and types

### Data model (SQLite)
Tables are created on first run (`src/server/db.ts`).
- `users(id, email, passwordHash, createdAt)`
- `documents(id, userId, name, mime, createdAt)`
- `chunks(id, documentId, content, embedding)` — `embedding` stored as JSON array string
- `chats(id, userId, createdAt)` — reserved for future chat history (not yet used)
- `messages(id, chatId, role, content, createdAt)` — reserved for future chat history
- `tests(id, userId, mode, durationSec, createdAt)`
- `test_questions(id, testId, type, question, options, answerKey, maxScore)`
- `test_submissions(id, testId, userId, startedAt, submittedAt, score)`
- `test_answers(id, submissionId, questionId, answer, scoreAwarded)`

### API Reference (server routes)
- Auth
  - `POST /api/auth/signup` → create account, set session
  - `POST /api/auth/login` → login, set session
  - `POST /api/auth/logout` → destroy session
  - `GET  /api/auth/me` → current user profile or null

- Documents & RAG
  - `POST /api/upload` (multipart FormData: `files`) → parse, chunk, embed, store
  - `POST /api/chat` ({ message }) → RAG retrieval over user chunks, LLM answer

- Testing
  - `POST /api/test` ({ mode, durationSec, numQuestions }) → generate test, returns `testId`
  - `GET  /api/test-questions?testId=...` → fetch generated questions
  - `PUT  /api/test` ({ testId, answers }) → submit answers and get score

### Deep dive: Core modules and logic

- `src/server/db.ts` — database lifecycle and schema
  - Creates all tables at startup using `better-sqlite3` and WAL mode for durability.
  - Central `getDb()` memoizes the DB handle and invokes `migrate()` once.

- `src/server/session.ts` — sessions
  - `iron-session` with cookie `study_assistant_session`, `SameSite=Lax`, `secure` in production, `httpOnly`.
  - `getSession()` bridges Next.js `cookies()` store with `iron-session`.

- `src/server/ai.ts` — AI integration and fallbacks
  - `ensureGenAI()` lazily initializes a client when `API_KEY` is provided.
  - Local embedding fallback `localEmbed(text, dim=256)`: builds a fixed-size vector by iterating characters, updating a hash accumulator, incrementing bucket counts, then L2-normalizing the vector. Deterministic and offline.
  - `embedText(input)`: uses Google `text-embedding-004` if available, else `localEmbed`.
  - `generateText(prompt)`: calls `gemini-1.5-flash` for responses; throws if no `API_KEY`.
  - `generateJSON<T>(systemPrompt)`: asks the model to return ONLY JSON; extracts fenced code blocks if present and `JSON.parse` them into typed output.

- `src/server/rag.ts` — chunking, embeddings, and ranking utilities
  - `chunkText(text, chunkSize=800, overlap=150)`: word-based sliding window producing overlapping chunks to preserve context across boundaries.
  - `embedChunks(chunks)`: sequentially embeds each chunk (could be parallelized in future).
  - `topKSimilar(queryEmbedding, candidates, k)`: cosine similarity (via `cosine-similarity`), sort, slice top-k.

- `src/app/api/upload/route.ts` — ingestion pipeline
  - Auth required (via `getSession()`). Accepts 1–3 files in `FormData` key `files`.
  - Extraction:
    - PDF: dynamic import of `pdf-parse` (with compatibility path) → `parsed.text`.
    - DOCX: `mammoth.extractRawText` → `value`.
    - TXT: `Buffer.toString("utf8")`.
  - For each file: insert into `documents`, then `chunkText()` → `embedText()` per chunk → insert into `chunks` with `embedding` serialized to JSON string.

- `src/app/api/chat/route.ts` — retrieval and answer generation
  - Auth required. Validate `{ message }` with `zod`.
  - Compute query embedding, load all user chunks with `SELECT id, content, embedding ...`.
  - Compute cosine similarity via a dedicated function:
    ```ts
    function similarity(a: number[], b: number[]): number {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; }
      for (let i = 0; i < b.length; i++) nb += b[i]*b[i];
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
    }
    ```
  - Rank and take top 8 chunks. Build a strict, grounded prompt:
    - “Answer using ONLY the provided context. If not enough, say you are not sure.”
  - Call `generateText(prompt)` and return `{ answer, sources }`.

- `src/app/api/test/route.ts` — test generation and scoring
  - `POST`: Validate `{ mode, durationSec, numQuestions }`. Sample up to 200 chunk contents, prompt LLM to output `questions[]` JSON (MCQ/short/long) using `generateJSON`.
  - Store `tests` and `test_questions` (options and answerKey serialized as needed), return `testId`.
  - `PUT`: Validate `{ testId, answers }`. Load questions; score:
    - MCQ: case-insensitive exact match against `answerKey`.
    - Short: strict exact match (case-insensitive); could be expanded to fuzzy.
    - Long: placeholder `0` (future LLM-grading planned).
  - Persist `test_submissions` and `test_answers`, return `{ submissionId, score, maxScore }`.

- `src/middleware.ts` — route protection
  - Redirect unauthenticated users away from `/dashboard`, `/chat`, `/test`.
  - Redirect authenticated users away from `/login`, `/signup`.

- Frontend pages and components
  - `(auth)/login`, `(auth)/signup`: simple client forms posting to API; on success, route to `/dashboard`.
  - `dashboard/page.tsx`: menu cards to modes; file input hidden behind a button; uploads to `/api/upload`.
  - `chat/page.tsx` + `components/AIChatCard.tsx`: conversational UI with typing indicator, sends to `/api/chat`.
  - `test/page.tsx`: starts a test by mode, fetches `test-questions`, collects answers, and submits.

### Notable design choices
- Embedding fallback keeps upload/index/search usable without network, improving local utility.
- Storing embeddings as JSON in SQLite simplifies setup; a vector DB could be integrated later.
- Strict grounding in prompts reduces hallucinations by instructing the model to abstain when context is insufficient.

### Frontend Features
- `Home (/)` Landing with animated hero.
- `Login` / `Signup` client pages with form submission to auth APIs.
- `Dashboard` shows an animated menu (Chat, MCQ/SA/LA test modes) and file upload control.
- `Chat` page renders an interactive chat card with typing indicator; messages are sent to `/api/chat`.
- `Test` page starts a test by mode, renders fetched questions, collects answers, and submits for scoring.

Key components:
- `AIChatCard` — interactive chat UI with send/typing states.
- `BackgroundCircles`, `GlowingEffect`, `GradientMenu`, `Glass` — visual polish.

### Configuration & Setup
Environment variables:
- `API_KEY` — Google Generative AI key. Required for AI generation. If missing, embeddings fall back locally; text generation endpoints will error.
- `SESSION_SECRET` — secret for `iron-session`. Use a strong value in production.
- `SQLITE_PATH` — optional path for the SQLite file (defaults to `./data.sqlite`).

Install & run:
```bash
npm install
npm run dev
# open http://localhost:3000
```

Production build:
```bash
npm run build
npm start
```

### Work done so far
- Account system (signup/login/logout, session cookies, protected routes)
- Document ingestion pipeline (PDF/DOCX/TXT → text → chunk → embed → store)
- RAG chat over user-specific knowledge base (top-k cosine similarity)
- Test generation (MCQ/short/long) and storage; question fetch and submission UI
- Scoring (MCQ exact match, short exact match, long answer placeholder)
- Modern animated UI and navigation

### Known errors and troubleshooting
- Missing `API_KEY`:
  - Embedding: falls back to a deterministic local embedding; chat still requires generation and will fail without an API key.
  - Generation routes (`/api/chat`, `/api/test` for JSON generation) will return errors like "Missing API_KEY for text/JSON generation".
  - Fix: set `API_KEY` in environment.

- PDF parsing edge cases:
  - Some PDFs fail to parse or produce empty text. The upload route returns a 400 with a file-specific message.
  - Fix: try re-exporting the PDF as text-based or upload as TXT/DOCX.

- DOCX parsing quirks:
  - `mammoth` extracts raw text; complex layouts may lose structure.

- "No documents uploaded" when starting a test:
  - The test route requires at least one uploaded document.

- Session issues in production:
  - Ensure `SESSION_SECRET` is set and `cookieOptions.secure` is true (it is when `NODE_ENV=production`).

### Limitations and future work
- Chat history storage: Tables exist but are not yet wired to persist conversation turns.
- Long-answer grading: Currently a placeholder (awarded 0). Could be LLM-graded with rubrics and similarity checks.
- Source highlighting: UI receives chunk IDs but does not yet surface excerpts with citations.
- Reranking: Only cosine similarity over stored embeddings; could add hybrid search (BM25) or multi-vector retrieval.
- Streaming responses: Current chat returns full responses; streaming would improve UX.
- File limits: 1–3 files per upload, basic type checks; could add queueing and progress UI.
- Role-based features: All users have same permissions; could add roles or sharing.

### Security and privacy
- Passwords hashed with bcrypt.
- Session cookie is HTTP-only, `SameSite=Lax`, and `secure` in production.
- All personal data is stored locally in SQLite; no remote storage beyond optional calls to Google Generative AI for generation/embedding.
- Input validation via `zod` on server routes.

### Directory guide (high level)
- `src/app` — App Router pages and API routes
  - `(auth)/*` — login/signup pages
  - `/dashboard`, `/chat`, `/test` — main features
  - `/api/*` — auth, upload, chat, test endpoints
- `src/server` — server utilities (`db.ts`, `session.ts`, `ai.ts`, `rag.ts`)
- `src/components` — UI components and effects
- `src/lib/utils.ts` — small client helpers
- `data.sqlite` — SQLite database (WAL mode enabled)

### Request lifecycles (reference)
- Upload
  1. Client (Dashboard) → `POST /api/upload` (FormData: files)
  2. Server extracts text → chunk → embed → DB inserts

- Chat
  1. Client (Chat) → `POST /api/chat` ({ message })
  2. Server embeds query → ranks top chunks → crafts prompt → LLM → answer

- Test
  1. Client (Test) → `POST /api/test`
  2. Server samples content → JSON questions via LLM → store → return `testId`
  3. Client fetches `GET /api/test-questions?testId=...`
  4. Client submits answers → `PUT /api/test` → returns score

---
This document is intended to be a single-stop technical reference for contributors and users who want to understand, run, and extend Study Assistant.


