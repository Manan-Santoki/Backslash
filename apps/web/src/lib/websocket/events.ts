import type { ParsedLogEntry, BuildStatus } from "@backslash/shared";

// ─── Re-export shared event types ──────────────────

export type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@backslash/shared";

// ─── Internal Build Update Payloads ────────────────

/**
 * Payload for status-only build updates (queued, compiling).
 */
export interface BuildStatusPayload {
  projectId: string;
  buildId: string;
  status: "queued" | "compiling";
}

/**
 * Payload for completed build updates (success, error, timeout).
 */
export interface BuildCompletePayload {
  projectId: string;
  buildId: string;
  status: "success" | "error" | "timeout";
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
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
    payload.status === "timeout"
  );
}

// ─── Room Naming ───────────────────────────────────

export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

export function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}
