import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { issueResetToken } from "@/lib/auth/password-reset";
import { sendPasswordResetEmail } from "@/lib/email/send";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  email: z.string().email("Invalid email address"),
});

function getAppUrl(request: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest) {
  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (!parsed.success) {
    // Don't leak validation details — we always want to respond the same way.
    return NextResponse.json({ ok: true });
  }

  const email = parsed.data.email.toLowerCase();

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user) {
      const token = await issueResetToken(user.id);
      const resetUrl = `${getAppUrl(request)}/reset/${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
  } catch (err) {
    console.error("[forgot] Failed to issue reset:", err);
    // Still return 200 so attackers cannot probe for valid emails.
  }

  return NextResponse.json({ ok: true });
}
