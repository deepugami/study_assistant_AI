# Learn This Project: Study Assistant — Step‑by‑Step Onboarding

Welcome! This guide assumes you know nothing about the codebase. Follow the reading order and checkpoints below to understand what the app does, how it’s structured, and where to dive deeper.

The project is a Next.js 15 app with a local SQLite database. It lets you upload study files (PDF/DOCX/TXT), chat with your notes using RAG (retrieval‑augmented generation), and generate practice tests (MCQ or Comprehensive).

---

## What you’ll learn

- The big picture: how uploads → chunking/embeddings → retrieval → AI answers work
- How the Next.js App Router organizes pages and API routes
- Where data lives (SQLite) and how sessions work
- How to extend features (chat/test generation, UI, and RAG pipeline)

---

## Quick context (2–5 minutes)
Open these first to get oriented:

1) `README.md`
   - Skim what the app does, how to run it, and the tech stack.

2) `package.json`
  - Look at `scripts` (dev/build/start) and the main dependencies: Next.js/React, better‑sqlite3, iron‑session, pdf‑parse/mammoth, zod, Google Generative AI.

3) `next.config.ts`
   - See that ESLint is ignored during builds; otherwise default config.

4) `src/middleware.ts`
   - Currently a no‑op. Good to know there’s no routing guard in middleware.
  - What is `middleware.ts`? In Next.js (App Router), middleware runs before a request reaches your route handlers or pages. It can rewrite/redirect requests, add headers, and gate access based on paths defined in `export const config = { matcher: [...] }`.
  - What does "no‑op" mean? Short for "no operation" — the middleware intentionally does nothing and lets every request pass through unchanged.

5) `src/app/layout.tsx` and `src/app/globals.css`
   - Understand the global shell (nav, fonts) and where global CSS lives.
   - Notice `SessionFreshReset` — it affects how session state is refreshed.

At this point you should know: what this app is, how it runs, and the top‑level shell.

---

## 30‑minute architecture tour (read in this order)
Focus on the user journey: Home → Dashboard → Upload → Chat/Test.

1) Landing and navigation
   - `src/app/page.tsx` — the landing page using `HeroGeometric`.
   - `src/components/SessionFreshReset.tsx` — why uploads aren’t persisted across a full browser refresh.

2) Dashboard and core pages
  - `src/app/dashboard/page.tsx` — upload + navigation (Chat, MCQ, Comprehensive) with dual CTA (Upload file + placeholder Paste link).
  - `src/app/chat/page.tsx` — the chat page shell with the modern AI chat card.
  - `src/app/test/page.tsx` and `src/app/test/TestClient.tsx` — the test UI and client logic (MCQ/Comprehensive modes).

3) Key UI components
  - `src/components/AIChatCard.tsx` — chat list, input, send, and rendering (minimal/glassy redesign).
  - Visual components (optional skim): `BackgroundPaths.tsx`, `BackgroundCircles.tsx`, `HeroGeometric.tsx`, etc.

Outcome: You can trace what the user sees and which components render on each page.

---

## Server and data flow (deep dive, 60–90 minutes)
Read these in order to understand the backend logic that powers upload, chat, and test.

1) Sessions and database
   - `src/server/session.ts`
     - Iron‑session cookie config; note that a default `public` user is set for auth‑less operation.
   - `src/server/db.ts`
     - SQLite setup (WAL), migrations, and tables for users, documents, chunks, tests, questions, submissions, answers, and a small QA cache.

2) RAG utilities and AI helpers
   - `src/server/rag.ts`
     - `chunkText`, `cosineSimilarity`, and helpers; understand chunking size/overlap and top‑K retrieval.
   - `src/server/ai.ts`
     - Embeddings via Gemini with a robust local fallback; text/JSON generation with REST fallbacks and model lists.

3) Upload pipeline
   - `src/app/api/upload/route.ts`
     - Multipart ingest; parsing for PDF/DOCX/TXT; chunking; embedding; storing in SQLite; session scoping of current documents.
     - Edge cases and error handling.

4) Chat API (RAG answer)
   - `src/app/api/chat/route.ts`
     - Request schema, session usage, query embedding, similarity scoring, prompt construction, cache, fallbacks.

5) Test lifecycle APIs
   - `src/app/api/test/route.ts`
     - Generate test questions (MCQ/Comprehensive; legacy "long" still accepted) from your notes; local fallbacks if model unavailable; scoring logic on submit.
   - `src/app/api/test-questions/route.ts`
     - Read back stored questions for a given testId.

6) Session state helpers
   - `src/app/api/state/active-docs/route.ts`
     - Tracks whether you have active uploads in this session.

7) Auth endpoints (optional now, useful later)
   - `src/app/api/auth/{signup,login,logout,me}/route.ts`
     - Minimal email+password auth using `bcryptjs` and `iron-session`.

Outcome: You can explain how a file becomes searchable chunks, how chat answers are grounded in those chunks, and how tests are generated and scored.

---

## Learning plan (what to do as you read)

- While skimming UI files:
  - Map user actions (upload, ask, generate test) to API calls.
  - Note client/server boundaries: which parts are `use client` and which are server routes.

- While reading APIs:
  - For each route, identify: input schema (zod), side effects (DB writes), and output shape.
  - Trace session usage: where `userId` and `currentDocIds` matter.
  - Track failure modes: missing API key, empty docs, parse errors, etc.

- While reading server utilities:
  - Chunking: why overlap exists; think about token budgets.
  - Embeddings: know the local fallback and why it exists.
  - Similarity: how cosine is computed and used to rank chunks.

- Take notes in three buckets:
  1) “I understand” — parts you can explain back.
  2) “Questions” — unclear choices or behaviors.
  3) “Ideas” — improvements or experiments to try later.

---

## Hands‑on checkpoints (no code changes required)

- Concept check 1: Explain the end‑to‑end path of a PDF from upload to being used in a chat answer.
- Concept check 2: Given a chat message, name which tables and helpers are used.
- Concept check 3: For a test run, describe how questions are generated, stored, fetched, and scored.
- Optional: Try the diagnostic endpoint `GET /api/diag/ai` in your browser to see model/embedding status.

---

## Suggested deep dives (after the tour)

- Retrieval quality: experiment with `chunkText` size/overlap and `topK` to see answer quality vs. latency trade‑offs.
- Test generation: adjust prompts in `generateJSON` usage for clearer MCQs; add distractor logic.
- Persistence: add DB indexes (e.g., on `documents.userId`, `chunks.documentId`) for scale.
- UX: add source citations in the chat UI (show which chunk IDs or excerpts were used).
- Streaming: upgrade chat responses to stream for better perceived latency.

---

## Mental model (keep this picture in your head)

- Upload → parse → chunk → embed → store
- Query → embed → rank top‑K → prompt with context → generate answer
- Tests → sample content → generate JSON → persist → fetch → submit/score
- Session holds `userId` and `currentDocIds` so chat/test only use your latest uploads

---

## File index (quick reference)

- App shell: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/middleware.ts`
- Pages: `src/app/dashboard/page.tsx`, `src/app/chat/page.tsx`, `src/app/test/page.tsx`, `src/app/test/TestClient.tsx`
- Components: `src/components/AIChatCard.tsx`, `src/components/HeroGeometric.tsx`, `src/components/BackgroundPaths.tsx`, `src/components/SessionFreshReset.tsx`, others in `src/components/`
- API routes: `src/app/api/upload/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/test/route.ts`, `src/app/api/test-questions/route.ts`, `src/app/api/state/active-docs/route.ts`, `src/app/api/auth/*`
- Server utilities: `src/server/db.ts`, `src/server/session.ts`, `src/server/rag.ts`, `src/server/ai.ts`
- Helpers: `src/lib/utils.ts`

---

## FAQs

- Do I need an API key to learn the project?
  - No. The embedding step has a local fallback. Chat/test generation try Gemini first, then use conservative/local fallbacks if unavailable. You can still understand and walk through the flows.

- Where is data stored?
  - SQLite in the project folder by default (`./data.sqlite` plus WAL files). Tables are created automatically on first run.

- Why don’t my uploads persist after a hard refresh?
  - The session intentionally clears active docs on a full page reload (see `SessionFreshReset`). Upload again to start fresh.

---

Happy exploring! Use this plan as your checklist; once you can narrate each flow from file to file, you’ve learned the project.
