import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { shouldUseSecureCookies } from "@/lib/auth/config";
import { signSessionJwt, verifySessionJwt } from "@/lib/auth/jwt";
import { eq, and, gt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { cookies } from "next/headers";

const SESSION_EXPIRY_DAYS = parseInt(
  process.env.SESSION_EXPIRY_DAYS || "7",
  10
);

export async function createSession(userId: string): Promise<string> {
  const sessionId = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await db.insert(sessions).values({
    userId,
    token: sessionId,
    expiresAt,
  });

  return signSessionJwt({
    userId,
    sessionId,
    expiresAt,
  });
}

export async function validateSession(token: string) {
  const jwt = await verifySessionJwt(token);

  const whereClause = jwt
    ? and(
      eq(sessions.token, jwt.sessionId),
      eq(sessions.userId, jwt.userId),
      gt(sessions.expiresAt, new Date())
    )
    : and(eq(sessions.token, token), gt(sessions.expiresAt, new Date()));

  const result = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(whereClause)
    .limit(1);

  if (result.length === 0) return null;
  return result[0];
}

export async function deleteSession(token: string) {
  const jwt = await verifySessionJwt(token);
  const sessionToken = jwt?.sessionId ?? token;
  await db.delete(sessions).where(eq(sessions.token, sessionToken));
}

export async function deleteUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("session")?.value || null;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}
