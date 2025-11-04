import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { z } from "zod";
import { getDb } from "@/server/db";
import { v4 as uuid } from "uuid";
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
  const userExists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (userExists) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, passwordHash, createdAt) VALUES (?, ?, ?, ?)").run(id, email, passwordHash, now);
  const session = await getSession();
  session.userId = id;
  await session.save();
  return NextResponse.json({ id, email });
}


