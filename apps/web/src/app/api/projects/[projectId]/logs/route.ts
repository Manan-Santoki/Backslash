import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId]/logs ────────────
// Get the latest build logs with parsed error entries.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
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
  });
}
