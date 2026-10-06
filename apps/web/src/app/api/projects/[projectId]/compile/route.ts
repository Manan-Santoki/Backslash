import { resolveProjectAccess } from "@/lib/auth/project-access";
import { triggerCompile } from "@/lib/compiler/triggerCompile";
import { NextRequest, NextResponse } from "next/server";
import type { Engine } from "@backslash/shared";
import { checkDemoCompileAllowance, demoBlockResponse } from "@/lib/demo";

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

    // Demo mode: refuse before doing any work (or writing a build row).
    if (access.user) {
      const demoBlock = await checkDemoCompileAllowance(access.user.id);
      if (demoBlock) {
        return demoBlockResponse(demoBlock);
      }
    }

    const project = access.project;
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

    const result = await triggerCompile({
      projectId,
      storageUserId: project.userId,
      actorUserId: access.user?.id ?? null,
      engine: compileEngine,
      mainFile: project.mainFile,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { buildId } = result;

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
