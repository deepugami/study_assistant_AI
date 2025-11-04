import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { z } from "zod";
import { getDb } from "@/server/db";
import bcrypt from "bcryptjs";
import { getSession } from "@/server/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const db = getDb();
  const user = db.prepare("SELECT id, passwordHash, email FROM users WHERE email = ?").get(email) as
    | { id: string; passwordHash: string; email: string }
    | undefined;
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const session = await getSession();
  session.userId = user.id;
  await session.save();
  return NextResponse.json({ id: user.id, email: user.email });
}


