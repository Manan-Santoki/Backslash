import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { enqueueCompileJob } from "@/lib/compiler/compileQueue";
import { broadcastBuildUpdate } from "@/lib/websocket/server";
import { healthCheck as dockerHealthCheck, getDockerClient } from "@/lib/compiler/docker";
import {
  isDedicatedWorkerHealthy,
  isWorkerExpectedInWeb,
} from "@/lib/compiler/workerHealth";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { Engine } from "@backslash/shared";

export interface TriggerCompileParams {
  projectId: string;
  /** Owner of the project storage directory. */
  storageUserId: string;
  /** User who triggered the build, or null for anonymous share-link editors. */
  actorUserId: string | null;
  engine: Engine;
  mainFile: string;
}

export type TriggerCompileResult =
  | { ok: true; buildId: string }
  | { ok: false; status: number; error: string };

/**
 * Verifies the compile runner is reachable, records a queued build and
 * enqueues the compile job. Shared by the compile API and the AI assistant.
 */
export async function triggerCompile(
  params: TriggerCompileParams
): Promise<TriggerCompileResult> {
  const { projectId, storageUserId, actorUserId, engine, mainFile } = params;
  const buildUserId = actorUserId ?? storageUserId;

  if (isWorkerExpectedInWeb()) {
    // ── Pre-flight: verify Docker is reachable ───────
    const dockerOk = await dockerHealthCheck();
    if (!dockerOk) {
      console.error("[Compile] Docker daemon is not reachable");
      return {
        ok: false,
        status: 503,
        error: "Compilation service unavailable — Docker daemon not reachable",
      };
    }

    // ── Pre-flight: verify compiler image exists ─────
    try {
      const docker = getDockerClient();
      const compilerImage = process.env.COMPILER_IMAGE || "backslash-compiler";
      const images = await docker.listImages({
        filters: { reference: [compilerImage] },
      });
      if (images.length === 0) {
        console.error(`[Compile] Compiler image "${compilerImage}" not found`);
        return {
          ok: false,
          status: 503,
          error: `Compiler image "${compilerImage}" not found on Docker host`,
        };
      }
    } catch (imgErr) {
      console.error("[Compile] Failed to check compiler image:", imgErr);
      return {
        ok: false,
        status: 503,
        error: "Compilation service unavailable — unable to verify compiler image",
      };
    }
  } else {
    const workerHealthy = await isDedicatedWorkerHealthy();
    if (!workerHealthy) {
      return {
        ok: false,
        status: 503,
        error: "Compilation worker unavailable — try again shortly",
      };
    }
  }

  const buildId = uuidv4();

  // Create a build record with status "queued"
  await db.insert(builds).values({
    id: buildId,
    projectId,
    userId: buildUserId,
    status: "queued",
    engine,
  });

  await db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Enqueue compile job
  await enqueueCompileJob({
    buildId,
    projectId,
    userId: buildUserId,
    storageUserId,
    triggeredByUserId: actorUserId,
    engine,
    mainFile,
  });

  broadcastBuildUpdate(buildUserId, {
    projectId,
    buildId,
    status: "queued",
    triggeredByUserId: actorUserId,
  });

  return { ok: true, buildId };
}
