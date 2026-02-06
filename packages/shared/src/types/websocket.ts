import type { BuildStatus, ParsedLogEntry } from "./project";

// ─── Server → Client Events ────────────────────────

export interface BuildStatusEvent {
  type: "build:status";
  projectId: string;
  buildId: string;
  status: "queued" | "compiling";
}

export interface BuildCompleteEvent {
  type: "build:complete";
  projectId: string;
  buildId: string;
  status: BuildStatus;
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
}

export type ServerToClientEvent = BuildStatusEvent | BuildCompleteEvent;

// ─── Client → Server Events ────────────────────────

export interface JoinProjectEvent {
  type: "join:project";
  projectId: string;
}

export type ClientToServerEvent = JoinProjectEvent;

// ─── Socket.IO Event Maps ──────────────────────────

export interface ServerToClientEvents {
  "build:status": (data: Omit<BuildStatusEvent, "type">) => void;
  "build:complete": (data: Omit<BuildCompleteEvent, "type">) => void;
}

export interface ClientToServerEvents {
  "join:project": (data: { projectId: string }) => void;
}
