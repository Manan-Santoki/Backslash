import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { demoDisabledResponse, isFeatureDisabled } from "@/lib/demo";

// ─── DELETE /api/keys/[keyId] ───────────────────────
// Delete (revoke) an API key.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  if (isFeatureDisabled("api")) {
    return demoDisabledResponse("api");
  }

  return withAuth(request, async (_req, user) => {
    try {
      const { keyId } = await params;

      const [key] = await db
        .select({ id: apiKeys.id, userId: apiKeys.userId })
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .limit(1);

      if (!key || key.userId !== user.id) {
        return NextResponse.json(
          { error: "API key not found" },
          { status: 404 }
        );
      }

      await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, user.id)));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting API key:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
