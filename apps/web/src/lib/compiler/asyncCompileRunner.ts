import { Queue, Worker } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import { LIMITS } from "@backslash/shared";
import fs from "fs/promises";

import { runCompileContainer } from "./docker";
import { parseLatexLog } from "./logParser";
import {
  computeAsyncCompileExpiryIso,
  deleteAsyncCompileJob,
  getAsyncCompileJobDir,
  getAsyncCompilePdfPath,
  isExpired,
  isTerminalStatus,
  listAsyncCompileJobIds,
  patchAsyncCompileMetadata,
  readAsyncCompileMetadata,
  writeAsyncCompileErrors,
  writeAsyncCompileLogs,
} from "./asyncCompileStore";
import {
  ASYNC_COMPILE_CANCEL_KEY_PREFIX,
  ASYNC_COMPILE_QUEUE_NAME,
  enqueueAsyncCompileJob,
  requestAsyncCompileCancel,
  type AsyncCompileJobData,
} from "./asyncCompileQueue";

export interface AsyncCompileRunnerHealth {
  running: boolean;
  activeJobs: number;
  maxConcurrent: number;
  totalProcessed: number;
  totalErrors: number;
  uptimeMs: number;
  redisConnected: boolean;
}

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const MAX_CONCURRENT = parseInt(
  process.env.ASYNC_COMPILE_MAX_CONCURRENT_BUILDS ||
    process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
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

class AsyncCompileRunner {
  private redis: IORedis;
  private queue: Queue<AsyncCompileJobData> | null = null;
  private worker: Worker<AsyncCompileJobData> | null = null;
  private maxConcurrent: number;
  private running = false;
  private totalProcessed = 0;
  private totalErrors = 0;
  private startedAt = Date.now();
  private activeControllers = new Map<string, AbortController>();

  constructor() {
    this.maxConcurrent = MAX_CONCURRENT;
    this.redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10_000,
      reconnectOnError: () => true,
      lazyConnect: false,
    });
  }

  start(): void {
    if (this.running) return;

    this.queue = new Queue<AsyncCompileJobData>(ASYNC_COMPILE_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    });

    this.worker = new Worker<AsyncCompileJobData>(
      ASYNC_COMPILE_QUEUE_NAME,
      async (job: { data: AsyncCompileJobData }) => this.processJob(job.data),
      {
        connection: REDIS_CONNECTION,
        concurrency: this.maxConcurrent,
      }
    );

    this.worker.on("error", (err: Error) => {
      console.error("[AsyncCompileRunner] Worker error:", err.message);
    });

    this.running = true;
    this.startedAt = Date.now();
    void cleanExpiredAsyncCompileJobs();

    console.log(
      `[AsyncCompileRunner] Started (concurrency=${this.maxConcurrent}, queue=${ASYNC_COMPILE_QUEUE_NAME})`
    );
  }

  async addJob(data: AsyncCompileJobData): Promise<void> {
    if (!this.running) {
      this.start();
    }
    if (!this.queue) {
      throw new Error("Async compile queue not initialized");
    }

    try {
      await this.queue.add("async-compile", data, {
        jobId: data.jobId,
      });
      console.log(`[AsyncCompileRunner] Job queued: ${data.jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Job is already waiting") || message.includes("Job already exists")) {
        console.warn(`[AsyncCompileRunner] Duplicate job ignored: ${data.jobId}`);
        return;
      }
      throw err;
    }
  }

  private async processJob(data: AsyncCompileJobData): Promise<void> {
    const { jobId, engine, mainFile } = data;
    const startTime = Date.now();
    const controller = new AbortController();
    let cancelPollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelCheckInFlight = false;

    try {
      const meta = await readAsyncCompileMetadata(jobId);
      if (!meta) {
        throw new Error("Async compile metadata not found");
      }

      this.activeControllers.set(jobId, controller);

      await patchAsyncCompileMetadata(jobId, {
        status: "compiling",
        startedAt: new Date().toISOString(),
        message: undefined,
      });

      cancelPollTimer = setInterval(() => {
        if (cancelCheckInFlight || controller.signal.aborted) return;
        cancelCheckInFlight = true;
        void this.isJobCanceled(jobId)
          .then((canceled) => {
            if (canceled) {
              controller.abort();
            }
          })
          .catch((err) => {
            console.error(
              `[AsyncCompileRunner] Cancel check failed for ${jobId}:`,
              err instanceof Error ? err.message : err
            );
          })
          .finally(() => {
            cancelCheckInFlight = false;
          });
      }, 500);

      const jobDir = getAsyncCompileJobDir(jobId);
      const containerResult = await runCompileContainer({
        projectDir: jobDir,
        mainFile,
        engine,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;
      const parsedEntries = parseLatexLog(containerResult.logs);
      const hasErrors = parsedEntries.some((e) => e.type === "error");
      const errorCount = parsedEntries.filter((e) => e.type === "error").length;
      const warningCount = parsedEntries.filter((e) => e.type === "warning").length;

      const logsFile = await writeAsyncCompileLogs(
        jobId,
        containerResult.canceled ? "Build canceled by user." : containerResult.logs
      );
      const errorsFile = await writeAsyncCompileErrors(jobId, parsedEntries);

      const pdfPath = getAsyncCompilePdfPath(jobId, mainFile);
      const pdfExists = await fs
        .access(pdfPath)
        .then(() => true)
        .catch(() => false);

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

      await patchAsyncCompileMetadata(jobId, {
        status: finalStatus,
        engineUsed: containerResult.engineUsed,
        logsPath: logsFile,
        errorsPath: errorsFile,
        pdfPath: pdfExists ? "main.pdf" : undefined,
        errorCount,
        warningCount,
        durationMs,
        exitCode: containerResult.exitCode,
        completedAt: new Date().toISOString(),
        expiresAt: computeAsyncCompileExpiryIso(),
        message: containerResult.canceled
          ? "Build canceled by user."
          : undefined,
      });

      this.totalProcessed++;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await patchAsyncCompileMetadata(jobId, {
        status: "error",
        message: `Compilation infrastructure error: ${errorMessage}`,
        durationMs,
        exitCode: -1,
        completedAt: new Date().toISOString(),
        expiresAt: computeAsyncCompileExpiryIso(),
      });
      this.totalErrors++;
      throw err;
    } finally {
      this.activeControllers.delete(jobId);
      if (cancelPollTimer) {
        clearInterval(cancelPollTimer);
      }
    }
  }

  async cancelJob(
    jobId: string
  ): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
    const localRunning = this.activeControllers.has(jobId);
    if (localRunning) {
      this.activeControllers.get(jobId)?.abort();
    }

    let wasQueued = false;
    let wasRunning = localRunning;

    if (!this.running) {
      this.start();
    }

    if (this.queue) {
      const job = await this.queue.getJob(jobId);
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

    await this.redis.setex(`${ASYNC_COMPILE_CANCEL_KEY_PREFIX}${jobId}`, 900, "1");

    if (wasQueued && !wasRunning) {
      await patchAsyncCompileMetadata(jobId, {
        status: "canceled",
        message: "Build canceled before starting.",
        completedAt: new Date().toISOString(),
        expiresAt: computeAsyncCompileExpiryIso(),
        exitCode: -1,
      });
    }

    return { wasQueued, wasRunning };
  }

  getHealth(): AsyncCompileRunnerHealth {
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
  }

  private async isJobCanceled(jobId: string): Promise<boolean> {
    const key = `${ASYNC_COMPILE_CANCEL_KEY_PREFIX}${jobId}`;
    const canceled = await this.redis.get(key);
    if (!canceled) return false;
    await this.redis.del(key);
    return true;
  }
}

async function cleanExpiredAsyncCompileJobs(): Promise<void> {
  try {
    const ids = await listAsyncCompileJobIds();
    for (const id of ids) {
      const meta = await readAsyncCompileMetadata(id);
      if (!meta) {
        await deleteAsyncCompileJob(id);
        continue;
      }
      if (isTerminalStatus(meta.status) && isExpired(meta)) {
        await deleteAsyncCompileJob(id);
      }
    }
  } catch (err) {
    console.error(
      "[AsyncCompileRunner] Failed to clean expired async compile jobs:",
      err instanceof Error ? err.message : err
    );
  }
}

const RUNNER_KEY = "__backslash_async_compile_runner__" as const;

function getRunnerInstance(): AsyncCompileRunner | null {
  return (
    ((globalThis as unknown) as Record<string, AsyncCompileRunner | undefined>)[
      RUNNER_KEY
    ] ?? null
  );
}

function setRunnerInstance(runner: AsyncCompileRunner | null): void {
  ((globalThis as unknown) as Record<string, AsyncCompileRunner | null>)[RUNNER_KEY] = runner;
}

export function startAsyncCompileRunner(): AsyncCompileRunner {
  const existing = getRunnerInstance();
  if (existing) return existing;

  const runner = new AsyncCompileRunner();
  setRunnerInstance(runner);
  runner.start();
  return runner;
}

export async function addAsyncCompileJob(
  data: AsyncCompileJobData
): Promise<void> {
  await enqueueAsyncCompileJob(data);
}

export async function cancelAsyncCompileJob(
  jobId: string
): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
  return requestAsyncCompileCancel(jobId);
}

export function getAsyncCompileRunnerHealth(): AsyncCompileRunnerHealth | null {
  const runner = getRunnerInstance();
  return runner ? runner.getHealth() : null;
}

export async function shutdownAsyncCompileRunner(): Promise<void> {
  const runner = getRunnerInstance();
  if (!runner) return;
  await runner.shutdown();
  setRunnerInstance(null);
}
