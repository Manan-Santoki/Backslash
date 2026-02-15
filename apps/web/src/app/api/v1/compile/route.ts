import { withApiKey } from "@/lib/auth/apikey";
import { enqueueAsyncCompileJob } from "@/lib/compiler/asyncCompileQueue";
import {
  createAsyncCompileJob,
  deleteAsyncCompileJob,
} from "@/lib/compiler/asyncCompileStore";
import {
  isDedicatedWorkerHealthy,
  isWorkerExpectedInWeb,
} from "@/lib/compiler/workerHealth";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/v1/compile ───────────────────────────
// One-shot compile: enqueue source and poll for async result.
//
// Accepts:
//   1. multipart/form-data  — file field "file" (.tex), optional "engine" field
//   2. application/json     — { "source": "...", "engine": "auto|pdflatex|xelatex|lualatex|latex" }
//
// Response:
//   202 Accepted with job id and poll links.

const MAX_SOURCE_SIZE = 5 * 1024 * 1024; // 5 MB
const VALID_ENGINES = ["auto", "pdflatex", "xelatex", "lualatex", "latex"] as const;
type Engine = (typeof VALID_ENGINES)[number];

function isValidEngine(v: string): v is Engine {
  return (VALID_ENGINES as readonly string[]).includes(v);
}

export async function POST(request: NextRequest) {
  return withApiKey(request, async (req, user) => {
    try {
      // ── Parse input (multipart OR JSON) ────────────
      let source: string;
      let engine: Engine = "auto";
      const contentType = req.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        // ── File upload ──────────────────────────────
        const formData = await req.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof Blob)) {
          return NextResponse.json(
            { error: "Missing 'file' field — upload a .tex file" },
            { status: 400 }
          );
        }

        if (file.size > MAX_SOURCE_SIZE) {
          return NextResponse.json(
            { error: `File too large (max ${MAX_SOURCE_SIZE / 1024 / 1024}MB)` },
            { status: 400 }
          );
        }

        source = await file.text();

        const engineField = formData.get("engine");
        if (engineField && typeof engineField === "string") {
          if (!isValidEngine(engineField)) {
            return NextResponse.json(
              {
                error:
                  "Invalid engine. Use one of: auto, pdflatex, xelatex, lualatex, latex",
              },
              { status: 400 }
            );
          }
          engine = engineField;
        }
      } else {
        // ── JSON body ────────────────────────────────
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return NextResponse.json(
            { error: "Invalid JSON body. Send multipart/form-data with a 'file' field, or JSON with a 'source' field." },
            { status: 400 }
          );
        }

        const { source: src, engine: eng } = body as Record<string, unknown>;

        if (typeof src !== "string" || src.length === 0) {
          return NextResponse.json(
            { error: "'source' field is required and must be a non-empty string" },
            { status: 400 }
          );
        }

        if (src.length > MAX_SOURCE_SIZE) {
          return NextResponse.json(
            { error: `Source too large (max ${MAX_SOURCE_SIZE / 1024 / 1024}MB)` },
            { status: 400 }
          );
        }

        source = src;

        if (typeof eng === "string") {
          if (!isValidEngine(eng)) {
            return NextResponse.json(
              {
                error:
                  "Invalid engine. Use one of: auto, pdflatex, xelatex, lualatex, latex",
              },
              { status: 400 }
            );
          }
          engine = eng;
        }
      }

      // Allow engine override via query param too
      const qEngine = req.nextUrl.searchParams.get("engine");
      if (qEngine) {
        if (!isValidEngine(qEngine)) {
          return NextResponse.json(
            {
              error:
                "Invalid engine. Use one of: auto, pdflatex, xelatex, lualatex, latex",
            },
            { status: 400 }
          );
        }
        engine = qEngine;
      }

      const legacyFormat = req.nextUrl.searchParams.get("format");
      if (legacyFormat) {
        return NextResponse.json(
          {
            error:
              "POST /api/v1/compile is asynchronous. Submit first, then use GET /api/v1/compile/:jobId/output?format=pdf|base64|json",
          },
          { status: 400 }
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

      // ── Enqueue async job ─────────────────────────
      const jobId = uuidv4();

      await createAsyncCompileJob({
        jobId,
        userId: user.id,
        source,
        requestedEngine: engine,
        mainFile: "main.tex",
      });

      try {
        await enqueueAsyncCompileJob({
          jobId,
          userId: user.id,
          engine,
          mainFile: "main.tex",
        });
      } catch (enqueueError) {
        await deleteAsyncCompileJob(jobId).catch(() => {});
        throw enqueueError;
      }

      return NextResponse.json(
        {
          jobId,
          status: "queued",
          message: "Compilation queued",
          pollUrl: `/api/v1/compile/${jobId}`,
          outputUrl: `/api/v1/compile/${jobId}/output`,
          cancelUrl: `/api/v1/compile/${jobId}/cancel`,
        },
        { status: 202 }
      );
    } catch (error) {
      console.error("[API v1] Compile error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
