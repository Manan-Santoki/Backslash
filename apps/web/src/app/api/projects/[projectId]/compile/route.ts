import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { enqueueCompileJob } from "@/lib/compiler/compileQueue";
import { broadcastBuildUpdate } from "@/lib/websocket/server";
import { healthCheck as dockerHealthCheck, getDockerClient } from "@/lib/compiler/docker";
import {
  isDedicatedWorkerHealthy,
  isWorkerExpectedInWeb,
} from "@/lib/compiler/workerHealth";
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

// ─── POST /api/projects/[projectId]/compile ────────
// Trigger compilation for a project. Owner and editors can compile.

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

    const project = access.project;
    const storageUserId = project.userId;
    const actorUserId = access.user?.id ?? null;
    const buildUserId = access.user?.id ?? storageUserId;
    const runnerExpectedInWeb = isWorkerExpectedInWeb();
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

    if (runnerExpectedInWeb) {
      // ── Pre-flight: verify Docker is reachable ───────
      const dockerOk = await dockerHealthCheck();
      if (!dockerOk) {
        console.error("[Compile] Docker daemon is not reachable");
        return NextResponse.json(
          { error: "Compilation service unavailable — Docker daemon not reachable" },
          { status: 503 }
        );
      }

      // ── Pre-flight: verify compiler image exists ─────
      try {
        const docker = getDockerClient();
        const compilerImage = process.env.COMPILER_IMAGE || "backslash-compiler";
        const images = await docker.listImages({
          filters: { reference: [compilerImage] },
        });
        if (images.length === 0) {
          console.error(`[Compile] Compiler image "${compilerImage}" not found`);
          return NextResponse.json(
            { error: `Compiler image "${compilerImage}" not found on Docker host` },
            { status: 503 }
          );
        }
      } catch (imgErr) {
        console.error("[Compile] Failed to check compiler image:", imgErr);
        return NextResponse.json(
          { error: "Compilation service unavailable — unable to verify compiler image" },
          { status: 503 }
        );
      }
    } else {
      const workerHealthy = await isDedicatedWorkerHealthy();
      if (!workerHealthy) {
        return NextResponse.json(
          { error: "Compilation worker unavailable — try again shortly" },
          { status: 503 }
        );
      }
    }

    const buildId = uuidv4();

    // Create a build record with status "queued"
    await db.insert(builds).values({
      id: buildId,
      projectId,
      userId: buildUserId,
      status: "queued",
      engine: compileEngine,
    });

    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    // Enqueue compile job
    await enqueueCompileJob({
      buildId,
      projectId,
      userId: buildUserId,
      storageUserId,
      triggeredByUserId: actorUserId,
      engine: compileEngine,
      mainFile: project.mainFile,
    });

    broadcastBuildUpdate(buildUserId, {
      projectId,
      buildId,
      status: "queued",
      triggeredByUserId: actorUserId,
    });

    return NextResponse.json(
      {
        buildId,
        status: "queued",
        message: "Compilation queued",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error triggering compilation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
