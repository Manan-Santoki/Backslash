import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { LIMITS } from "@backslash/shared";
import IORedis from "ioredis";

import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { getProjectDir, getPdfPath, fileExists } from "@/lib/storage";
import { type CompileJobData, type CompileJobResult } from "./queue";
import { runCompileContainer } from "./docker";
import { parseLatexLog } from "./logParser";
import { broadcastBuildUpdate } from "@/lib/websocket/server";

// ─── Configuration ─────────────────────────────────

const QUEUE_NAME = "compile";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const MAX_CONCURRENT_BUILDS = parseInt(
  process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
  10
);

// Lock must outlast the longest possible compile.
// COMPILE_TIMEOUT is in seconds — add a generous buffer for DB writes + broadcast.
const COMPILE_TIMEOUT_S = parseInt(
  process.env.COMPILE_TIMEOUT || String(LIMITS.COMPILE_TIMEOUT_DEFAULT),
  10
);
const LOCK_DURATION_MS = (COMPILE_TIMEOUT_S + 60) * 1000; // compile timeout + 60s buffer

// ─── Worker Instance ───────────────────────────────

let workerInstance: Worker<CompileJobData, CompileJobResult> | null = null;

/**
 * Creates and starts the BullMQ worker that processes compile jobs.
 *
 * Each job:
 * 1. Marks the build as "compiling" in the database
 * 2. Broadcasts the status change via WebSocket
 * 3. Runs a sandboxed Docker container for LaTeX compilation
 * 4. Updates the build record with the result
 * 5. Broadcasts the completion event via WebSocket
 */
export function startCompileWorker(): Worker<CompileJobData, CompileJobResult> {
  if (workerInstance) {
    return workerInstance;
  }

  // Worker MUST have its own Redis connection — BullMQ uses blocking
  // commands (BRPOPLPUSH) that interfere with the queue's connection.
  const workerConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      return Math.min(times * 200, 5000);
    },
  });

  workerConnection.on("error", (err) => {
    console.error("[Worker Redis] Connection error:", err.message);
  });

  workerConnection.on("connect", () => {
    console.log("[Worker Redis] Connected successfully");
  });

  workerInstance = new Worker<CompileJobData, CompileJobResult>(
    QUEUE_NAME,
    async (job: Job<CompileJobData, CompileJobResult>) => {
      console.log(`[Worker] Processing job ${job.id} for project ${job.data.projectId}`);
      return processCompileJob(job);
    },
    {
      connection: workerConnection,
      concurrency: MAX_CONCURRENT_BUILDS,
      // Lock must exceed the max compile time so BullMQ doesn't
      // consider a running job "stalled" and re-queue it.
      lockDuration: LOCK_DURATION_MS,
      // How often the worker auto-renews the lock (half the lock duration).
      lockRenewTime: LOCK_DURATION_MS / 2,
      // How often to check for stalled jobs — must be > lockDuration
      // to avoid false positives.
      stalledInterval: LOCK_DURATION_MS + 30_000,
    }
  );

  workerInstance.on("ready", () => {
    console.log("[Worker] BullMQ worker connected to Redis and ready to process jobs");
  });

  workerInstance.on("active", (job) => {
    console.log(`[Worker] Job ${job.id} is now active (project ${job.data.projectId})`);
  });

  workerInstance.on("completed", (job) => {
    console.log(
      `[Worker] Job ${job.id} completed for project ${job.data.projectId}`
    );
  });

  workerInstance.on("failed", (job, err) => {
    console.error(
      `[Worker] Job ${job?.id} failed for project ${job?.data.projectId}:`,
      err.message
    );
  });

  workerInstance.on("error", (err) => {
    console.error("[Worker] Worker error:", err.message);
  });

  workerInstance.on("stalled", (jobId) => {
    console.warn(`[Worker] Job ${jobId} has stalled`);
  });

  // Wait for the worker to be fully ready before returning
  workerInstance.waitUntilReady().then(() => {
    console.log("[Worker] Worker fully initialized and polling for jobs");
  }).catch((err) => {
    console.error("[Worker] Failed to initialize:", err.message);
  });

  console.log(
    `[Worker] Compile worker started (concurrency: ${MAX_CONCURRENT_BUILDS})`
  );

  return workerInstance;
}

// ─── Job Processing ────────────────────────────────

async function processCompileJob(
  job: Job<CompileJobData, CompileJobResult>
): Promise<CompileJobResult> {
  const { buildId, projectId, userId, engine, mainFile } = job.data;
  const startTime = Date.now();

  // ── Step 1: Mark as compiling ────────────────────
  await updateBuildStatus(buildId, "compiling");

  broadcastBuildUpdate(userId, {
    projectId,
    buildId,
    status: "compiling",
  });

  // ── Step 2: Resolve project directory ────────────
  const projectDir = getProjectDir(userId, projectId);

  // ── Step 3: Run the Docker container ─────────────
  let result: CompileJobResult;

  try {
    await job.updateProgress(10);

    // Extend the lock right before the long Docker run so we have
    // the full lockDuration from this point forward.
    await job.extendLock(job.token!, LOCK_DURATION_MS);
    console.log(`[Worker] Lock extended for job ${job.id} (${LOCK_DURATION_MS}ms)`);

    const containerResult = await runCompileContainer({
      projectDir,
      mainFile,
    });

    // Extend again after Docker finishes — we still need time for
    // DB writes and the broadcast.
    await job.extendLock(job.token!, 60_000);
    await job.updateProgress(90);

    const durationMs = Date.now() - startTime;
    const pdfOutputPath = getPdfPath(userId, projectId, mainFile);
    const pdfExists = await fileExists(pdfOutputPath);
    const parsedEntries = parseLatexLog(containerResult.logs);
    const hasErrors = parsedEntries.some((e) => e.type === "error");

    // Determine final status
    let finalStatus: "success" | "error" | "timeout";
    if (containerResult.timedOut) {
      finalStatus = "timeout";
    } else if (containerResult.exitCode !== 0 || hasErrors || !pdfExists) {
      finalStatus = "error";
    } else {
      finalStatus = "success";
    }

    // ── Step 4: Update database ──────────────────────
    await db
      .update(builds)
      .set({
        status: finalStatus,
        logs: containerResult.logs,
        durationMs,
        exitCode: containerResult.exitCode,
        pdfPath: pdfExists ? pdfOutputPath : null,
        completedAt: new Date(),
      })
      .where(eq(builds.id, buildId));

    // ── Step 5: Broadcast completion ─────────────────
    broadcastBuildUpdate(userId, {
      projectId,
      buildId,
      status: finalStatus,
      pdfUrl: pdfExists ? `/api/projects/${projectId}/pdf` : null,
      logs: containerResult.logs,
      durationMs,
      errors: parsedEntries.filter((e) => e.type === "error"),
    });

    result = {
      success: finalStatus === "success",
      exitCode: containerResult.exitCode,
      logs: containerResult.logs,
      pdfPath: pdfExists ? pdfOutputPath : null,
      durationMs,
    };

    await job.updateProgress(100);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // Update the build as errored
    await updateBuildError(buildId, errorMessage, durationMs);

    // Broadcast the error
    broadcastBuildUpdate(userId, {
      projectId,
      buildId,
      status: "error",
      pdfUrl: null,
      logs: `Internal compilation error: ${errorMessage}`,
      durationMs,
      errors: [
        {
          type: "error",
          file: "system",
          line: 0,
          message: `Compilation infrastructure error: ${errorMessage}`,
        },
      ],
    });

    result = {
      success: false,
      exitCode: -1,
      logs: `Internal error: ${errorMessage}`,
      pdfPath: null,
      durationMs,
    };
  }

  return result;
}

// ─── Database Helpers ──────────────────────────────

async function updateBuildStatus(
  buildId: string,
  status: "queued" | "compiling"
): Promise<void> {
  await db
    .update(builds)
    .set({ status })
    .where(eq(builds.id, buildId));
}

async function updateBuildError(
  buildId: string,
  errorMessage: string,
  durationMs: number
): Promise<void> {
  await db
    .update(builds)
    .set({
      status: "error",
      logs: `Internal compilation error: ${errorMessage}`,
      durationMs,
      exitCode: -1,
      completedAt: new Date(),
    })
    .where(eq(builds.id, buildId));
}

// ─── Shutdown ──────────────────────────────────────

/**
 * Gracefully shuts down the compile worker.
 * Waits for currently running jobs to finish before closing.
 */
export async function shutdownWorker(): Promise<void> {
  if (workerInstance) {
    console.log("[Worker] Shutting down compile worker...");
    await workerInstance.close();
    workerInstance = null;
    console.log("[Worker] Compile worker stopped");
  }
}
