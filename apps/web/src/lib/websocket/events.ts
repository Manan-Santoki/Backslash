import type { ParsedLogEntry, BuildStatus } from "@leafedit/shared";
import type {
  ServerToClientEvents as SharedServerToClientEvents,
  ClientToServerEvents as SharedClientToServerEvents,
} from "@leafedit/shared";

// ─── Re-export shared event maps ───────────────────

export type {
  SharedServerToClientEvents as ServerToClientEvents,
  SharedClientToServerEvents as ClientToServerEvents,
};

// ─── Internal Server Event Payloads ────────────────

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
  status: BuildStatus;
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
}

/**
 * Union type for all build update payloads that `broadcastBuildUpdate` accepts.
 */
export type BuildUpdatePayload = BuildStatusPayload | BuildCompletePayload;

/**
 * Type guard to distinguish complete payloads from status-only payloads.
 */
export function isBuildComplete(
  payload: BuildUpdatePayload
): payload is BuildCompletePayload {
  return "logs" in payload;
}

// ─── Socket.IO Inter-server Events ─────────────────

/**
 * Events used for communication between Socket.IO server instances
 * when running in a multi-process or clustered setup.
 */
export interface InterServerEvents {
  ping: () => void;
}

// ─── Socket Data ───────────────────────────────────

/**
 * Per-socket data attached during authentication.
 */
export interface SocketData {
  userId: string;
  email: string;
  name: string;
}

// ─── Room Naming ───────────────────────────────────

/**
 * Returns the Socket.IO room name for a given user.
 * All of a user's connected sockets join this room so that
 * build updates can be broadcast to them regardless of which
 * browser tab or device originated the compile.
 */
export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Returns the Socket.IO room name for a specific project.
 * Used when clients want to observe builds for a particular project.
 */
export function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}
