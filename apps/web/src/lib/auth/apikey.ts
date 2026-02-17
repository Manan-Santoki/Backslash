import crypto from "crypto";
import { db } from "@/lib/db";
import { apiKeys, users } from "@/lib/db/schema";
import { eq, and, gt, or, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── Key Generation ─────────────────────────────────

const KEY_PREFIX = "bs_";
const KEY_BYTES = 32;

/**
 * Generate a new API key.
 * Returns { key, keyHash, keyPrefix } — `key` is only shown once.
 */
export function generateApiKey(): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const rawBytes = crypto.randomBytes(KEY_BYTES);
  const key = KEY_PREFIX + rawBytes.toString("base64url");
  const keyHash = hashApiKey(key);
  const keyPrefix = key.substring(0, KEY_PREFIX.length + 8);
  return { key, keyHash, keyPrefix };
}

/**
 * Hash an API key for storage (SHA-256).
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ─── Authenticated User from API Key ────────────────

export interface ApiKeyUser {
  id: string;
  email: string;
  name: string;
  apiKeyId: string;
}

/**
 * Validate an API key and return the user it belongs to.
 * Also bumps lastUsedAt and requestCount.
 */
export async function validateApiKey(
  key: string
): Promise<ApiKeyUser | null> {
  const keyHash = hashApiKey(key);

  const result = await db
    .select({
      apiKey: apiKeys,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
      },
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
      )
    )
    .limit(1);

  if (result.length === 0) return null;

  const { apiKey, user } = result[0];

  // Update usage stats (fire-and-forget)
  db.update(apiKeys)
    .set({
      lastUsedAt: new Date(),
      requestCount: sql`${apiKeys.requestCount} + 1`,
    })
    .where(eq(apiKeys.id, apiKey.id))
    .catch(() => {}); // swallow errors

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    apiKeyId: apiKey.id,
  };
}

// ─── Middleware: withApiKey ──────────────────────────

/**
 * Protect an API route with API key authentication.
 * Expects `Authorization: Bearer bs_...` header.
 */
export async function withApiKey(
  request: NextRequest,
  handler: (req: NextRequest, user: ApiKeyUser) => Promise<NextResponse>
): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "API key required. Set the Authorization header to: Bearer bs_...",
      },
      { status: 401 }
    );
  }

  const key = authHeader.slice(7).trim();

  if (!key.startsWith(KEY_PREFIX)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Invalid API key format.",
      },
      { status: 401 }
    );
  }

  const user = await validateApiKey(key);

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Invalid or expired API key.",
      },
      { status: 401 }
    );
  }

  return handler(request, user);
}
