import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { builds, projects } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { cancelCompileJob } from "@/lib/compiler/runner";
import { broadcastBuildUpdate } from "@/lib/websocket/server";

// ─── POST /api/projects/[projectId]/cancel ─────────
// Cancel the latest queued/compiling build for a project.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role === "viewer") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    const [build] = await db
      .select({
        id: builds.id,
        status: builds.status,
        createdAt: builds.createdAt,
      })
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          inArray(builds.status, ["queued", "compiling"])
        )
      )
      .orderBy(desc(builds.createdAt))
      .limit(1);

    if (!build) {
      return NextResponse.json(
        { error: "No running build found" },
        { status: 404 }
      );
    }

    const actorUserId = access.user?.id ?? access.project.userId;
    const { wasQueued, wasRunning } = await cancelCompileJob(build.id);

    if (wasQueued && !wasRunning) {
      const durationMs = build.createdAt
        ? Date.now() - build.createdAt.getTime()
        : 0;

      await db
        .update(builds)
        .set({
          status: "canceled",
          logs: "Build canceled by user.",
          durationMs,
          exitCode: -1,
          completedAt: new Date(),
        })
        .where(eq(builds.id, build.id));

      await db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      broadcastBuildUpdate(actorUserId, {
        projectId,
        buildId: build.id,
        status: "canceled",
        pdfUrl: null,
        logs: "Build canceled by user.",
        durationMs,
        errors: [],
        triggeredByUserId: actorUserId,
      });
    }

    return NextResponse.json(
      {
        buildId: build.id,
        status: "canceled",
        message: "Cancel request accepted",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error canceling build:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
