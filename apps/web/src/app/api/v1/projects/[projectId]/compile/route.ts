import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { addCompileJob } from "@/lib/compiler/runner";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/v1/projects/[projectId]/compile ──────
// Trigger compilation for a project.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const buildId = uuidv4();

      await db.insert(builds).values({
        id: buildId,
        projectId,
        userId: user.id,
        status: "queued",
        engine: project.engine,
      });

      await addCompileJob({
        buildId,
        projectId,
        userId: user.id,
        engine: project.engine,
        mainFile: project.mainFile,
      });

      return NextResponse.json(
        { buildId, status: "queued", message: "Compilation queued" },
        { status: 202 }
      );
    } catch (error) {
      console.error("[API v1] Error triggering compilation:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
