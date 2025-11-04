import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null });
  }
  const db = getDb();
  const user = db.prepare("SELECT id, email, createdAt FROM users WHERE id = ?").get(session.userId);
  return NextResponse.json({ user });
}


