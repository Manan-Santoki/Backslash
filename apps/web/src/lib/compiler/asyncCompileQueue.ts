import { Queue } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type { Engine } from "@backslash/shared";

export interface AsyncCompileJobData {
  jobId: string;
  userId: string;
  engine: Engine;
  mainFile: string;
}

export const ASYNC_COMPILE_QUEUE_NAME = "compile-async";
export const ASYNC_COMPILE_CANCEL_KEY_PREFIX = "compile:async:cancel:";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

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

function isQueuedState(state: string): boolean {
  return (
    state === "waiting" ||
    state === "waiting-children" ||
    state === "delayed" ||
    state === "prioritized"
  );
}

export async function enqueueAsyncCompileJob(data: AsyncCompileJobData): Promise<void> {
  const queue = new Queue<AsyncCompileJobData>(ASYNC_COMPILE_QUEUE_NAME, {
    connection: REDIS_CONNECTION,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  });

  try {
    await queue.add("async-compile", data, { jobId: data.jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Job is already waiting") || message.includes("Job already exists")) {
      return;
    }
    throw err;
  } finally {
    await queue.close().catch(() => {});
  }
}

export async function requestAsyncCompileCancel(
  jobId: string
): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
  const queue = new Queue<AsyncCompileJobData>(ASYNC_COMPILE_QUEUE_NAME, {
    connection: REDIS_CONNECTION,
  });
  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  let wasQueued = false;
  let wasRunning = false;

  try {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === "active") {
        wasRunning = true;
      } else if (isQueuedState(state)) {
        await job.remove();
        wasQueued = true;
      }
    }

    await redis.setex(`${ASYNC_COMPILE_CANCEL_KEY_PREFIX}${jobId}`, 900, "1");
    return { wasQueued, wasRunning };
  } finally {
    await queue.close().catch(() => {});
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  }
}
