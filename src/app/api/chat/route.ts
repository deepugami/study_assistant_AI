import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { embedText, generateText } from "@/server/ai";

const schema = z.object({
  message: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { message } = parsed.data;
  const db = getDb();
  const qEmb = await embedText(message);
  const rows = db.prepare("SELECT id, content, embedding FROM chunks WHERE documentId IN (SELECT id FROM documents WHERE userId = ?) ").all(session.userId) as { id: string; content: string; embedding: string }[];
  const scored = rows.map(r => ({ id: r.id, text: r.content, score: similarity(qEmb, JSON.parse(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const context = scored.map(s => s.text).join("\n---\n");
  const prompt = `You are a helpful study assistant. Answer the user's question using ONLY the provided context. If the context is not enough, say you are not sure.\n\nContext:\n${context}\n\nUser: ${message}\nAssistant:`;
  const answer = await generateText(prompt);
  return NextResponse.json({ answer, sources: scored.map(s => s.id) });
}

function similarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
  }
  for (let i = 0; i < b.length; i++) nb += b[i] * b[i];
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}


