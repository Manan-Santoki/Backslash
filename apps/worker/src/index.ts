import IORedis from "ioredis";
import { randomUUID } from "crypto";

type RunnerModule = {
  startCompileRunner: () => unknown;
  shutdownRunner: () => Promise<void>;
  getRunnerHealth: () => {
    running: boolean;
    activeJobs: number;
    maxConcurrent: number;
    totalProcessed: number;
    totalErrors: number;
    uptimeMs: number;
    redisConnected: boolean;
  } | null;
};

type AsyncCompileRunnerModule = {
  startAsyncCompileRunner: () => unknown;
  shutdownAsyncCompileRunner: () => Promise<void>;
  getAsyncCompileRunnerHealth: () => {
    running: boolean;
    activeJobs: number;
    maxConcurrent: number;
    totalProcessed: number;
    totalErrors: number;
    uptimeMs: number;
    redisConnected: boolean;
  } | null;
};

let shutdownRunnerRef: (() => Promise<void>) | null = null;
let shutdownAsyncCompileRunnerRef: (() => Promise<void>) | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const HEARTBEAT_KEY = process.env.WORKER_HEARTBEAT_KEY || "compile:worker:heartbeat";
const HEARTBEAT_INTERVAL_MS = Math.max(
  parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || "5000", 10),
  1000
);
const HEARTBEAT_TTL_SECONDS = Math.max(
  Math.ceil((HEARTBEAT_INTERVAL_MS * 3) / 1000),
  5
);
const workerInstanceId = randomUUID();
const heartbeatRedis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function publishHeartbeat() {
  const payload = JSON.stringify({
    instanceId: workerInstanceId,
    pid: process.pid,
    ts: Date.now(),
  });
  await heartbeatRedis.set(HEARTBEAT_KEY, payload, "EX", HEARTBEAT_TTL_SECONDS);
}

async function bootstrap() {
  console.log("Backslash Compilation Worker");
  console.log("============================");
  console.log(`Redis: ${REDIS_URL}`);
  console.log(`Database: ${process.env.DATABASE_URL ? "[configured]" : "[default]"}`);
  console.log(`Compiler Image: ${process.env.COMPILER_IMAGE || "backslash-compiler"}`);
  console.log(`Max Concurrent Builds: ${process.env.MAX_CONCURRENT_BUILDS || "5"}`);
  console.log(`Compile Timeout: ${process.env.COMPILE_TIMEOUT || "120"}s`);
  console.log(`Heartbeat: key=${HEARTBEAT_KEY} interval=${HEARTBEAT_INTERVAL_MS}ms`);
  console.log("");

  const runnerModule = await import("../../web/src/lib/compiler/runner") as RunnerModule;
  const asyncCompileRunnerModule = await import(
    "../../web/src/lib/compiler/asyncCompileRunner"
  ) as AsyncCompileRunnerModule;
  runnerModule.startCompileRunner();
  asyncCompileRunnerModule.startAsyncCompileRunner();
  shutdownRunnerRef = runnerModule.shutdownRunner;
  shutdownAsyncCompileRunnerRef = asyncCompileRunnerModule.shutdownAsyncCompileRunner;

  await publishHeartbeat();
  heartbeatTimer = setInterval(() => {
    void publishHeartbeat().catch((err) => {
      console.error(
        "[Worker] Failed to publish heartbeat:",
        err instanceof Error ? err.message : err
      );
    });
  }, HEARTBEAT_INTERVAL_MS);

  console.log("Worker ready. Waiting for compilation jobs...");

  healthTimer = setInterval(() => {
    const health = runnerModule.getRunnerHealth();
    const asyncCompileHealth = asyncCompileRunnerModule.getAsyncCompileRunnerHealth();
    if (!health || !asyncCompileHealth) return;
    console.log(
      `[Worker] project=${health.activeJobs}/${health.maxConcurrent} async=${asyncCompileHealth.activeJobs}/${asyncCompileHealth.maxConcurrent} processed=${health.totalProcessed + asyncCompileHealth.totalProcessed} errors=${health.totalErrors + asyncCompileHealth.totalErrors} redis=${health.redisConnected && asyncCompileHealth.redisConnected ? "up" : "down"}`
    );
  }, 30_000);
}

async function gracefulShutdown(signal: string) {
  console.log(`\nShutting down worker (${signal})...`);
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  try {
    const current = await heartbeatRedis.get(HEARTBEAT_KEY);
    if (current) {
      const parsed = JSON.parse(current) as { instanceId?: string };
      if (parsed.instanceId === workerInstanceId) {
        await heartbeatRedis.del(HEARTBEAT_KEY);
      }
    }
  } catch {
    // Ignore heartbeat cleanup errors on shutdown
  }
  try {
    await heartbeatRedis.quit();
  } catch {
    // ignore
  }
  if (shutdownRunnerRef) {
    await shutdownRunnerRef();
  }
  if (shutdownAsyncCompileRunnerRef) {
    await shutdownAsyncCompileRunnerRef();
  }
  process.exit(0);
}

bootstrap().catch((error) => {
  console.error("[Worker] Failed to start:", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
