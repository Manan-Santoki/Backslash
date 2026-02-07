import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { Engine } from "@backslash/shared";

// ─── Redis Connection ──────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Use globalThis to survive Next.js hot module reloads
const REDIS_KEY = "__backslash_queue_redis__" as const;
const QUEUE_KEY = "__backslash_compile_queue__" as const;

export function getRedisConnection(): IORedis {
  let instance = ((globalThis as unknown) as Record<string, IORedis | undefined>)[REDIS_KEY];
  if (instance && instance.status !== "end") {
    return instance;
  }

  instance = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    reconnectOnError() {
      return true;
    },
  });

  instance.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  instance.on("connect", () => {
    console.log("[Redis] Connected successfully");
  });

  ((globalThis as unknown) as Record<string, IORedis>)[REDIS_KEY] = instance;

  return instance;
}

// ─── Job Types ─────────────────────────────────────

export interface CompileJobData {
  buildId: string;
  projectId: string;
  userId: string;
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

// ─── Queue Setup ───────────────────────────────────

const QUEUE_NAME = "compile";

export function getCompileQueue(): Queue<CompileJobData, CompileJobResult> {
  let instance = ((globalThis as unknown) as Record<string, Queue<CompileJobData, CompileJobResult> | undefined>)[QUEUE_KEY];
  if (instance) {
    return instance;
  }

  instance = new Queue<CompileJobData, CompileJobResult>(
    QUEUE_NAME,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: {
          age: 3600,
          count: 200,
        },
        removeOnFail: {
          age: 86400,
          count: 500,
        },
      },
    }
  );

  ((globalThis as unknown) as Record<string, Queue<CompileJobData, CompileJobResult>>)[QUEUE_KEY] = instance;

  return instance;
}

// ─── Job Helpers ───────────────────────────────────

export async function addCompileJob(
  data: CompileJobData
): Promise<string | null> {
  const queue = getCompileQueue();

  const jobOptions: JobsOptions = {
    jobId: data.buildId,
  };

  console.log(`[Queue] Adding compile job ${data.buildId} for project ${data.projectId}`);
  const job = await queue.add("compile", data, jobOptions);
  console.log(`[Queue] Job added successfully: ${job?.id}`);

  return job?.id ?? null;
}

/**
 * Gracefully shuts down the compile queue and Redis connection.
 */
export async function shutdownQueue(): Promise<void> {
  const queue = ((globalThis as unknown) as Record<string, Queue | undefined>)[QUEUE_KEY];
  if (queue) {
    await queue.close();
    ((globalThis as unknown) as Record<string, Queue | null>)[QUEUE_KEY] = null;
  }

  const redis = ((globalThis as unknown) as Record<string, IORedis | undefined>)[REDIS_KEY];
  if (redis) {
    await redis.quit();
    ((globalThis as unknown) as Record<string, IORedis | null>)[REDIS_KEY] = null;
  }
}
