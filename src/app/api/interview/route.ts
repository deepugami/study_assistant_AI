import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { z } from "zod";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { embedText, generateTextSmart } from "@/server/ai";
import { v4 as uuid } from "uuid";

const postSchema = z.object({
  message: z.string().min(1),
  deep: z.boolean().optional(),
});

// GET initializes/returns the interview session and messages
export async function GET() {
  const session = await getSession();
  const db = getDb();
  // Always reset to a fresh interview session on page load/refresh
  const s = session as unknown as import("iron-session").IronSession<{ currentInterviewChatId?: string; userId?: string; currentDocIds?: string[] }>;
  const prevChatId = s.currentInterviewChatId;
  if (prevChatId) {
    try {
      db.prepare("DELETE FROM messages WHERE chatId = ?").run(prevChatId);
      db.prepare("DELETE FROM chats WHERE id = ?").run(prevChatId);
    } catch {}
  }
  const chatId = uuid();
  db.prepare("INSERT INTO chats (id, userId, createdAt) VALUES (?, ?, ?)").run(chatId, session.userId, new Date().toISOString());
  session.currentInterviewChatId = chatId;
  try { await session.save(); } catch {}
  const seed = `Your name is Rudrak. You are a strict but supportive interviewer. Conduct a mock interview tailored to the candidate's uploaded resume. Ask one question at a time, provide brief feedback, and adjust difficulty based on answers. Keep responses concise unless asked for depth.`;
  db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)")
    .run(uuid(), chatId, "system", seed, new Date().toISOString());
  const msgs = db.prepare("SELECT role, content, createdAt FROM messages WHERE chatId = ? ORDER BY createdAt ASC").all(chatId) as Array<{ role: string; content: string; createdAt: string }>;
  return NextResponse.json({ chatId, messages: msgs });
}

// POST handles a user reply and returns interviewer response grounded in resume docs
export async function POST(req: Request) {
  const session = await getSession();
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { message, deep } = parsed.data;

  const db = getDb();
  let chatId = session.currentInterviewChatId;
  if (!chatId) {
    chatId = uuid();
    db.prepare("INSERT INTO chats (id, userId, createdAt) VALUES (?, ?, ?)").run(chatId, session.userId, new Date().toISOString());
    session.currentInterviewChatId = chatId;
    try { await session.save(); } catch {}
  }

  // Persist user message
  db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)")
    .run(uuid(), chatId, "user", message, new Date().toISOString());

  // Build resume-grounded context from active documents
  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  const qEmb = await embedText(message);
  let context = "";
  let sources: string[] = [];
  if (activeIds.length) {
    const placeholders = activeIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id, content, embedding FROM chunks WHERE documentId IN (${placeholders})`).all(...activeIds) as { id: string; content: string; embedding: string }[];
    const scored = rows.map(r => ({ id: r.id, text: r.content, score: similarity(qEmb, JSON.parse(r.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    context = scored.map(s => s.text).join("\n---\n");
    sources = scored.map(s => s.id);
  }

  const interviewPrompt = `You are an experienced interviewer named Rudrak.
Use the candidate's resume context to tailor questions and feedback. Keep it professional, structured, and concise. Ask one question at a time, then wait for the candidate's response. If the candidate asks for guidance, provide constructive hints.

Resume Context (if any):\n${context || "<none>"}

Conversation so far should be respected. Now the candidate says: ${message}
Your interviewer response:`;

  try {
    const answer = await generateTextSmart(interviewPrompt, { deep: Boolean(deep) });
    // Persist assistant message
    db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run(uuid(), chatId, "assistant", answer, new Date().toISOString());
    return NextResponse.json({ answer, sources });
  } catch (_e) {
    const fallback = context
      ? `I'll proceed without AI. Based on your resume context, here's a question: ${firstLine(context)}\nPlease answer, and I'll follow up.`
      : "I can't reach the AI model right now. Please try again later or upload your resume to personalize the interview.";
    db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run(uuid(), chatId, "assistant", fallback, new Date().toISOString());
    return NextResponse.json({ answer: fallback, sources, fallback: true });
  }
}

function similarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; }
  for (let i = 0; i < b.length; i++) nb += b[i] * b[i];
  const denom = Math.sqrt(na) * Math.sqrt(nb) + 1e-8;
  return denom ? dot / denom : 0;
}

function firstLine(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 200);
}
