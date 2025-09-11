import { NextResponse } from "next/server";
import { getDb } from "@/server/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const testId = url.searchParams.get("testId");
  if (!testId) return NextResponse.json({ error: "testId required" }, { status: 400 });
  const db = getDb();
  const rows = db.prepare("SELECT id, type, question, options FROM test_questions WHERE testId = ?").all(testId) as { id: string; type: string; question: string; options: string | null }[];
  const questions = rows.map(r => ({ id: r.id, type: r.type, question: r.question, options: r.options ? JSON.parse(r.options) : undefined }));
  return NextResponse.json({ questions });
}


