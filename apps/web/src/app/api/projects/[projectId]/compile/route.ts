import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { addCompileJob } from "@/lib/compiler/runner";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { healthCheck as dockerHealthCheck, getDockerClient } from "@/lib/compiler/docker";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/projects/[projectId]/compile ────────
// Trigger compilation for a project. Owner and editors can compile.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access || access.role === "viewer") {
        return NextResponse.json(
          { error: "Permission denied" },
          { status: 403 }
        );
      }

      const project = access.project;

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
      }

      const buildId = uuidv4();

      // Create a build record with status "queued"
      await db.insert(builds).values({
        id: buildId,
        projectId,
        userId: user.id,
        status: "queued",
        engine: project.engine,
      });

      // Enqueue compile job
      await addCompileJob({
        buildId,
        projectId,
        userId: user.id,
        engine: project.engine,
        mainFile: project.mainFile,
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
  });
}
