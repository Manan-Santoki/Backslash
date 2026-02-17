import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/auth/apikey";
import { getAuthorizedAsyncCompileJob } from "@/lib/compiler/asyncCompileAccess";
import { requestAsyncCompileCancel } from "@/lib/compiler/asyncCompileQueue";
import {
  computeAsyncCompileExpiryIso,
  patchAsyncCompileMetadata,
} from "@/lib/compiler/asyncCompileStore";

// ─── POST /api/v1/compile/[jobId]/cancel ────────────
// Cancel an async one-shot compile.

export async function POST(
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
      if (["success", "error", "timeout", "canceled"].includes(meta.status)) {
        return NextResponse.json({
          jobId,
          status: meta.status,
          message: "Compile job already completed",
        });
      }

      const { wasQueued, wasRunning } = await requestAsyncCompileCancel(jobId);

      if (wasQueued && !wasRunning) {
        await patchAsyncCompileMetadata(jobId, {
          status: "canceled",
          message: "Build canceled before starting.",
          completedAt: new Date().toISOString(),
          expiresAt: computeAsyncCompileExpiryIso(),
          exitCode: -1,
        });
      }

      return NextResponse.json(
        {
          jobId,
          status: "canceled",
          message: "Cancel request accepted",
        },
        { status: 202 }
      );
    } catch (error) {
      console.error("[API v1] Error canceling async compile:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
