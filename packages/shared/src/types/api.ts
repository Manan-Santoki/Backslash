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
  projects: (Project & { lastBuildStatus: Build["status"] | null })[];
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
