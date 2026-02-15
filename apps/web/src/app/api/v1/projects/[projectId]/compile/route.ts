import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { enqueueCompileJob } from "@/lib/compiler/compileQueue";
import { broadcastBuildUpdate } from "@/lib/websocket/server";
import { isDedicatedWorkerHealthy, isWorkerExpectedInWeb } from "@/lib/compiler/workerHealth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import type { Engine } from "@backslash/shared";

const VALID_ENGINES: Engine[] = [
  "auto",
  "pdflatex",
  "xelatex",
  "lualatex",
  "latex",
];

function isValidEngine(value: string): value is Engine {
  return VALID_ENGINES.includes(value as Engine);
}

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

      if (!isWorkerExpectedInWeb()) {
        const workerHealthy = await isDedicatedWorkerHealthy();
        if (!workerHealthy) {
          return NextResponse.json(
            { error: "Compilation worker unavailable — try again shortly" },
            { status: 503 }
          );
        }
      }

      let compileEngine: Engine = project.engine;
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        if (body && typeof body === "object" && "engine" in body) {
          const requestedEngine = (body as Record<string, unknown>).engine;
          if (typeof requestedEngine !== "string" || !isValidEngine(requestedEngine)) {
            return NextResponse.json(
              {
                error:
                  "Invalid engine. Use one of: auto, pdflatex, xelatex, lualatex, latex",
              },
              { status: 400 }
            );
          }
          compileEngine = requestedEngine;
        }
      }

      const buildId = uuidv4();

      await db.insert(builds).values({
        id: buildId,
        projectId,
        userId: user.id,
        status: "queued",
        engine: compileEngine,
      });

      await enqueueCompileJob({
        buildId,
        projectId,
        userId: user.id,
        storageUserId: user.id,
        triggeredByUserId: user.id,
        engine: compileEngine,
        mainFile: project.mainFile,
      });

      broadcastBuildUpdate(user.id, {
        projectId,
        buildId,
        status: "queued",
        triggeredByUserId: user.id,
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
