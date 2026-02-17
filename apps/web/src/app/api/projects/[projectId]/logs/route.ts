import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId]/logs ────────────
// Get the latest build logs with parsed error entries.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const [latestBuild] = await db
      .select()
      .from(builds)
      .where(eq(builds.projectId, projectId))
      .orderBy(desc(builds.createdAt))
      .limit(1);

    if (!latestBuild) {
      return NextResponse.json(
        { error: "No builds found for this project" },
        { status: 404 }
      );
    }

    const errors = parseLatexLog(latestBuild.logs ?? "");

    return NextResponse.json({
      build: latestBuild,
      errors,
    });
  } catch (error) {
    console.error("Error fetching build logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
