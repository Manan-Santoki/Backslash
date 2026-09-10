import IORedis, { type RedisOptions } from "ioredis";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { getCompileQueueDepth } from "@/lib/compiler/compileQueue";
import { demoConfig } from "./config";
import type { DemoBlock } from "./guards";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisConnection(url: string): RedisOptions {
  const parsed = new URL(url);
  const dbIndex =
    parsed.pathname && parsed.pathname !== "/"
      ? Number(parsed.pathname.slice(1))
      : 0;

  return {
    host: parsed.hostname,
    port: Number(
      parsed.port || (parsed.protocol === "rediss:" ? "6380" : "6379")
    ),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

let redisInstance: IORedis | null = null;

function getRedis(): IORedis {
  if (!redisInstance) {
    redisInstance = new IORedis(REDIS_URL, {
      ...parseRedisConnection(REDIS_URL),
      keepAlive: 10_000,
      reconnectOnError: () => true,
    });
    redisInstance.on("error", (err) => {
      console.error("[demo] Redis error:", err.message);
    });
  }
  return redisInstance;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter. The window starts on the first request and is measured
 * from that point, which is accurate enough for demo abuse control.
 *
 * Fails open: if Redis is unavailable the action is allowed. Redis is a hard
 * dependency for compiling anyway, so a broken limiter is never the reason a
 * visitor cannot use the demo.
 */
export async function consumeRateLimit(
  scope: string,
  id: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  if (!demoConfig.enabled) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  if (limit <= 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }

  try {
    const redis = getRedis();
    const key = `demo:rl:${scope}:${id}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    let ttl = await redis.ttl(key);
    if (ttl < 0) ttl = windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: count <= limit ? 0 : ttl,
    };
  } catch (err) {
    console.error(
      `[demo] rate limit check failed (${scope}):`,
      err instanceof Error ? err.message : err
    );
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Instance-wide daily compile budget, so the demo cannot be farmed indefinitely.
 */
export async function consumeGlobalCompileBudget(
  limit: number
): Promise<RateLimitResult> {
  if (!demoConfig.enabled) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const windowSeconds = 24 * 60 * 60;

  if (limit <= 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }

  try {
    const redis = getRedis();
    const day = new Date().toISOString().slice(0, 10);
    const key = `demo:budget:compiles:${day}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds * 2);
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: count <= limit ? 0 : windowSeconds,
    };
  } catch (err) {
    console.error(
      "[demo] global budget check failed:",
      err instanceof Error ? err.message : err
    );
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export async function countUserInFlightBuilds(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(builds)
    .where(
      and(
        eq(builds.userId, userId),
        inArray(builds.status, ["queued", "compiling"])
      )
    );

  return row?.count ?? 0;
}

/**
 * Gate applied to every path that enqueues a project build. Returns a block
 * describing why the build must be refused, or null when it may proceed.
 *
 * Order matters: the cheap non-consuming checks run before the counters, so a
 * visitor refused because the demo is busy does not burn their hourly quota.
 */
export async function checkDemoCompileAllowance(
  userId: string
): Promise<DemoBlock | null> {
  if (!demoConfig.enabled) return null;

  const perHour = await consumeRateLimit(
    "compile",
    userId,
    demoConfig.compilesPerHour,
    3600
  );

  if (!perHour.allowed) {
    const minutes = Math.max(Math.ceil(perHour.retryAfterSeconds / 60), 1);
    return {
      status: 429,
      code: "demo_rate_limited",
      error: `Demo limit reached — ${demoConfig.compilesPerHour} compiles per hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds: perHour.retryAfterSeconds,
      extra: { limit: demoConfig.compilesPerHour },
    };
  }

  const inFlight = await countUserInFlightBuilds(userId);
  if (inFlight >= demoConfig.maxConcurrentPerUser) {
    return {
      status: 429,
      code: "demo_concurrency",
      error: `You already have ${inFlight} build${inFlight === 1 ? "" : "s"} running. Wait for ${inFlight === 1 ? "it" : "them"} to finish before starting another.`,
      retryAfterSeconds: 15,
      extra: { inFlight, limit: demoConfig.maxConcurrentPerUser },
    };
  }

  const queueDepth = await getCompileQueueDepth();
  if (queueDepth > demoConfig.maxQueueDepth) {
    return {
      status: 503,
      code: "demo_busy",
      error: "The demo is busy right now — please try compiling again in a moment.",
      retryAfterSeconds: 30,
    };
  }

  const budget = await consumeGlobalCompileBudget(
    demoConfig.globalCompilesPerDay
  );
  if (!budget.allowed) {
    return {
      status: 429,
      code: "demo_budget_exhausted",
      error:
        "The demo has used its compile budget for today. Try again tomorrow, or self-host Backslash for unlimited builds.",
      retryAfterSeconds: budget.retryAfterSeconds,
    };
  }

  return null;
}

/**
 * Best-effort client IP for per-IP limits. Only used when demo mode is on, so
 * deployments behind a proxy are unaffected.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}
