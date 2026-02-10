import type { Project, ProjectFile, Build, Engine, TemplateName, ParsedLogEntry } from "./project";
import type { User } from "./user";

// ─── Auth ───────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

// ─── Projects ───────────────────────────────────────

export interface CreateProjectRequest {
  name: string;
  description?: string;
  engine?: Engine;
  template?: TemplateName;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  engine?: Engine;
  mainFile?: string;
}

export interface ProjectListResponse {
  projects: (Project & {
    lastBuildStatus: Build["status"] | null;
    sharedWithCount?: number;
    anyoneShared?: boolean;
    isShared?: boolean;
  })[];
}

export interface ProjectDetailResponse {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
}

// ─── Files ──────────────────────────────────────────

export interface CreateFileRequest {
  path: string;
  content?: string;
  isDirectory?: boolean;
}

export interface UpdateFileRequest {
  content: string;
  autoCompile?: boolean;
}

export interface FileContentResponse {
  file: ProjectFile;
  content: string;
}

// ─── Compilation ────────────────────────────────────

export interface CompileRequest {
  engine?: Engine;
  force?: boolean;
}

export interface CompileResponse {
  buildId: string;
  status: "queued";
  message: string;
}

export interface BuildLogsResponse {
  build: Build;
  errors: ParsedLogEntry[];
}

// ─── General ────────────────────────────────────────

export interface ApiError {
  error: string;
  details?: string;
}

export interface SuccessResponse {
  success: true;
}

// ─── API Keys ───────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  requestCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  expiresInDays?: number;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  /** The full key — only shown once at creation time */
  key: string;
}

export interface ApiKeyListResponse {
  apiKeys: ApiKey[];
}

// ─── Public API v1 ──────────────────────────────────

export interface V1CompileRequest {
  /** Raw LaTeX source code to compile */
  source: string;
  /** LaTeX engine to use (default: pdflatex) */
  engine?: Engine;
}

export interface V1CompileResponse {
  /** Base64-encoded PDF */
  pdf: string;
  logs: string;
  errors: ParsedLogEntry[];
  durationMs: number;
}
