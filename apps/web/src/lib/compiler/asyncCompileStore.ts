import fs from "fs/promises";
import path from "path";
import type { BuildStatus, Engine, ParsedLogEntry } from "@backslash/shared";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";
const ASYNC_COMPILE_ROOT = path.join(STORAGE_PATH, "async-compiles");

export const ASYNC_COMPILE_RESULT_TTL_MINUTES = Math.max(
  parseInt(process.env.ASYNC_COMPILE_RESULT_TTL_MINUTES || "60", 10),
  1
);

export type AsyncCompileStatus = BuildStatus;

export interface AsyncCompileMetadata {
  id: string;
  userId: string;
  status: AsyncCompileStatus;
  requestedEngine: Engine;
  engineUsed?: Exclude<Engine, "auto">;
  mainFile: string;
  sourcePath: string;
  pdfPath?: string;
  logsPath?: string;
  errorsPath?: string;
  warningCount: number;
  errorCount: number;
  durationMs?: number;
  exitCode?: number;
  message?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
}

export function getAsyncCompileRootDir(): string {
  return ASYNC_COMPILE_ROOT;
}

export function getAsyncCompileJobDir(jobId: string): string {
  return path.join(ASYNC_COMPILE_ROOT, jobId);
}

export function getAsyncCompileMetadataPath(jobId: string): string {
  return path.join(getAsyncCompileJobDir(jobId), "metadata.json");
}

export function getAsyncCompileSourcePath(
  jobId: string,
  mainFile: string = "main.tex"
): string {
  return path.join(getAsyncCompileJobDir(jobId), mainFile);
}

export function getAsyncCompilePdfPath(
  jobId: string,
  mainFile: string = "main.tex"
): string {
  return path.join(
    getAsyncCompileJobDir(jobId),
    mainFile.replace(/\.tex$/i, ".pdf")
  );
}

export function getAsyncCompileLogsPath(jobId: string): string {
  return path.join(getAsyncCompileJobDir(jobId), "compile.log");
}

export function getAsyncCompileErrorsPath(jobId: string): string {
  return path.join(getAsyncCompileJobDir(jobId), "errors.json");
}

export function computeAsyncCompileExpiryIso(): string {
  return new Date(
    Date.now() + ASYNC_COMPILE_RESULT_TTL_MINUTES * 60_000
  ).toISOString();
}

export function isTerminalStatus(status: AsyncCompileStatus): boolean {
  return ["success", "error", "timeout", "canceled"].includes(status);
}

export function isExpired(meta: AsyncCompileMetadata): boolean {
  if (!meta.expiresAt) return false;
  return new Date(meta.expiresAt).getTime() <= Date.now();
}

export async function ensureAsyncCompileRootDir(): Promise<void> {
  await fs.mkdir(ASYNC_COMPILE_ROOT, { recursive: true });
}

export async function createAsyncCompileJob(params: {
  jobId: string;
  userId: string;
  source: string;
  requestedEngine: Engine;
  mainFile?: string;
}): Promise<AsyncCompileMetadata> {
  const mainFile = params.mainFile ?? "main.tex";
  const jobDir = getAsyncCompileJobDir(params.jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const sourcePath = getAsyncCompileSourcePath(params.jobId, mainFile);
  await fs.writeFile(sourcePath, params.source, "utf-8");

  const nowIso = new Date().toISOString();
  const meta: AsyncCompileMetadata = {
    id: params.jobId,
    userId: params.userId,
    status: "queued",
    requestedEngine: params.requestedEngine,
    mainFile,
    sourcePath: path.basename(sourcePath),
    warningCount: 0,
    errorCount: 0,
    createdAt: nowIso,
  };

  await writeAsyncCompileMetadata(meta);
  return meta;
}

export async function readAsyncCompileMetadata(
  jobId: string
): Promise<AsyncCompileMetadata | null> {
  try {
    const raw = await fs.readFile(getAsyncCompileMetadataPath(jobId), "utf-8");
    return JSON.parse(raw) as AsyncCompileMetadata;
  } catch {
    return null;
  }
}

export async function writeAsyncCompileMetadata(
  meta: AsyncCompileMetadata
): Promise<void> {
  await fs.mkdir(getAsyncCompileJobDir(meta.id), { recursive: true });
  await fs.writeFile(
    getAsyncCompileMetadataPath(meta.id),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );
}

export async function patchAsyncCompileMetadata(
  jobId: string,
  patch: Partial<AsyncCompileMetadata>
): Promise<AsyncCompileMetadata | null> {
  const current = await readAsyncCompileMetadata(jobId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
  };
  await writeAsyncCompileMetadata(next);
  return next;
}

export async function writeAsyncCompileLogs(
  jobId: string,
  logs: string
): Promise<string> {
  const logsPath = getAsyncCompileLogsPath(jobId);
  await fs.mkdir(path.dirname(logsPath), { recursive: true });
  await fs.writeFile(logsPath, logs, "utf-8");
  return path.basename(logsPath);
}

export async function readAsyncCompileLogs(jobId: string): Promise<string> {
  try {
    return await fs.readFile(getAsyncCompileLogsPath(jobId), "utf-8");
  } catch {
    return "";
  }
}

export async function writeAsyncCompileErrors(
  jobId: string,
  entries: ParsedLogEntry[]
): Promise<string> {
  const errorsPath = getAsyncCompileErrorsPath(jobId);
  await fs.mkdir(path.dirname(errorsPath), { recursive: true });
  await fs.writeFile(errorsPath, JSON.stringify(entries, null, 2), "utf-8");
  return path.basename(errorsPath);
}

export async function readAsyncCompileErrors(
  jobId: string
): Promise<ParsedLogEntry[]> {
  try {
    const raw = await fs.readFile(getAsyncCompileErrorsPath(jobId), "utf-8");
    return JSON.parse(raw) as ParsedLogEntry[];
  } catch {
    return [];
  }
}

export async function deleteAsyncCompileJob(jobId: string): Promise<void> {
  await fs.rm(getAsyncCompileJobDir(jobId), { recursive: true, force: true });
}

export async function listAsyncCompileJobIds(): Promise<string[]> {
  try {
    await ensureAsyncCompileRootDir();
    const entries = await fs.readdir(ASYNC_COMPILE_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

