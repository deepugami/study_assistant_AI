import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  const activeIds = Array.isArray(session.currentDocIds) ? session.currentDocIds.filter(Boolean) : [];
  return NextResponse.json({ hasActiveDocs: activeIds.length > 0 });
}

export async function DELETE() {
  const session = await getSession();
  session.currentDocIds = [];
  try { await session.save(); } catch {}
  return NextResponse.json({ ok: true, hasActiveDocs: false });
}
