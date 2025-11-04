import { IronSession, getIronSession } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  userId?: string;
  currentDocIds?: string[];
};

const sessionOptions = {
  password: process.env.SESSION_SECRET || "dev-secret-change-me-please-1234567890",
  cookieName: "study_assistant_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    httpOnly: true,
    path: "/",
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  // Remove auth: ensure a default public user id so APIs can operate without login
  if (!session.userId) {
    session.userId = "public";
    try { await session.save(); } catch {}
  }
  return session;
}


