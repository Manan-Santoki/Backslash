import IORedis from "ioredis";
import type { ParsedLogEntry } from "@backslash/shared";

// ─── Redis Publisher ───────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const BUILD_CHANNEL = "build:updates";

let publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10_000,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
      reconnectOnError() {
        return true;
      },
    });

    publisher.on("error", (err) => {
      console.error("[Redis Pub] Connection error:", err.message);
    });

    publisher.on("connect", () => {
      console.log("[Redis Pub] Publisher connected");
    });
  }

  return publisher;
}

// ─── Build Update Payloads ─────────────────────────

/**
 * Payload for status-only build updates (queued, compiling).
 */
export interface BuildStatusPayload {
  projectId: string;
  buildId: string;
  status: "queued" | "compiling";
  triggeredByUserId?: string | null;
}

/**
 * Payload for completed build updates (success, error, timeout).
 */
export interface BuildCompletePayload {
  projectId: string;
  buildId: string;
  status: "success" | "error" | "timeout" | "canceled";
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
  triggeredByUserId?: string | null;
}

export type BuildUpdatePayload = BuildStatusPayload | BuildCompletePayload;

/**
 * Type guard — returns true when the payload represents a completed build.
 */
export function isBuildComplete(
  payload: BuildUpdatePayload
): payload is BuildCompletePayload {
  return (
    payload.status === "success" ||
    payload.status === "error" ||
    payload.status === "timeout" ||
    payload.status === "canceled"
  );
}

// ─── Room Naming ───────────────────────────────────

export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

export function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}

// ─── Broadcast via Redis Pub/Sub ───────────────────

/**
 * Publishes a build update to the Redis `build:updates` channel.
 * The standalone WebSocket server subscribes to this channel
 * and broadcasts the update to the appropriate client rooms.
 */
export function broadcastBuildUpdate(
  userId: string,
  payload: BuildUpdatePayload
): void {
  try {
    const message = JSON.stringify({ userId, payload });
    getPublisher()
      .publish(BUILD_CHANNEL, message)
      .catch((err: Error) => {
        console.error("[Broadcast] Redis publish error:", err.message);
      });
  } catch (err) {
    console.error(
      "[Broadcast] Failed to publish build update:",
      err instanceof Error ? err.message : err
    );
  }
}

// ─── File Events via Redis Pub/Sub ─────────────────

const FILE_CHANNEL = "file:updates";

export interface FileEventPayload {
  type: "file:created" | "file:deleted" | "file:saved";
  projectId: string;
  userId: string;
  fileId: string;
  path: string;
  isDirectory?: boolean;
}

/**
 * Publishes a file event to the Redis `file:updates` channel.
 * The standalone WS server forwards these to the project room.
 */
export function broadcastFileEvent(payload: FileEventPayload): void {
  try {
    const message = JSON.stringify(payload);
    getPublisher()
      .publish(FILE_CHANNEL, message)
      .catch((err: Error) => {
        console.error("[Broadcast] Redis file event publish error:", err.message);
      });
  } catch (err) {
    console.error(
      "[Broadcast] Failed to publish file event:",
      err instanceof Error ? err.message : err
    );
  }
}
