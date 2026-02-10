export type Engine = "pdflatex" | "xelatex" | "lualatex" | "latex";

export type BuildStatus =
  | "queued"
  | "compiling"
  | "success"
  | "error"
  | "timeout"
  | "canceled";

export type TemplateName = "blank" | "article" | "thesis" | "beamer" | "letter";

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string;
  engine: Engine;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  isDirectory: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Build {
  id: string;
  projectId: string;
  userId: string;
  status: BuildStatus;
  engine: Engine;
  logs: string;
  durationMs: number | null;
  pdfPath: string | null;
  exitCode: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ParsedLogEntry {
  type: "error" | "warning" | "info";
  file: string;
  line: number;
  message: string;
}
