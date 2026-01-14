import { NextResponse } from "next/server";
export const runtime = "nodejs";
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
  const body = await req.json();
  const parsed = genSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { mode, durationSec, numQuestions } = parsed.data;

  const db = getDb();
  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  if (activeIds.length === 0) return NextResponse.json({ error: "No active document selected. Upload a file first." }, { status: 400 });
  const placeholders = activeIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT content, embedding FROM chunks WHERE documentId IN (${placeholders})`).all(...activeIds) as { content: string; embedding: string }[];
  if (rows.length === 0) return NextResponse.json({ error: "Selected document has no content indexed yet" }, { status: 400 });

  const sample = rows.slice(0, 200).map(r => r.content).join("\n\n");
  type GenOut = { questions: Array<{ id?: string; type?: string; question: string; options?: string[]; answerKey?: string; maxScore?: number; hint?: string }> };
  let spec: GenOut;
  try {
    const base = `You are an exam generator. Create ${numQuestions} ${mode} questions based strictly on the provided material.`;
    const common = `Rules:\n- Keep wording concise and unambiguous.\n- Provide a helpful hint per question (<= 20 words).`;
    const mcq = `Provide JSON ONLY in this shape: {"questions": [{"id":"uuid","type":"mcq","question":"...","options":["option text 1","option text 2","option text 3","option text 4"],"answerKey":"exact option text that is correct","maxScore":1,"hint":"why the answer is correct"}]}`;
    const short = `Provide JSON ONLY in this shape: {"questions": [{"id":"uuid","type":"short","question":"...","answerKey":"expected short answer text","maxScore":1,"hint":"why the answer is correct"}]}`;
    const long = `Provide JSON ONLY in this shape: {"questions": [{"id":"uuid","type":"long","question":"...","answerKey":"expected key points to look for","maxScore":5,"hint":"what to cover"}]}`;
    const shape = mode === "mcq" ? mcq : mode === "short" ? short : long;
    const prompt = `${base}\n${common}\n\nMaterial:\n${sample}\n\n${shape}`;
    spec = await generateJSON<GenOut>(prompt);
  } catch (e: any) {
    // Local fallback when model is unavailable or API key missing
    const paras = sample.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    const picked = paras.slice(0, Math.max(1, Math.min(numQuestions, paras.length)));
    if (mode === "mcq") {
      // Build simple cloze-style MCQs without external AI
      const allWords = sample
        .split(/[^A-Za-z]+/)
        .map(w => w.trim())
        .filter(w => w.length >= 4 && w.length <= 14);
      function pickDistractors(correct: string, k = 3): string[] {
        const pool = allWords.filter(w => w.toLowerCase() !== correct.toLowerCase());
        const set = new Set<string>();
        for (let i = 0; i < pool.length && set.size < k; i++) {
          const cand = pool[(i * 131 + correct.length * 17) % pool.length];
          if (!set.has(cand) && cand.length >= Math.max(4, Math.min(10, correct.length + 2))) set.add(cand);
        }
        const arr = Array.from(set);
        while (arr.length < k) arr.push("None of the above");
        return arr.slice(0, k);
      }
      function buildMcqQ(p: string) {
        const sentences = p.split(/(?<=[\.!?])\s+/).filter(Boolean);
        const s = sentences[0] || p;
        const words = s.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
        const target = words.find(w => w.replace(/[^A-Za-z]/g, "").length >= 5) || words[0] || "term";
        const targetClean = target.replace(/[^A-Za-z]/g, "");
        const blanked = s.replace(new RegExp(targetClean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "____");
        const correct = targetClean;
        const distractors = pickDistractors(correct, 3);
        const options = [correct, ...distractors].slice(0, 4);
        // deterministic shuffle
        options.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
        return {
          id: undefined,
          type: "mcq",
          question: `Fill in the blank: ${blanked.slice(0, 200)}`,
          options,
          answerKey: correct,
          maxScore: 1,
          hint: "Recall the exact word used in the passage.",
        } as GenOut["questions"][number];
      }
      const qs = picked.map(buildMcqQ);
      spec = { questions: qs };
    } else {
      spec = {
        questions: picked.map((p) => ({
          id: undefined,
          type: mode,
          question: mode === "short" ? `Answer in one line: ${p.slice(0, 180)}` : `Explain briefly: ${p.slice(0, 220)}`,
          options: undefined,
          answerKey: mode === "short" ? p.slice(0, 140) : "Cover the key ideas and definitions mentioned.",
          maxScore: mode === "short" ? 1 : 5,
          hint: "Focus on the main idea in the passage."
        }))
      };
    }
  }
  if (!spec?.questions || spec.questions.length === 0) {
    // Last-resort fallback for all modes
    const paras = sample.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    const picked = paras.slice(0, Math.max(1, Math.min(numQuestions, paras.length)));
    if (mode === "mcq") {
      spec = {
        questions: picked.map((p) => ({
          id: undefined,
          type: "mcq",
          question: `Which statement best matches the material? ${p.slice(0, 160)}`,
          options: [p.slice(0, 60), "A related but different point", "An unrelated detail", "None of the above"],
          answerKey: p.slice(0, 60),
          maxScore: 1,
          hint: "Look for the precise phrasing."
        }))
      };
    } else {
      spec = {
        questions: picked.map((p) => ({
          id: undefined,
          type: mode,
          question: mode === "short" ? `Answer in one line: ${p.slice(0, 180)}` : `Explain briefly: ${p.slice(0, 220)}`,
          options: undefined,
          answerKey: mode === "short" ? p.slice(0, 140) : "Cover the key ideas and definitions mentioned.",
          maxScore: mode === "short" ? 1 : 5,
          hint: "Focus on the main idea in the passage."
        }))
      };
    }
  }

  const testId = uuid();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO tests (id, userId, mode, durationSec, createdAt) VALUES (?, ?, ?, ?, ?)").run(testId, session.userId, mode, durationSec, now);
  const insertQ = db.prepare("INSERT INTO test_questions (id, testId, type, question, options, answerKey, maxScore, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const q of spec.questions) {
    if (!q?.question) continue;
    const qid = q.id || uuid();
    const qtype = q.type || mode;
    const opts = q.options ? JSON.stringify(q.options.slice(0, 8)) : null;
    const key = q.answerKey ?? null;
    const max = typeof q.maxScore === "number" && q.maxScore > 0 ? q.maxScore : 1;
    const hint = q.hint ?? null;
    insertQ.run(qid, testId, qtype, q.question, opts, key, max, hint);
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

  type TestQuestionRow = { id: string; type: string; question: string; options: string | null; answerKey: string | null; maxScore: number; hint?: string | null };
  const qs = db
    .prepare("SELECT id, type, question, options, answerKey, maxScore, hint FROM test_questions WHERE testId = ?")
    .all(testId) as TestQuestionRow[];
  let score = 0;
  const insertA = db.prepare("INSERT INTO test_answers (id, submissionId, questionId, answer, scoreAwarded) VALUES (?, ?, ?, ?, ?)");
  const breakdown: Array<{ id: string; userAnswer: string; correctAnswer: string | null; isCorrect: boolean; hint: string | null }> = [];

  const normalize = (s: string | null | undefined) =>
    (s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();

  const letterToIndex: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };

  for (const q of qs) {
    const userAns = answers[q.id] ?? "";
    let awarded = 0;
    let correctAnswerText: string | null = q.answerKey ?? null;

    if (q.type === "mcq") {
      const opts: string[] = q.options ? (() => { try { return JSON.parse(q.options as string) as string[]; } catch { return []; } })() : [];
      const keyNorm = normalize(q.answerKey);
      const userNorm = normalize(userAns);
      // If the answerKey is a letter (A-D), map to option text
      if (keyNorm in letterToIndex && opts.length) {
        const idx = letterToIndex[keyNorm as keyof typeof letterToIndex];
        correctAnswerText = typeof opts[idx] === "string" ? opts[idx] : null;
      }
      const correctNorm = normalize(correctAnswerText);
      if (userNorm && correctNorm && userNorm === correctNorm) {
        awarded = q.maxScore;
      }
    } else if (q.type === "short") {
      if (q.answerKey) {
        const a = normalize(userAns);
        const b = normalize(String(q.answerKey));
        if (a && b && a === b) awarded = q.maxScore;
      }
    } else {
      // long answer: naive 0, could be LLM graded later (kept deterministic per user's request)
      awarded = 0;
    }
    score += awarded;
    insertA.run(uuid(), submissionId, q.id, userAns, awarded);
    breakdown.push({ id: q.id, userAnswer: userAns, correctAnswer: correctAnswerText, isCorrect: awarded > 0, hint: q.hint ?? null });
  }
  db.prepare("UPDATE test_submissions SET score = ? WHERE id = ?").run(score, submissionId);

  return NextResponse.json({ submissionId, score, maxScore: qs.reduce((s, q) => s + q.maxScore, 0), breakdown });
}


