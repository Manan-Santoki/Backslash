import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { Engine } from "@backslash/shared";

// ─── Redis Connection ──────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisInstance: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!redisInstance) {
    redisInstance = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });

    redisInstance.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redisInstance.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });
  }

  return redisInstance;
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

let compileQueueInstance: Queue<CompileJobData, CompileJobResult> | null = null;

export function getCompileQueue(): Queue<CompileJobData, CompileJobResult> {
  if (!compileQueueInstance) {
    compileQueueInstance = new Queue<CompileJobData, CompileJobResult>(
      QUEUE_NAME,
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: {
            age: 3600, // keep completed jobs for 1 hour
            count: 200,
          },
          removeOnFail: {
            age: 86400, // keep failed jobs for 24 hours
            count: 500,
          },
        },
      }
    );
  }

  return compileQueueInstance;
}

// ─── Job Helpers ───────────────────────────────────

/**
 * Adds a compile job to the queue with deduplication.
 *
 * Uses `projectId` as the deduplication key so that if a compilation
 * for the same project is already queued (but not yet actively running),
 * the duplicate is dropped. Once a job starts processing it is no longer
 * considered for deduplication, allowing a new build to be queued while
 * the previous one is in progress.
 */
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
  if (compileQueueInstance) {
    await compileQueueInstance.close();
    compileQueueInstance = null;
  }

  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
