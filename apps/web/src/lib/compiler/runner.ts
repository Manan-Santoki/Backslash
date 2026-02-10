import IORedis from "ioredis";
import { eq, inArray } from "drizzle-orm";
import { LIMITS } from "@backslash/shared";
import type { Engine } from "@backslash/shared";

import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { getProjectDir, getPdfPath, fileExists } from "@/lib/storage";
import { runCompileContainer } from "./docker";
import { parseLatexLog } from "./logParser";
import { broadcastBuildUpdate } from "@/lib/websocket/server";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";

// ─── Types ───────────────────────────────────────────

export interface CompileJobData {
  buildId: string;
  projectId: string;
  /** Legacy field retained for backward compatibility with queued jobs */
  userId: string;
  /** Owner storage root. Project files are read/written from this user scope. */
  storageUserId?: string;
  /** Actual user who triggered this build (for attribution and direct notifications). */
  triggeredByUserId?: string;
  engine: Engine;
  mainFile: string;
}

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
const REDIS_KEY = "compile:pending";
const POLL_INTERVAL_MS = 1_000;

const MAX_CONCURRENT_BUILDS = parseInt(
  process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
  10
);

// ─── CompileRunner Class ─────────────────────────────

class CompileRunner {
  private redis: IORedis;
  private activeJobs = 0;
  private maxConcurrent: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private totalProcessed = 0;
  private totalErrors = 0;
  private startedAt: number = Date.now();

  constructor() {
    this.maxConcurrent = MAX_CONCURRENT_BUILDS;
    this.redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
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
    this.running = true;
    this.startedAt = Date.now();

    // Clean stale builds from previous instance (fire-and-forget)
    cleanStaleBuildRecords();

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    console.log(
      `[Runner] Compile runner started (concurrency=${this.maxConcurrent}, poll=${POLL_INTERVAL_MS}ms)`
    );
  }

  async addJob(data: CompileJobData): Promise<void> {
    console.log(`[Runner] Adding compile job ${data.buildId} for project ${data.projectId}`);
    await this.redis.rpush(REDIS_KEY, JSON.stringify(data));
    console.log(`[Runner] Job added successfully: ${data.buildId}`);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      while (this.activeJobs < this.maxConcurrent) {
        const raw = await this.redis.lpop(REDIS_KEY);
        if (!raw) break;

        let data: CompileJobData;
        try {
          data = JSON.parse(raw);
        } catch {
          console.error("[Runner] Failed to parse job data:", raw);
          continue;
        }

        this.activeJobs++;
        console.log(`[Runner] Processing job ${data.buildId} (active=${this.activeJobs}/${this.maxConcurrent})`);

        this.processJob(data).finally(() => {
          this.activeJobs--;
        });
      }
    } catch (err) {
      console.error("[Runner] Poll error:", err instanceof Error ? err.message : err);
    }
  }

  private async processJob(data: CompileJobData): Promise<void> {
    const { buildId, projectId, userId, engine, mainFile } = data;
    const storageUserId = data.storageUserId ?? userId;
    const actorUserId = data.triggeredByUserId ?? userId;
    const startTime = Date.now();

    // Isolated build directory to prevent race conditions between concurrent builds
    const buildDir = path.join(STORAGE_PATH, "builds", buildId);

    try {
      // Step 1: Mark as compiling
      await updateBuildStatus(buildId, "compiling");

      broadcastBuildUpdate(actorUserId, {
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
      });

      console.log(`[Runner] Container finished for job ${buildId}, processing results...`);

      const durationMs = Date.now() - startTime;

      // Check for PDF in the build directory
      const pdfName = mainFile.replace(/\.tex$/, ".pdf");
      const buildPdfPath = path.join(buildDir, pdfName);
      const pdfInBuild = await fileExists(buildPdfPath);

      // Copy PDF back to project directory if it was generated
      const pdfOutputPath = getPdfPath(storageUserId, projectId, mainFile);
      if (pdfInBuild) {
        await fs.mkdir(path.dirname(pdfOutputPath), { recursive: true });
        await fs.copyFile(buildPdfPath, pdfOutputPath);
      }

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

      // Step 4: Update database
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

      // Step 5: Broadcast completion
      broadcastBuildUpdate(actorUserId, {
        projectId,
        buildId,
        status: finalStatus,
        pdfUrl: pdfExists ? `/api/projects/${projectId}/pdf` : null,
        logs: containerResult.logs,
        durationMs,
        errors: parsedEntries.filter((e) => e.type === "error"),
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
      broadcastBuildUpdate(actorUserId, {
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
    } finally {
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
      activeJobs: this.activeJobs,
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

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active jobs to finish (up to 30s)
    const deadline = Date.now() + 30_000;
    while (this.activeJobs > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.activeJobs > 0) {
      console.warn(`[Runner] Shutting down with ${this.activeJobs} active job(s)`);
    }

    try {
      await this.redis.quit();
    } catch {
      // ignore
    }

    console.log("[Runner] Compile runner stopped");
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
    const stale = await db
      .update(builds)
      .set({
        status: "error",
        logs: "Build interrupted — server restarted. Please recompile.",
        completedAt: new Date(),
      })
      .where(inArray(builds.status, ["queued", "compiling"]))
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
  let runner = getRunnerInstance();
  if (!runner) {
    runner = startCompileRunner();
  }
  await runner.addJob(data);
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
