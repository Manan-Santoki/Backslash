import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { consumeResetToken } from "@/lib/auth/password-reset";
import { authConfig } from "@/lib/auth/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().min(10, "Invalid reset link"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const consumed = await consumeResetToken(parsed.data.token);
  if (!consumed) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, authConfig.bcryptRounds);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, consumed.userId));

  return NextResponse.json({ ok: true });
}
