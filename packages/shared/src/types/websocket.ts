import type { BuildStatus, ParsedLogEntry } from "./project";
import type { PresenceUser, CursorSelection, ChatMessage } from "./collaboration";

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
  // Build events
  "build:status": (data: Omit<BuildStatusEvent, "type">) => void;
  "build:complete": (data: Omit<BuildCompleteEvent, "type">) => void;

  // Presence events
  "presence:users": (data: { users: PresenceUser[] }) => void;
  "presence:joined": (data: { user: PresenceUser }) => void;
  "presence:left": (data: { userId: string }) => void;
  "presence:updated": (data: { userId: string; activeFileId: string | null; activeFilePath: string | null }) => void;

  // Cursor events
  "cursor:updated": (data: { userId: string; fileId: string; selection: CursorSelection }) => void;
  "cursor:cleared": (data: { userId: string }) => void;

  // Document change events (collaborative editing)
  "doc:changed": (data: {
    userId: string;
    fileId: string;
    changes: DocChange[];
    version: number;
  }) => void;

  // Chat events
  "chat:message": (data: ChatMessage) => void;
  "chat:history": (data: { messages: ChatMessage[] }) => void;

  // File events (real-time file tree updates)
  "file:created": (data: { userId: string; file: { id: string; path: string; isDirectory: boolean } }) => void;
  "file:deleted": (data: { userId: string; fileId: string; path: string }) => void;
  "file:saved": (data: { userId: string; fileId: string; path: string }) => void;
}

export interface ClientToServerEvents {
  // Room management
  "join:project": (data: { projectId: string }) => void;
  "leave:project": (data: { projectId: string }) => void;

  // Presence
  "presence:activeFile": (data: { fileId: string | null; filePath: string | null }) => void;

  // Cursor
  "cursor:move": (data: { fileId: string; selection: CursorSelection }) => void;

  // Document changes
  "doc:change": (data: { fileId: string; changes: DocChange[]; version: number }) => void;

  // Chat
  "chat:send": (data: { text: string }) => void;
}

// ─── Document Change Types ─────────────────────────

export interface DocChange {
  /** Byte offset in the document where the change starts */
  from: number;
  /** Byte offset in the document where the change ends (for deletions) */
  to: number;
  /** The text to insert at `from` (empty string for pure deletions) */
  insert: string;
}
