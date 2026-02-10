import type { BuildStatus } from "./project";

// ─── Share Roles ────────────────────────────────────

export type ShareRole = "viewer" | "editor";

// ─── Collaborator ───────────────────────────────────

export interface Collaborator {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: ShareRole;
  createdAt: string;
  expiresAt?: string | null;
}

export interface PublicShareSettings {
  enabled: boolean;
  role: ShareRole;
  expiresAt: string | null;
}

// ─── Presence ───────────────────────────────────────

export interface PresenceUser {
  userId: string;
  name: string;
  email: string;
  color: string;
  activeFileId: string | null;
  activeFilePath: string | null;
}

// ─── Cursor ─────────────────────────────────────────

export interface CursorPosition {
  line: number;
  ch: number;
}

export interface CursorSelection {
  anchor: CursorPosition;
  head: CursorPosition;
}

// ─── Chat ───────────────────────────────────────────

export type ChatMessageKind = "user" | "system" | "build";

export interface ChatBuildMetadata {
  buildId: string;
  status: BuildStatus;
  durationMs?: number | null;
  actorUserId?: string | null;
  actorName?: string | null;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  kind?: ChatMessageKind;
  build?: ChatBuildMetadata;
}

// ─── Share API ──────────────────────────────────────

export interface ShareProjectRequest {
  email: string;
  role: ShareRole;
}

export interface UpdateShareRequest {
  role: ShareRole;
}

export interface CollaboratorListResponse {
  collaborators: Collaborator[];
}
