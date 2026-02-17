import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/auth/apikey";
import { getAuthorizedAsyncCompileJob } from "@/lib/compiler/asyncCompileAccess";
import {
  getAsyncCompilePdfPath,
  readAsyncCompileErrors,
  readAsyncCompileLogs,
} from "@/lib/compiler/asyncCompileStore";
import { parseLatexLog } from "@/lib/compiler/logParser";
import fs from "fs/promises";

// ─── GET /api/v1/compile/[jobId]/output ─────────────
// Retrieve async one-shot compile artifacts/output.
//
// Query:
//   format=pdf|base64|json   (default: json)

function terminalErrorMessage(status: string): string {
  switch (status) {
    case "timeout":
      return "Compilation timed out";
    case "canceled":
      return "Compilation canceled";
    default:
      return "Compilation failed";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  return withApiKey(request, async (req, user) => {
    try {
      const { jobId } = await params;
      const format = req.nextUrl.searchParams.get("format") || "json";
      const result = await getAuthorizedAsyncCompileJob(user.id, jobId);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      const meta = result.meta;
      if (meta.status === "queued" || meta.status === "compiling") {
        return NextResponse.json(
          {
            error: "Compilation still in progress",
            status: meta.status,
            pollUrl: `/api/v1/compile/${jobId}`,
          },
          { status: 409 }
        );
      }

      const logs = await readAsyncCompileLogs(jobId);
      const parsedEntries = await readAsyncCompileErrors(jobId);
      const errors = parsedEntries.length > 0
        ? parsedEntries
        : parseLatexLog(logs);

      const successful = meta.status === "success";
      const pdfPath = getAsyncCompilePdfPath(jobId, meta.mainFile);
      const pdfBuffer = successful
        ? await fs.readFile(pdfPath).catch(() => null)
        : null;

      if (!successful || !pdfBuffer) {
        return NextResponse.json(
          {
            error: terminalErrorMessage(meta.status),
            status: meta.status,
            engineUsed: meta.engineUsed ?? null,
            logs,
            errors: errors.filter((e) => e.type === "error"),
            durationMs: meta.durationMs ?? null,
          },
          { status: 422 }
        );
      }

      if (format === "pdf") {
        return new NextResponse(new Uint8Array(pdfBuffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="output.pdf"',
            "Content-Length": String(pdfBuffer.length),
            "X-Compile-Duration-Ms": String(meta.durationMs ?? 0),
            "X-Compile-Engine": meta.engineUsed ?? "unknown",
            "X-Compile-Warnings": String(meta.warningCount),
            "X-Compile-Errors": String(meta.errorCount),
          },
        });
      }

      if (format !== "json" && format !== "base64") {
        return NextResponse.json(
          { error: "Invalid format. Use one of: pdf, base64, json" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        pdf: pdfBuffer.toString("base64"),
        engineUsed: meta.engineUsed ?? null,
        logs,
        errors,
        durationMs: meta.durationMs ?? null,
      });
    } catch (error) {
      console.error("[API v1] Error fetching async compile output:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

