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

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
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
