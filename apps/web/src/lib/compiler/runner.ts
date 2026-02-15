import { Queue, Worker } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import { and, eq, inArray, lt } from "drizzle-orm";
import { LIMITS } from "@backslash/shared";

import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import {
  ensureBuildStatusEnumCompat,
  isBuildStatusEnumValueError,
} from "@/lib/db/compat";
import { getProjectDir, getPdfPath, fileExists } from "@/lib/storage";
import { runCompileContainer } from "./docker";
import { parseLatexLog } from "./logParser";
import { broadcastBuildUpdate } from "@/lib/websocket/server";
import {
  COMPILE_CANCEL_KEY_PREFIX,
  COMPILE_QUEUE_NAME,
  enqueueCompileJob,
  requestCompileCancel,
  type CompileJobData,
} from "./compileQueue";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";

// ─── Types ───────────────────────────────────────────

export interface CompileJobResult {
  success: boolean;
  exitCode: number;
  logs: string;
  pdfPath: string | null;
  durationMs: number;
}

export interface RunnerHealth {
  running: boolean;
  activeJobs: number;
  maxConcurrent: number;
  totalProcessed: number;
  totalErrors: number;
  uptimeMs: number;
  redisConnected: boolean;
}

// ─── Configuration ───────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const MAX_CONCURRENT_BUILDS = parseInt(
  process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
  10
);
const STALE_BUILD_TTL_MINUTES = parseInt(
  process.env.STALE_BUILD_TTL_MINUTES || "60",
  10
);

function parseRedisConnection(url: string): RedisOptions {
  const parsed = new URL(url);
  const dbIndex = parsed.pathname && parsed.pathname !== "/"
    ? Number(parsed.pathname.slice(1))
    : 0;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "rediss:" ? "6380" : "6379")),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

const REDIS_CONNECTION = parseRedisConnection(REDIS_URL);

// ─── CompileRunner Class ─────────────────────────────

class CompileRunner {
  private redis: IORedis;
  private queue: Queue<CompileJobData> | null = null;
  private worker: Worker<CompileJobData> | null = null;

  private maxConcurrent: number;
  private running = false;
  private totalProcessed = 0;
  private totalErrors = 0;
  private startedAt: number = Date.now();
  private activeControllers = new Map<string, AbortController>();

  constructor() {
    this.maxConcurrent = MAX_CONCURRENT_BUILDS;
    this.redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10_000,
      reconnectOnError: () => true,
      lazyConnect: false,
    });

    this.redis.on("error", (err) => {
      console.error("[Runner] Redis error:", err.message);
    });

    this.redis.on("connect", () => {
      console.log("[Runner] Redis connected");
    });
  }

  start(): void {
    if (this.running) return;

    this.queue = new Queue<CompileJobData>(COMPILE_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    });

    this.worker = new Worker<CompileJobData>(
      COMPILE_QUEUE_NAME,
      async (job: { data: CompileJobData }) => this.processJob(job.data),
      {
        connection: REDIS_CONNECTION,
        concurrency: this.maxConcurrent,
      }
    );

    this.worker.on("error", (err: Error) => {
      console.error("[Runner] Worker error:", err.message);
    });

    this.running = true;
    this.startedAt = Date.now();

    // Clean stale builds from previous instance (fire-and-forget)
    cleanStaleBuildRecords();

    console.log(
      `[Runner] Compile runner started (concurrency=${this.maxConcurrent}, queue=${COMPILE_QUEUE_NAME})`
    );
  }

  async addJob(data: CompileJobData): Promise<void> {
    if (!this.running) {
      this.start();
    }
    if (!this.queue) {
      throw new Error("Queue not initialized");
    }

    try {
      await this.queue.add("compile", data, {
        jobId: data.buildId,
      });
      console.log(`[Runner] Job queued: ${data.buildId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Job is already waiting") || message.includes("Job already exists")) {
        console.warn(`[Runner] Duplicate job ignored: ${data.buildId}`);
        return;
      }
      throw err;
    }
  }

  private async processJob(data: CompileJobData): Promise<void> {
    const { buildId, projectId, userId, engine, mainFile } = data;
    const storageUserId = data.storageUserId ?? userId;
    const notifyUserId = userId;
    const actorUserId = data.triggeredByUserId ?? null;
    const startTime = Date.now();
    const controller = new AbortController();
    let cancelPollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelCheckInFlight = false;

    // Isolated build directory to prevent race conditions between concurrent builds
    const buildDir = path.join(STORAGE_PATH, "builds", buildId);

    try {
      this.activeControllers.set(buildId, controller);

      // Watch distributed cancel flag while this build is running.
      cancelPollTimer = setInterval(() => {
        if (cancelCheckInFlight || controller.signal.aborted) return;
        cancelCheckInFlight = true;
        void this.isBuildCanceled(buildId)
          .then((canceled) => {
            if (canceled) {
              controller.abort();
            }
          })
          .catch((err) => {
            console.error(
              `[Runner] Cancel check failed for ${buildId}:`,
              err instanceof Error ? err.message : err
            );
          })
          .finally(() => {
            cancelCheckInFlight = false;
          });
      }, 500);

      // Step 1: Mark as compiling
      await updateBuildStatus(buildId, "compiling");

      broadcastBuildUpdate(notifyUserId, {
        projectId,
        buildId,
        status: "compiling",
        triggeredByUserId: actorUserId,
      });

      // Step 2: Copy project files to isolated build directory
      const projectDir = getProjectDir(storageUserId, projectId);
      await copyDir(projectDir, buildDir);
      console.log(`[Runner] Copied project files to build dir: ${buildDir}`);

      // Step 3: Run the Docker container against the isolated build dir
      const containerResult = await runCompileContainer({
        projectDir: buildDir,
        mainFile,
        engine,
        signal: controller.signal,
      });

      console.log(`[Runner] Container finished for job ${buildId}, processing results...`);

      const durationMs = Date.now() - startTime;

      const parsedEntries = parseLatexLog(containerResult.logs);
      const hasErrors = parsedEntries.some((e) => e.type === "error");
      const buildErrors = containerResult.canceled
        ? []
        : parsedEntries.filter((e) => e.type === "error");
      let pdfExists = false;
      const pdfOutputPath = getPdfPath(storageUserId, projectId, mainFile);

      if (!containerResult.canceled) {
        // Check for PDF in the build directory
        const pdfName = mainFile.replace(/\.tex$/, ".pdf");
        const buildPdfPath = path.join(buildDir, pdfName);
        const pdfInBuild = await fileExists(buildPdfPath);

        // Copy PDF back to project directory if it was generated
        if (pdfInBuild) {
          await fs.mkdir(path.dirname(pdfOutputPath), { recursive: true });
          await fs.copyFile(buildPdfPath, pdfOutputPath);
        }

        pdfExists = await fileExists(pdfOutputPath);
      }

      // Determine final status
      let finalStatus: "success" | "error" | "timeout" | "canceled";
      if (containerResult.canceled) {
        finalStatus = "canceled";
      } else if (containerResult.timedOut) {
        finalStatus = "timeout";
      } else if (containerResult.exitCode !== 0 || hasErrors || !pdfExists) {
        finalStatus = "error";
      } else {
        finalStatus = "success";
      }

      // Step 4: Update database
      const completionPatch = {
        engine: containerResult.engineUsed,
        status: finalStatus,
        logs: containerResult.canceled
          ? "Build canceled by user."
          : containerResult.logs,
        durationMs,
        exitCode: containerResult.exitCode,
        pdfPath: pdfExists ? pdfOutputPath : null,
        completedAt: new Date(),
      };

      try {
        await db
          .update(builds)
          .set(completionPatch)
          .where(eq(builds.id, buildId));
      } catch (updateErr) {
        if (isBuildStatusEnumValueError(updateErr)) {
          await ensureBuildStatusEnumCompat();
          await db
            .update(builds)
            .set(completionPatch)
            .where(eq(builds.id, buildId));
        } else {
          throw updateErr;
        }
      }

      // Step 5: Broadcast completion
      broadcastBuildUpdate(notifyUserId, {
        projectId,
        buildId,
        status: finalStatus,
        pdfUrl: pdfExists ? `/api/projects/${projectId}/pdf` : null,
        logs: containerResult.canceled
          ? "Build canceled by user."
          : containerResult.logs,
        durationMs,
        errors: buildErrors,
        triggeredByUserId: actorUserId,
      });

      this.totalProcessed++;
      console.log(`[Runner] Job ${buildId} completed with status=${finalStatus}`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Update the build as errored
      await updateBuildError(buildId, errorMessage, durationMs);

      // Broadcast the error
      broadcastBuildUpdate(notifyUserId, {
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
        triggeredByUserId: actorUserId,
      });

      this.totalErrors++;
      console.error(`[Runner] Job ${buildId} failed: ${errorMessage}`);
      throw err;
    } finally {
      this.activeControllers.delete(buildId);
      if (cancelPollTimer) {
        clearInterval(cancelPollTimer);
      }
      // Always clean up the isolated build directory
      try {
        await fs.rm(buildDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getHealth(): RunnerHealth {
    return {
      running: this.running,
      activeJobs: this.activeControllers.size,
      maxConcurrent: this.maxConcurrent,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      uptimeMs: Date.now() - this.startedAt,
      redisConnected: this.redis.status === "ready",
    };
  }

  async shutdown(): Promise<void> {
    console.log("[Runner] Shutting down compile runner...");
    this.running = false;

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    try {
      await this.redis.quit();
    } catch {
      // ignore
    }

    console.log("[Runner] Compile runner stopped");
  }

  async cancelBuild(buildId: string): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
    const localRunning = this.activeControllers.has(buildId);
    if (localRunning) {
      this.activeControllers.get(buildId)?.abort();
    }

    let wasQueued = false;
    let wasRunning = localRunning;

    if (!this.running) {
      this.start();
    }

    if (this.queue) {
      const job = await this.queue.getJob(buildId);
      if (job) {
        const state = await job.getState();
        if (state === "active") {
          wasRunning = true;
        }
        if (state === "waiting" || state === "delayed" || state === "prioritized") {
          await job.remove();
          wasQueued = true;
        }
      }
    }

    await this.redis.setex(`${COMPILE_CANCEL_KEY_PREFIX}${buildId}`, 900, "1");

    return { wasQueued, wasRunning };
  }

  private async isBuildCanceled(buildId: string): Promise<boolean> {
    const key = `${COMPILE_CANCEL_KEY_PREFIX}${buildId}`;
    const canceled = await this.redis.get(key);
    if (canceled) {
      await this.redis.del(key);
      return true;
    }
    return false;
  }

  async handleCanceledBuild(
    data: CompileJobData,
    message: string
  ): Promise<void> {
    const notifyUserId = data.userId;
    const actorUserId = data.triggeredByUserId ?? null;
    const canceledPatch = {
      status: "canceled" as const,
      logs: message,
      exitCode: -1,
      completedAt: new Date(),
    };

    try {
      await db
        .update(builds)
        .set(canceledPatch)
        .where(eq(builds.id, data.buildId));
    } catch (updateErr) {
      if (isBuildStatusEnumValueError(updateErr)) {
        await ensureBuildStatusEnumCompat();
        await db
          .update(builds)
          .set(canceledPatch)
          .where(eq(builds.id, data.buildId));
      } else {
        throw updateErr;
      }
    }

    broadcastBuildUpdate(notifyUserId, {
      projectId: data.projectId,
      buildId: data.buildId,
      status: "canceled",
      pdfUrl: null,
      logs: message,
      durationMs: 0,
      errors: [],
      triggeredByUserId: actorUserId,
    });
  }
}

// ─── File Helpers ───────────────────────────────────

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ─── Database Helpers ────────────────────────────────

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

async function cleanStaleBuildRecords(): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - Math.max(STALE_BUILD_TTL_MINUTES, 1) * 60_000
    );
    const stale = await db
      .update(builds)
      .set({
        status: "error",
        logs: "Build interrupted — server restarted. Please recompile.",
        completedAt: new Date(),
      })
      .where(
        and(
          inArray(builds.status, ["queued", "compiling"]),
          lt(builds.createdAt, cutoff)
        )
      )
      .returning({ id: builds.id });

    if (stale.length > 0) {
      console.log(`[Runner] Cleaned ${stale.length} stale build(s) from previous instance`);
    }
  } catch (err) {
    console.error("[Runner] Failed to clean stale builds:", err instanceof Error ? err.message : err);
  }
}

// ─── Singleton (survives Next.js hot-reloads) ────────

const RUNNER_KEY = "__backslash_compile_runner__" as const;

function getRunnerInstance(): CompileRunner | null {
  return (
    ((globalThis as unknown) as Record<string, CompileRunner | undefined>)[RUNNER_KEY] ?? null
  );
}

function setRunnerInstance(runner: CompileRunner | null): void {
  ((globalThis as unknown) as Record<string, CompileRunner | null>)[RUNNER_KEY] = runner;
}

// ─── Public API ──────────────────────────────────────

export function startCompileRunner(): CompileRunner {
  const existing = getRunnerInstance();
  if (existing) {
    return existing;
  }

  const runner = new CompileRunner();
  setRunnerInstance(runner);
  runner.start();
  return runner;
}

export async function addCompileJob(data: CompileJobData): Promise<void> {
  await enqueueCompileJob(data);
}

export async function cancelCompileJob(
  buildId: string
): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
  return requestCompileCancel(buildId);
}

export async function shutdownRunner(): Promise<void> {
  const runner = getRunnerInstance();
  if (runner) {
    await runner.shutdown();
    setRunnerInstance(null);
  }
}

export function getRunnerHealth(): RunnerHealth | null {
  const runner = getRunnerInstance();
  return runner ? runner.getHealth() : null;
}
