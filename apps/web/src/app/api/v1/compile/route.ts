import { withApiKey } from "@/lib/auth/apikey";
import { runCompileContainer } from "@/lib/compiler/docker";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/v1/compile ───────────────────────────
// One-shot compile: send a .tex file (or JSON source), receive PDF.
//
// Accepts:
//   1. multipart/form-data  — file field "file" (.tex), optional "engine" field
//   2. application/json     — { "source": "...", "engine": "pdflatex" }
//
// Response formats (controlled by ?format= query param):
//   ?format=pdf    (default) — raw application/pdf binary blob
//   ?format=base64           — JSON { pdf, logs, errors, durationMs }
//   ?format=json             — same as base64

const MAX_SOURCE_SIZE = 5 * 1024 * 1024; // 5 MB
const VALID_ENGINES = ["pdflatex", "xelatex", "lualatex", "latex"] as const;
type Engine = (typeof VALID_ENGINES)[number];

function isValidEngine(v: string): v is Engine {
  return (VALID_ENGINES as readonly string[]).includes(v);
}

export async function POST(request: NextRequest) {
  return withApiKey(request, async (req, user) => {
    try {
      // ── Parse input (multipart OR JSON) ────────────
      let source: string;
      let engine: Engine = "pdflatex";
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
        if (engineField && typeof engineField === "string" && isValidEngine(engineField)) {
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

        if (typeof eng === "string" && isValidEngine(eng)) {
          engine = eng;
        }
      }

      // Allow engine override via query param too
      const qEngine = req.nextUrl.searchParams.get("engine");
      if (qEngine && isValidEngine(qEngine)) {
        engine = qEngine;
      }

      // ── Determine response format ─────────────────
      const format = req.nextUrl.searchParams.get("format") || "pdf";

      // ── Compile ───────────────────────────────────
      const jobId = uuidv4();
      const STORAGE_PATH = process.env.STORAGE_PATH || "/data";
      const tmpDir = path.join(STORAGE_PATH, "tmp", jobId);
      await fs.mkdir(tmpDir, { recursive: true });

      try {
        await fs.writeFile(path.join(tmpDir, "main.tex"), source, "utf-8");

        const startTime = Date.now();

        const result = await runCompileContainer({
          projectDir: tmpDir,
          mainFile: "main.tex",
        });

        const durationMs = Date.now() - startTime;
        const errors = parseLatexLog(result.logs);

        // Try to read the generated PDF
        const pdfPath = path.join(tmpDir, "main.pdf");
        let pdfBuffer: Buffer | null = null;

        try {
          pdfBuffer = await fs.readFile(pdfPath);
        } catch {
          // PDF was not generated
        }

        if (!pdfBuffer || result.timedOut) {
          return NextResponse.json(
            {
              error: result.timedOut
                ? "Compilation timed out"
                : "Compilation failed — no PDF generated",
              logs: result.logs,
              errors: errors.filter((e) => e.type === "error"),
              durationMs,
            },
            { status: 422 }
          );
        }

        // ── Return PDF in the requested format ──────
        if (format === "base64" || format === "json") {
          return NextResponse.json({
            pdf: pdfBuffer.toString("base64"),
            logs: result.logs,
            errors,
            durationMs,
          });
        }

        // Default: raw PDF binary
        return new NextResponse(new Uint8Array(pdfBuffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="output.pdf"',
            "Content-Length": String(pdfBuffer.length),
            "X-Compile-Duration-Ms": String(durationMs),
            "X-Compile-Warnings": String(
              errors.filter((e) => e.type === "warning").length
            ),
            "X-Compile-Errors": String(
              errors.filter((e) => e.type === "error").length
            ),
          },
        });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      console.error("[API v1] Compile error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
