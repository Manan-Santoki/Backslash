import { db } from "@/lib/db";
import { labels, projectLabels } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/labels ────────────────────────────────
// Fetch all labels for the authenticated user.

export async function GET(request: NextRequest) {
    return withAuth(request, async (_req, user) => {
        try {
            const userLabels = await db
                .select()
                .from(labels)
                .where(eq(labels.userId, user.id));

            return NextResponse.json(
                {labels: userLabels},
                {
                    headers: {
                        "Cache-Control": "no-store",
                    },
                }
            );
        } catch (error) {
            console.error("Error fetching labels:", error);
            return NextResponse.json(
                {error: "Internal server error"},
                {status: 500}
            );
        }
    });
}