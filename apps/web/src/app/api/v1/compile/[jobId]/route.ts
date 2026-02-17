import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/auth/apikey";
import { getAuthorizedAsyncCompileJob } from "@/lib/compiler/asyncCompileAccess";

// ─── GET /api/v1/compile/[jobId] ────────────────────
// Poll async one-shot compile status.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { jobId } = await params;
      const result = await getAuthorizedAsyncCompileJob(user.id, jobId);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      const meta = result.meta;
      const outputUrl = `/api/v1/compile/${jobId}/output`;

      return NextResponse.json({
        job: {
          id: meta.id,
          status: meta.status,
          requestedEngine: meta.requestedEngine,
          engineUsed: meta.engineUsed ?? null,
          warningCount: meta.warningCount,
          errorCount: meta.errorCount,
          durationMs: meta.durationMs ?? null,
          exitCode: meta.exitCode ?? null,
          message: meta.message ?? null,
          createdAt: meta.createdAt,
          startedAt: meta.startedAt ?? null,
          completedAt: meta.completedAt ?? null,
          expiresAt: meta.expiresAt ?? null,
        },
        links: {
          output: outputUrl,
          pdf: meta.status === "success" ? `${outputUrl}?format=pdf` : null,
        },
      });
    } catch (error) {
      console.error("[API v1] Error fetching async compile status:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

