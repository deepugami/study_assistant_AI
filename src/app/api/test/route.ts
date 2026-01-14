import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { z } from "zod";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { generateJSON } from "@/server/ai";
import { v4 as uuid } from "uuid";

type Mode = "mcq" | "comprehensive";

const genSchema = z.object({
  // Accept legacy "long" but normalize to "comprehensive" for consistency
  mode: z.enum(["mcq", "comprehensive", "long"]).default("mcq").transform((m) => (m === "long" ? "comprehensive" : m)) as z.ZodType<Mode>,
  durationSec: z.number().min(60).max(7200).default(900),
  // App UX expects a solid initial set of questions
  numQuestions: z.number().min(1).max(20).default(10),
});

function normalizeText(text: string) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function buildFallbackQuestions(args: {
  mode: Mode;
  sample: string;
  count: number;
}): Array<{ id?: string; type?: string; question: string; options?: string[]; answerKey?: string; maxScore?: number; hint?: string }> {
  const { mode, sample, count } = args;
  const paras = sample.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const source = paras.length ? paras : [sample];
  const picked = Array.from({ length: count }, (_, i) => source[i % source.length]);

  if (mode === "mcq") {
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
      options.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
      return {
        id: undefined,
        type: "mcq",
        question: `Fill in the blank: ${blanked.slice(0, 200)}`,
        options,
        answerKey: correct,
        maxScore: 1,
        hint: "Recall the exact word used in the passage.",
      };
    }
    return picked.map(buildMcqQ);
  }
  return picked.map((p) => ({
    id: undefined,
    type: "comprehensive",
    question: `Explain comprehensively: ${p.slice(0, 220)}`,
    options: undefined,
    answerKey: "Cover the key ideas and definitions mentioned.",
    maxScore: 5,
    hint: "Focus on the main idea in the passage.",
  }));
}

export async function POST(req: Request) {
  const session = await getSession();
  const body = await req.json();
  const parsed = genSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { mode, durationSec } = parsed.data;
  const requested = parsed.data.numQuestions;
  const numQuestions = Math.min(20, Math.max(10, requested));

  const db = getDb();
  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  if (activeIds.length === 0) return NextResponse.json({ error: "No active document selected. Upload a file first." }, { status: 400 });
  const placeholders = activeIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT content, embedding FROM chunks WHERE documentId IN (${placeholders})`).all(...activeIds) as { content: string; embedding: string }[];
  if (rows.length === 0) return NextResponse.json({ error: "Selected document has no content indexed yet" }, { status: 400 });

  const sampleRaw = rows.slice(0, 250).map(r => r.content).join("\n\n");
  const sample = normalizeText(sampleRaw).slice(0, 16000);
  if (!sample) {
    return NextResponse.json({ error: "Selected document has no readable text indexed yet" }, { status: 400 });
  }
  type GenOut = { questions: Array<{ id?: string; type?: string; question: string; options?: string[]; answerKey?: string; maxScore?: number; hint?: string }> };
  let spec: GenOut;
  try {
    const base = `You are an exam generator. Create ${numQuestions} ${mode} questions based strictly on the provided material.`;
    const common = `Rules:\n- Keep wording concise and unambiguous.\n- Provide a helpful hint per question (<= 20 words).`;
    const mcq = `Provide JSON ONLY in this shape: {"questions": [{"id":"uuid","type":"mcq","question":"...","options":["option text 1","option text 2","option text 3","option text 4"],"answerKey":"exact option text that is correct","maxScore":1,"hint":"why the answer is correct"}]}`;
    const comprehensive = `Provide JSON ONLY in this shape: {"questions": [{"id":"uuid","type":"comprehensive","question":"...","answerKey":"expected key points to look for","maxScore":5,"hint":"what to cover"}]}`;
    const shape = mode === "mcq" ? mcq : comprehensive;
    const prompt = `${base}\n${common}\n\nMaterial:\n${sample}\n\n${shape}`;
    spec = await generateJSON<GenOut>(prompt);
  } catch (e: any) {
    // Local fallback when model is unavailable or API key missing
    spec = { questions: buildFallbackQuestions({ mode, sample, count: numQuestions }) };
  }

  // Enforce at least `numQuestions` even if the model returns fewer
  if (!spec?.questions) spec = { questions: [] };
  spec.questions = spec.questions.filter(q => q && typeof q.question === "string" && q.question.trim().length > 0);
  if (spec.questions.length < numQuestions) {
    const extra = buildFallbackQuestions({ mode, sample, count: numQuestions - spec.questions.length });
    spec.questions = [...spec.questions, ...extra];
  }
  spec.questions = spec.questions.slice(0, numQuestions);

  const testId = uuid();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO tests (id, userId, mode, durationSec, createdAt) VALUES (?, ?, ?, ?, ?)").run(testId, session.userId, mode, durationSec, now);
  const insertQ = db.prepare("INSERT INTO test_questions (id, testId, type, question, options, answerKey, maxScore, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const q of spec.questions) {
    if (!q?.question) continue;
    const qid = q.id || uuid();
    const qtype = q.type === "long" ? "comprehensive" : q.type || mode;
    const opts = q.options ? JSON.stringify(q.options.slice(0, 8)) : null;
    const key = q.answerKey ?? null;
    const max = typeof q.maxScore === "number" && q.maxScore > 0 ? q.maxScore : (qtype === "comprehensive" ? 5 : 1);
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

    const qTypeNorm = q.type === "long" ? "comprehensive" : q.type;

    if (qTypeNorm === "mcq") {
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
    } else {
      // comprehensive answer: naive 0, could be LLM graded later (kept deterministic per user's request)
      awarded = 0;
    }
    score += awarded;
    insertA.run(uuid(), submissionId, q.id, userAns, awarded);
    breakdown.push({ id: q.id, userAnswer: userAns, correctAnswer: correctAnswerText, isCorrect: awarded > 0, hint: q.hint ?? null });
  }
  db.prepare("UPDATE test_submissions SET score = ? WHERE id = ?").run(score, submissionId);

  return NextResponse.json({ submissionId, score, maxScore: qs.reduce((s, q) => s + q.maxScore, 0), breakdown });
}


