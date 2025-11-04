import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { getSession } from "@/server/session";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}


