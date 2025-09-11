import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { generateJSON } from "@/server/ai";
import { v4 as uuid } from "uuid";

const genSchema = z.object({
  mode: z.enum(["mcq", "short", "long"]).default("mcq"),
  durationSec: z.number().min(60).max(7200).default(900),
  numQuestions: z.number().min(3).max(20).default(8),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = genSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { mode, durationSec, numQuestions } = parsed.data;

  const db = getDb();
  const rows = db.prepare("SELECT content, embedding FROM chunks WHERE documentId IN (SELECT id FROM documents WHERE userId = ?) ").all(session.userId) as { content: string; embedding: string }[];
  if (rows.length === 0) return NextResponse.json({ error: "No documents uploaded" }, { status: 400 });

  const sample = rows.slice(0, 200).map(r => r.content).join("\n\n");
  type GenOut = { questions: Array<{ id: string; type: string; question: string; options?: string[]; answerKey?: string; maxScore: number }> };
  const spec = await generateJSON<GenOut>(`Create ${numQuestions} ${mode} exam questions based strictly on the provided material. Provide an array 'questions' with objects: {id, type, question, options (for mcq), answerKey (for mcq and short), maxScore}. Use concise wording.\n\nMaterial:\n${sample}`);

  const testId = uuid();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO tests (id, userId, mode, durationSec, createdAt) VALUES (?, ?, ?, ?, ?)").run(testId, session.userId, mode, durationSec, now);
  const insertQ = db.prepare("INSERT INTO test_questions (id, testId, type, question, options, answerKey, maxScore) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const q of spec.questions) {
    insertQ.run(q.id || uuid(), testId, q.type || mode, q.question, q.options ? JSON.stringify(q.options) : null, q.answerKey ?? null, q.maxScore ?? 1);
  }

  return NextResponse.json({ testId });
}

const submitSchema = z.object({
  testId: z.string(),
  answers: z.record(z.string()),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { testId, answers } = parsed.data;
  const db = getDb();
  const submissionId = uuid();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO test_submissions (id, testId, userId, startedAt, submittedAt) VALUES (?, ?, ?, ?, ?)").run(submissionId, testId, session.userId, now, now);

  type TestQuestionRow = { id: string; type: string; question: string; options: string | null; answerKey: string | null; maxScore: number };
  const qs = db
    .prepare("SELECT id, type, question, options, answerKey, maxScore FROM test_questions WHERE testId = ?")
    .all(testId) as TestQuestionRow[];
  let score = 0;
  const insertA = db.prepare("INSERT INTO test_answers (id, submissionId, questionId, answer, scoreAwarded) VALUES (?, ?, ?, ?, ?)");
  for (const q of qs) {
    const userAns = answers[q.id] ?? "";
    let awarded = 0;
    if (q.type === "mcq") {
      if (q.answerKey && userAns.trim().toLowerCase() === String(q.answerKey).trim().toLowerCase()) awarded = q.maxScore;
    } else if (q.type === "short") {
      if (q.answerKey) {
        const a = userAns.trim().toLowerCase();
        const b = String(q.answerKey).trim().toLowerCase();
        if (a === b) awarded = q.maxScore;
      }
    } else {
      // long answer: naive 0, could be LLM graded
      awarded = 0;
    }
    score += awarded;
    insertA.run(uuid(), submissionId, q.id, userAns, awarded);
  }
  db.prepare("UPDATE test_submissions SET score = ? WHERE id = ?").run(score, submissionId);

  return NextResponse.json({ submissionId, score, maxScore: qs.reduce((s, q) => s + q.maxScore, 0), answers: qs.map(q => ({ id: q.id, correct: q.answerKey ?? null })) });
}


