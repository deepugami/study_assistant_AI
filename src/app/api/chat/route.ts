import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { z } from "zod";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { embedText, generateTextSmart } from "@/server/ai";
import crypto from "node:crypto";

const schema = z.object({
  message: z.string().min(1),
  deep: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  // Auth-less mode: getSession always provides a default user id
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { message, deep: requestedDeep } = parsed.data;
  const db = getDb();
  const qEmb = await embedText(message);
  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  if (activeIds.length === 0) {
    return NextResponse.json({
      answer: "No active document selected. Please upload a file on the dashboard and try again.",
      sources: [],
      fallback: true,
    });
  }
  const placeholders = activeIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, content, embedding FROM chunks WHERE documentId IN (${placeholders})`).all(...activeIds) as { id: string; content: string; embedding: string }[];
  const scored = rows.map(r => ({ id: r.id, text: r.content, score: similarity(qEmb, JSON.parse(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const context = scored.map(s => s.text).join("\n---\n");
  const prompt = `You are a helpful study assistant. Answer the user's question using ONLY the provided context. If the context is not enough, say you are not sure. Be concise by default.\n\nContext:\n${context}\n\nUser: ${message}\nAssistant:`;
  const deepByContext = context.length > 2000 || scored.length >= 8;
  const useDeep = Boolean(requestedDeep) || deepByContext;

  // Cache lookup keyed by message + top chunk ids
  const key = crypto.createHash("sha256").update(JSON.stringify({ m: message, ids: scored.map(s => s.id) })).digest("hex");
  const cached = db.prepare("SELECT answer, createdAt FROM qa_cache WHERE key = ?").get(key) as { answer: string; createdAt: string } | undefined;
  if (cached) {
    const ageMs = Date.now() - new Date(cached.createdAt).getTime();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (ageMs < maxAgeMs) {
      return NextResponse.json({ answer: cached.answer, sources: scored.map(s => s.id), cached: true });
    }
  }
  try {
    const answer = await generateTextSmart(prompt, { deep: useDeep });
    db.prepare("INSERT OR REPLACE INTO qa_cache (key, answer, createdAt) VALUES (?, ?, ?)").run(key, answer, new Date().toISOString());
    return NextResponse.json({ answer, sources: scored.map(s => s.id), deep: useDeep });
  } catch (err: unknown) {
    // Fallback when LLM is unavailable: assemble a concise extractive answer
    let answer = "";
    if (!context.trim() || scored.length === 0) {
      answer = "I'm not sure yet — there are no indexed documents for this workspace. Upload files on the dashboard, then ask again.";
    } else {
      // Build a short extract from the top relevant chunks
      const top = scored.slice(0, 3).map(s => s.text);
      const bullets = top
        .map(t => t.replace(/\s+/g, " ").trim().slice(0, 240))
        .filter(Boolean)
        .map(x => `• ${x}${x.length >= 240 ? "…" : ""}`)
        .join("\n");
      answer = `I can't reach the AI model right now. Here's a concise extract from your documents that may help:\n\n${bullets}`;
    }
    return NextResponse.json({ answer, sources: scored.map(s => s.id), fallback: true });
  }
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


