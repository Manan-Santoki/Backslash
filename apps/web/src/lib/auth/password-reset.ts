import crypto from "crypto";
import { db } from "@/lib/db";
import { passwordResetTokens, users } from "@/lib/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MINUTES = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueResetToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return raw;
}

export interface ConsumedToken {
  userId: string;
  userEmail: string;
}

/**
 * Consume a reset token. Returns null if the token is missing, expired, or used.
 * On success, marks it used and returns the owner's userId + email.
 */
export async function consumeResetToken(
  token: string,
): Promise<ConsumedToken | null> {
  const tokenHash = hashToken(token);

  const rows = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      userEmail: users.email,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, new Date()),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  // Mark used atomically; if someone else raced us, treat as not consumed.
  const updated = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, row.id),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .returning({ id: passwordResetTokens.id });

  if (updated.length === 0) return null;
  return { userId: row.userId, userEmail: row.userEmail };
}
