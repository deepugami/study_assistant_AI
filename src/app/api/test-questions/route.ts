import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { z } from "zod";
import { getSession } from "@/server/session";
import { generateJSON } from "@/server/ai";
import { v4 as uuid } from "uuid";

type Mode = "mcq" | "comprehensive";

const appendSchema = z.object({
  testId: z.string().min(1),
  numQuestions: z.number().min(1).max(10).default(5),
});

function normalizeText(text: string) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function buildFallbackQuestions(args: {
  mode: Mode;
  sample: string;
  count: number;
}): Array<{ question: string; type: string; options?: string[]; answerKey?: string; maxScore: number; hint?: string }> {
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
    type: "comprehensive",
    question: `Explain comprehensively: ${p.slice(0, 220)}`,
    answerKey: "Cover the key ideas and definitions mentioned.",
    maxScore: 5,
    hint: "Focus on the main idea in the passage.",
  }));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const testId = url.searchParams.get("testId");
  if (!testId) return NextResponse.json({ error: "testId required" }, { status: 400 });
  const db = getDb();
  const testRow = db.prepare("SELECT mode FROM tests WHERE id = ?").get(testId) as { mode?: string } | undefined;
  const mode = (testRow?.mode || "mcq").toLowerCase() === "long" ? "comprehensive" : (testRow?.mode || "mcq").toLowerCase();
  if (mode === "mcq") {
    const rows = db
      .prepare("SELECT id, type, question, options FROM test_questions WHERE testId = ?")
      .all(testId) as { id: string; type: string; question: string; options: string | null }[];
    const questions = rows.map(r => ({ id: r.id, type: r.type, question: r.question, options: r.options ? JSON.parse(r.options) : undefined }));
    return NextResponse.json({ questions });
  } else {
    const rows = db
      .prepare("SELECT id, type, question, answerKey, hint FROM test_questions WHERE testId = ?")
      .all(testId) as { id: string; type: string; question: string; answerKey: string | null; hint: string | null }[];
    const questions = rows.map(r => ({ id: r.id, type: r.type, question: r.question, answerKey: r.answerKey ?? undefined, hint: r.hint ?? undefined }));
    return NextResponse.json({ questions });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  const parsed = appendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { testId } = parsed.data;
  const numQuestions = Math.min(10, Math.max(1, parsed.data.numQuestions));

  const db = getDb();
  const testRow = db.prepare("SELECT mode FROM tests WHERE id = ?").get(testId) as { mode?: string } | undefined;
  const mode = ((testRow?.mode || "mcq").toLowerCase() === "long" ? "comprehensive" : (testRow?.mode || "mcq").toLowerCase()) as Mode;

  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  if (activeIds.length === 0) {
    return NextResponse.json({ error: "No active document selected. Upload a file first." }, { status: 400 });
  }
  const placeholders = activeIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT content FROM chunks WHERE documentId IN (${placeholders})`)
    .all(...activeIds) as { content: string }[];
  const sampleRaw = rows.slice(0, 250).map(r => r.content).join("\n\n");
  const sample = normalizeText(sampleRaw).slice(0, 16000);
  if (!sample) return NextResponse.json({ error: "Selected document has no readable text indexed yet" }, { status: 400 });

  const existing = db
    .prepare("SELECT question FROM test_questions WHERE testId = ? ORDER BY rowid ASC")
    .all(testId) as Array<{ question: string }>;
  const avoid = existing
    .map(r => normalizeText(r.question))
    .filter(Boolean)
    .slice(-30)
    .join("\n");

  type GenOut = { questions: Array<{ question: string; type?: string; options?: string[]; answerKey?: string; maxScore?: number; hint?: string }> };
  let spec: GenOut | null = null;
  try {
    const base = `You are an exam generator. Create ${numQuestions} additional ${mode} questions based strictly on the provided material.`;
    const common = `Rules:\n- Do NOT repeat or paraphrase any question from the avoid-list.\n- Keep wording concise and unambiguous.\n- Provide a helpful hint per question (<= 20 words).`;
    const mcq = `Provide JSON ONLY in this shape: {"questions": [{"type":"mcq","question":"...","options":["option 1","option 2","option 3","option 4"],"answerKey":"exact option text that is correct","maxScore":1,"hint":"..."}]}`;
    const comprehensive = `Provide JSON ONLY in this shape: {"questions": [{"type":"comprehensive","question":"...","answerKey":"expected key points to look for","maxScore":5,"hint":"..."}]}`;
    const shape = mode === "mcq" ? mcq : comprehensive;
    const prompt = `${base}\n${common}\n\nAvoid-list (do not repeat):\n${avoid || "<none>"}\n\nMaterial:\n${sample}\n\n${shape}`;
    spec = await generateJSON<GenOut>(prompt);
  } catch {
    spec = null;
  }

  const questions = (spec?.questions || []).filter(q => q && typeof q.question === "string" && q.question.trim());
  const normalizedExisting = new Set(existing.map(r => normalizeText(r.question)));
  const unique = questions.filter(q => !normalizedExisting.has(normalizeText(q.question)));
  const final = unique.length >= numQuestions
    ? unique.slice(0, numQuestions)
    : [...unique, ...buildFallbackQuestions({ mode, sample, count: numQuestions - unique.length })].slice(0, numQuestions);

  const insertQ = db.prepare("INSERT INTO test_questions (id, testId, type, question, options, answerKey, maxScore, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertedIds: string[] = [];
  for (const q of final) {
    const qid = uuid();
    insertedIds.push(qid);
    const qtype = q.type === "long" ? "comprehensive" : q.type || mode;
    const opts = q.options ? JSON.stringify(q.options.slice(0, 8)) : null;
    const key = q.answerKey ?? null;
    const max = typeof q.maxScore === "number" && q.maxScore > 0 ? q.maxScore : (qtype === "comprehensive" ? 5 : 1);
    const hint = q.hint ?? null;
    insertQ.run(qid, testId, qtype, q.question, opts, key, max, hint);
  }

  const ph = insertedIds.map(() => "?").join(",");
  if (mode === "mcq") {
    const rows2 = db
      .prepare(`SELECT id, type, question, options FROM test_questions WHERE id IN (${ph})`)
      .all(...insertedIds) as { id: string; type: string; question: string; options: string | null }[];
    const out = rows2.map(r => ({ id: r.id, type: r.type, question: r.question, options: r.options ? JSON.parse(r.options) : undefined }));
    return NextResponse.json({ questions: out });
  } else {
    const rows2 = db
      .prepare(`SELECT id, type, question, answerKey, hint FROM test_questions WHERE id IN (${ph})`)
      .all(...insertedIds) as { id: string; type: string; question: string; answerKey: string | null; hint: string | null }[];
    const out = rows2.map(r => ({ id: r.id, type: r.type, question: r.question, answerKey: r.answerKey ?? undefined, hint: r.hint ?? undefined }));
    return NextResponse.json({ questions: out });
  }
}


