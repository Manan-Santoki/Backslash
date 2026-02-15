import { NextResponse } from "next/server";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { getRunnerHealth } from "@/lib/compiler/runner";
import { getAsyncCompileRunnerHealth } from "@/lib/compiler/asyncCompileRunner";
import { COMPILE_QUEUE_NAME } from "@/lib/compiler/compileQueue";
import { ASYNC_COMPILE_QUEUE_NAME } from "@/lib/compiler/asyncCompileQueue";
import { getDockerClient, healthCheck as dockerHealthCheck } from "@/lib/compiler/docker";

// ─── GET /api/health ────────────────────────────────
// Diagnostic endpoint — checks every component in the build pipeline.
// Call this after deploy to immediately see what's broken.

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const workerHeartbeatKey =
    process.env.WORKER_HEARTBEAT_KEY || "compile:worker:heartbeat";
  const workerHeartbeatMaxAgeMs = Math.max(
    parseInt(process.env.WORKER_HEARTBEAT_MAX_AGE_MS || "30000", 10),
    5000
  );

  const parseRedisConnection = (url: string) => {
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
  };

  // 1. Redis
  try {
    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await redis.connect();
    const pong = await redis.ping();
    checks.redis = { ok: pong === "PONG", detail: pong };
    await redis.quit();
  } catch (err) {
    checks.redis = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. BullMQ queue
  try {
    const queue = new Queue(COMPILE_QUEUE_NAME, {
      connection: parseRedisConnection(redisUrl),
    });
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    checks.compile_queue = {
      ok: true,
      detail: `waiting=${counts.waiting ?? 0} active=${counts.active ?? 0} delayed=${counts.delayed ?? 0} failed=${counts.failed ?? 0} completed=${counts.completed ?? 0}`,
    };
    await queue.close();
  } catch (err) {
    checks.compile_queue = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 2b. Async compile queue
  try {
    const queue = new Queue(ASYNC_COMPILE_QUEUE_NAME, {
      connection: parseRedisConnection(redisUrl),
    });
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    checks.async_compile_queue = {
      ok: true,
      detail: `waiting=${counts.waiting ?? 0} active=${counts.active ?? 0} delayed=${counts.delayed ?? 0} failed=${counts.failed ?? 0} completed=${counts.completed ?? 0}`,
    };
    await queue.close();
  } catch (err) {
    checks.async_compile_queue = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Compile Runner (web process only)
  {
    const runInWeb = process.env.RUN_COMPILE_RUNNER_IN_WEB;
    const runnerExpectedInWeb = runInWeb !== "false";

    if (!runnerExpectedInWeb) {
      checks.compile_runner = {
        ok: true,
        detail: "disabled in web (expected external worker)",
      };
    } else {
      const health = getRunnerHealth();
      checks.compile_runner = {
        ok: health ? health.running && health.redisConnected : false,
        detail: health
          ? `active=${health.activeJobs}/${health.maxConcurrent} processed=${health.totalProcessed} errors=${health.totalErrors}`
          : "Runner not started",
      };
    }
  }

  // 3b. Async compile runner (web process only)
  {
    const runInWeb = process.env.RUN_COMPILE_RUNNER_IN_WEB;
    const runnerExpectedInWeb = runInWeb !== "false";

    if (!runnerExpectedInWeb) {
      checks.async_compile_runner = {
        ok: true,
        detail: "disabled in web (expected external worker)",
      };
    } else {
      const health = getAsyncCompileRunnerHealth();
      checks.async_compile_runner = {
        ok: health ? health.running && health.redisConnected : false,
        detail: health
          ? `active=${health.activeJobs}/${health.maxConcurrent} processed=${health.totalProcessed} errors=${health.totalErrors}`
          : "Runner not started",
      };
    }
  }

  // 4. Dedicated compile worker heartbeat (when web runner is disabled)
  {
    const runInWeb = process.env.RUN_COMPILE_RUNNER_IN_WEB;
    const runnerExpectedInWeb = runInWeb !== "false";

    if (runnerExpectedInWeb) {
      checks.compile_worker = {
        ok: true,
        detail: "not required (web runner enabled)",
      };
    } else {
      try {
        const redis = new IORedis(redisUrl, {
          maxRetriesPerRequest: 3,
          connectTimeout: 5000,
          lazyConnect: true,
        });
        await redis.connect();
        const raw = await redis.get(workerHeartbeatKey);
        await redis.quit();

        if (!raw) {
          checks.compile_worker = {
            ok: false,
            detail: `No heartbeat found at key "${workerHeartbeatKey}"`,
          };
        } else {
          const parsed = JSON.parse(raw) as {
            instanceId?: string;
            ts?: number;
          };
          const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
          const ageMs = Date.now() - ts;
          checks.compile_worker = {
            ok: ageMs >= 0 && ageMs <= workerHeartbeatMaxAgeMs,
            detail: `instance=${parsed.instanceId || "unknown"} ageMs=${ageMs}`,
          };
        }
      } catch (err) {
        checks.compile_worker = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  // 5. Docker socket
  try {
    const dockerOk = await dockerHealthCheck();
    checks.docker_socket = { ok: dockerOk, detail: dockerOk ? "reachable" : "ping failed" };
  } catch (err) {
    checks.docker_socket = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 6. Compiler image
  try {
    const docker = getDockerClient();
    const compilerImage = process.env.COMPILER_IMAGE || "backslash-compiler";
    const images = await docker.listImages({
      filters: { reference: [compilerImage] },
    });
    checks.compiler_image = {
      ok: images.length > 0,
      detail: images.length > 0
        ? `found: ${images[0].RepoTags?.join(", ") || images[0].Id.slice(0, 12)}`
        : `image "${compilerImage}" not found — run compiler-image build first`,
    };
  } catch (err) {
    checks.compiler_image = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 7. Project volume
  try {
    const docker = getDockerClient();
    const volumeName = process.env.PROJECTS_VOLUME || "backslash-project-data";
    const volume = await docker.getVolume(volumeName).inspect();
    checks.project_volume = {
      ok: true,
      detail: `name=${volume.Name} driver=${volume.Driver}`,
    };
  } catch (err) {
    checks.project_volume = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 8. Storage path
  try {
    const fs = await import("fs/promises");
    const storagePath = process.env.STORAGE_PATH || "/data";
    const entries = await fs.readdir(storagePath);
    checks.storage_path = {
      ok: true,
      detail: `${storagePath} contains: ${entries.join(", ") || "(empty)"}`,
    };
  } catch (err) {
    checks.storage_path = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { status: allOk ? "healthy" : "unhealthy", checks },
    { status: allOk ? 200 : 503 }
  );
}
