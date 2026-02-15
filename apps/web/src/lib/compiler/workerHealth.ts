import IORedis from "ioredis";

export function isWorkerExpectedInWeb(): boolean {
  return process.env.RUN_COMPILE_RUNNER_IN_WEB !== "false";
}

export async function isDedicatedWorkerHealthy(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const workerHeartbeatKey =
    process.env.WORKER_HEARTBEAT_KEY || "compile:worker:heartbeat";
  const workerHeartbeatMaxAgeMs = Math.max(
    parseInt(process.env.WORKER_HEARTBEAT_MAX_AGE_MS || "30000", 10),
    5000
  );

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const raw = await redis.get(workerHeartbeatKey);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as { ts?: number };
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    const ageMs = Date.now() - ts;
    return ageMs >= 0 && ageMs <= workerHeartbeatMaxAgeMs;
  } catch {
    return false;
  } finally {
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  }
}

