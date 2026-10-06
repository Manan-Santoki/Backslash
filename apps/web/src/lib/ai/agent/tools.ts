import { db } from "@/lib/db";
import { builds, projectFiles, projects } from "@/lib/db/schema";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { triggerCompile } from "@/lib/compiler/triggerCompile";
import { checkDemoCompileAllowance } from "@/lib/demo";
import { validateFilePath } from "@/lib/utils/validation";
import { broadcastFileEvent } from "@/lib/websocket/server";
import * as storage from "@/lib/storage";
import { MIME_TYPES, type Engine } from "@backslash/shared";
import { and, desc, eq, like, or } from "drizzle-orm";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { AgentToolDefinition } from "@/lib/ai/agent/llm";

// ─── Context ───────────────────────────────────────

type ProjectRow = typeof projects.$inferSelect;
type ProjectFileRow = typeof projectFiles.$inferSelect;

export interface AgentToolContext {
  project: ProjectRow;
  role: "owner" | "editor" | "viewer";
  userId: string;
  signal?: AbortSignal;
  /** Called when a compile is queued so the client can follow the build. */
  onBuildQueued?: (buildId: string) => void;
}

export interface AgentToolResult {
  /** Text returned to the model. */
  output: string;
  /** Short human-readable summary for the chat UI. */
  summary: string;
  isError?: boolean;
  /** Project paths whose content or existence changed. */
  changedPaths?: string[];
  /** True when the file tree or project settings changed. */
  treeChanged?: boolean;
}

const ENGINES: Engine[] = ["auto", "pdflatex", "xelatex", "lualatex", "latex"];
const MAX_READ_CHARS = 120_000;
const MAX_SEARCH_RESULTS = 100;
const BUILD_WAIT_MS = 150_000;
const TEXT_EXTENSIONS = new Set([
  ".tex", ".bib", ".cls", ".sty", ".bst", ".tikz", ".pgf", ".txt", ".md",
  ".csv", ".dat", ".svg", ".json", ".yaml", ".yml", ".lua", ".bbx", ".cbx",
  ".def", ".cfg", ".ist", ".log",
]);

// ─── Tool definitions ──────────────────────────────

export const agentTools: AgentToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List every file and folder in the project with sizes. The main (entrypoint) file is marked.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_file",
    description:
      "Read a text file. Returns content with 1-based line numbers (\"12| text\"). Use startLine/endLine for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path, e.g. chapters/intro.tex" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description:
      "Search all text files for a string (case-insensitive) or a regular expression. Returns path:line: text matches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        regex: { type: "boolean", description: "Treat query as a JavaScript regular expression" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Create a file or fully overwrite an existing one. Missing parent folders are created. Prefer edit_file for small changes to existing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. oldString must match the file exactly (whitespace included, without line-number prefixes) and be unique unless replaceAll is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["path", "oldString", "newString"],
      additionalProperties: false,
    },
  },
  {
    name: "create_folder",
    description: "Create a folder (and any missing parent folders).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "move_path",
    description:
      "Rename or move a file or folder. Remember to update \\input/\\include/\\includegraphics references that point to the old path.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_path",
    description: "Delete a file, or a folder with everything inside it. This cannot be undone.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "compile",
    description:
      "Compile the project to PDF and wait for the result. Returns status, errors and the log tail.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_build_logs",
    description: "Get the latest build's status, parsed errors/warnings and log tail.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_pdf_info",
    description: "Check whether a compiled PDF exists and get its page count, size and age.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project_settings",
    description: "Get project name, description, compile engine and main file.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_project_settings",
    description:
      "Update project settings. mainFile must be an existing .tex file. name, description and engine can only be changed by the project owner.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        engine: { type: "string", enum: ENGINES },
        mainFile: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

// ─── Helpers ───────────────────────────────────────

class ToolError extends Error {}

function normalizePath(value: unknown): string {
  if (typeof value !== "string") throw new ToolError("path must be a string");
  const normalized = path.posix
    .normalize(value.trim().replace(/\\/g, "/"))
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized || normalized === ".") throw new ToolError("path is required");
  const validation = validateFilePath(normalized);
  if (!validation.valid) {
    throw new ToolError(validation.error ?? `Invalid path: ${normalized}`);
  }
  return normalized;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new ToolError(`${key} must be a string`);
  return value;
}

function isTextFile(file: ProjectFileRow): boolean {
  if (file.isDirectory) return false;
  const ext = path.extname(file.path).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return Boolean(file.mimeType?.startsWith("text/"));
}

function tailLines(input: string, maxLines: number): string {
  const lines = input.split("\n");
  return lines.length <= maxLines ? input : lines.slice(-maxLines).join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function listProjectFiles(projectId: string): Promise<ProjectFileRow[]> {
  return db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(projectFiles.path);
}

async function findFile(projectId: string, filePath: string): Promise<ProjectFileRow | null> {
  const [file] = await db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)))
    .limit(1);
  return file ?? null;
}

async function requireFile(projectId: string, filePath: string): Promise<ProjectFileRow> {
  const file = await findFile(projectId, filePath);
  if (!file) throw new ToolError(`No file or folder at "${filePath}". Use list_files to see paths.`);
  return file;
}

async function readText(ctx: AgentToolContext, file: ProjectFileRow): Promise<string> {
  if (!isTextFile(file)) {
    throw new ToolError(
      `"${file.path}" is a binary file (${file.mimeType ?? "unknown type"}, ${formatSize(file.sizeBytes ?? 0)}) and cannot be read as text.`
    );
  }
  const projectDir = storage.getProjectDir(ctx.project.userId, ctx.project.id);
  return storage.readFile(path.join(projectDir, file.path)).catch(() => "");
}

async function touchProject(projectId: string, set: Partial<ProjectRow> = {}) {
  await db
    .update(projects)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

/** Creates DB rows (and disk folders) for every missing ancestor of filePath. */
async function ensureParentFolders(ctx: AgentToolContext, filePath: string): Promise<void> {
  const parts = filePath.split("/");
  const projectDir = storage.getProjectDir(ctx.project.userId, ctx.project.id);
  for (let i = 1; i < parts.length; i++) {
    const dirPath = parts.slice(0, i).join("/");
    const existing = await findFile(ctx.project.id, dirPath);
    if (existing) {
      if (!existing.isDirectory) {
        throw new ToolError(`"${dirPath}" is a file, so it cannot contain "${filePath}"`);
      }
      continue;
    }
    await storage.createDirectory(path.join(projectDir, dirPath));
    const fileId = uuidv4();
    await db.insert(projectFiles).values({
      id: fileId,
      projectId: ctx.project.id,
      path: dirPath,
      mimeType: "inode/directory",
      sizeBytes: 0,
      isDirectory: true,
    });
    broadcastFileEvent({
      type: "file:created",
      projectId: ctx.project.id,
      userId: ctx.userId,
      fileId,
      path: dirPath,
      isDirectory: true,
    });
  }
}

async function writeText(
  ctx: AgentToolContext,
  filePath: string,
  content: string
): Promise<{ created: boolean }> {
  const projectDir = storage.getProjectDir(ctx.project.userId, ctx.project.id);
  const existing = await findFile(ctx.project.id, filePath);
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  if (existing) {
    if (existing.isDirectory) throw new ToolError(`"${filePath}" is a folder`);
    if (!isTextFile(existing)) throw new ToolError(`"${filePath}" is a binary file`);
    await storage.writeFile(path.join(projectDir, filePath), content);
    await db
      .update(projectFiles)
      .set({ sizeBytes, updatedAt: new Date() })
      .where(eq(projectFiles.id, existing.id));
    await touchProject(ctx.project.id);
    broadcastFileEvent({
      type: "file:saved",
      projectId: ctx.project.id,
      userId: ctx.userId,
      fileId: existing.id,
      path: filePath,
    });
    return { created: false };
  }

  await ensureParentFolders(ctx, filePath);
  await storage.writeFile(path.join(projectDir, filePath), content);
  const ext = path.extname(filePath).toLowerCase();
  const fileId = uuidv4();
  await db.insert(projectFiles).values({
    id: fileId,
    projectId: ctx.project.id,
    path: filePath,
    mimeType: MIME_TYPES[ext] || "text/plain",
    sizeBytes,
    isDirectory: false,
  });
  await touchProject(ctx.project.id);
  broadcastFileEvent({
    type: "file:created",
    projectId: ctx.project.id,
    userId: ctx.userId,
    fileId,
    path: filePath,
    isDirectory: false,
  });
  return { created: true };
}

async function buildReport(projectId: string, buildId?: string): Promise<string> {
  const [build] = await db
    .select()
    .from(builds)
    .where(buildId ? eq(builds.id, buildId) : eq(builds.projectId, projectId))
    .orderBy(desc(builds.createdAt))
    .limit(1);

  if (!build) return "No builds yet. Use compile to build the project.";

  const entries = parseLatexLog(build.logs ?? "");
  const errors = entries.filter((entry) => entry.type === "error").slice(0, 20);
  const warnings = entries.filter((entry) => entry.type === "warning").slice(0, 15);
  const formatEntry = (entry: (typeof entries)[number]) =>
    `- ${entry.file || "?"}${entry.line ? `:${entry.line}` : ""} ${entry.message}`;

  return [
    `Build ${build.id}: ${build.status}${build.durationMs ? ` in ${build.durationMs}ms` : ""} (engine ${build.engine})`,
    errors.length ? `Errors:\n${errors.map(formatEntry).join("\n")}` : "Errors: none parsed",
    warnings.length ? `Warnings:\n${warnings.map(formatEntry).join("\n")}` : "",
    `Log tail:\n${tailLines(build.logs ?? "", 60).slice(-8_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function requireEditor(ctx: AgentToolContext) {
  if (ctx.role === "viewer") throw new ToolError("Viewers cannot modify this project");
}

// ─── Tool implementations ──────────────────────────

type ToolHandler = (
  ctx: AgentToolContext,
  args: Record<string, unknown>
) => Promise<AgentToolResult>;

const handlers: Record<string, ToolHandler> = {
  async list_files(ctx) {
    const files = await listProjectFiles(ctx.project.id);
    if (files.length === 0) return { output: "The project is empty.", summary: "Listed files" };
    const lines = files.map((file) => {
      if (file.isDirectory) return `${file.path}/`;
      const main = file.path === ctx.project.mainFile ? "  [main]" : "";
      return `${file.path}  (${formatSize(file.sizeBytes ?? 0)})${main}`;
    });
    return { output: lines.join("\n"), summary: `Listed ${files.length} entries` };
  },

  async read_file(ctx, args) {
    const filePath = normalizePath(args.path);
    const file = await requireFile(ctx.project.id, filePath);
    if (file.isDirectory) throw new ToolError(`"${filePath}" is a folder; use list_files`);
    const lines = (await readText(ctx, file)).split(/\r?\n/);
    const start = Math.max(1, Number(args.startLine) || 1);
    const end = Math.min(lines.length, Number(args.endLine) || lines.length);
    let numbered = "";
    let lastLine = start - 1;
    for (let i = start; i <= end; i++) {
      const next = `${i}| ${lines[i - 1]}\n`;
      if (numbered.length + next.length > MAX_READ_CHARS) break;
      numbered += next;
      lastLine = i;
    }
    const truncated =
      lastLine < lines.length
        ? `\n[Showing lines ${start}-${lastLine} of ${lines.length}. Use startLine to read more.]`
        : "";
    return {
      output: (numbered || "(empty file)") + truncated,
      summary: `Read ${filePath}`,
    };
  },

  async search_files(ctx, args) {
    const query = requireString(args, "query");
    if (!query) throw new ToolError("query is required");
    let matcher: (line: string) => boolean;
    if (args.regex === true) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(query, "i");
      } catch (error) {
        throw new ToolError(`Invalid regex: ${error instanceof Error ? error.message : query}`);
      }
      matcher = (line) => pattern.test(line);
    } else {
      const needle = query.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(needle);
    }

    const files = (await listProjectFiles(ctx.project.id)).filter(isTextFile);
    const results: string[] = [];
    for (const file of files) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      const lines = (await readText(ctx, file)).split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
        if (matcher(lines[i])) results.push(`${file.path}:${i + 1}: ${lines[i].slice(0, 300)}`);
      }
    }
    return {
      output: results.length ? results.join("\n") : "No matches.",
      summary: `Searched for "${query.slice(0, 40)}" (${results.length} matches)`,
    };
  },

  async write_file(ctx, args) {
    requireEditor(ctx);
    const filePath = normalizePath(args.path);
    const content = requireString(args, "content");
    const { created } = await writeText(ctx, filePath, content);
    return {
      output: `${created ? "Created" : "Overwrote"} ${filePath} (${content.split("\n").length} lines).`,
      summary: `${created ? "Created" : "Rewrote"} ${filePath}`,
      changedPaths: [filePath],
      treeChanged: created,
    };
  },

  async edit_file(ctx, args) {
    requireEditor(ctx);
    const filePath = normalizePath(args.path);
    // Match on LF-normalized text so CRLF files can be edited, then restore
    // the file's original line endings when writing.
    const oldString = requireString(args, "oldString").replace(/\r\n/g, "\n");
    const newString = requireString(args, "newString").replace(/\r\n/g, "\n");
    if (!oldString) throw new ToolError("oldString must not be empty; use write_file to create files");

    const file = await requireFile(ctx.project.id, filePath);
    if (file.isDirectory) throw new ToolError(`"${filePath}" is a folder`);
    const raw = await readText(ctx, file);
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const content = raw.replace(/\r\n/g, "\n");
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new ToolError(
        `oldString was not found in ${filePath}. Re-read the file and copy the text exactly (without line-number prefixes).`
      );
    }
    if (occurrences > 1 && args.replaceAll !== true) {
      throw new ToolError(
        `oldString matches ${occurrences} places in ${filePath}. Include more surrounding text or set replaceAll.`
      );
    }
    const next =
      args.replaceAll === true
        ? content.split(oldString).join(newString)
        : content.replace(oldString, () => newString);
    await writeText(ctx, filePath, eol === "\n" ? next : next.replace(/\n/g, eol));
    return {
      output: `Edited ${filePath} (${occurrences} replacement${occurrences > 1 ? "s" : ""}).`,
      summary: `Edited ${filePath}`,
      changedPaths: [filePath],
    };
  },

  async create_folder(ctx, args) {
    requireEditor(ctx);
    const folderPath = normalizePath(args.path);
    const existing = await findFile(ctx.project.id, folderPath);
    if (existing) {
      if (existing.isDirectory) return { output: `${folderPath} already exists.`, summary: `Folder ${folderPath} exists` };
      throw new ToolError(`"${folderPath}" is already a file`);
    }
    // Reuse the parent-creation logic by pretending the folder holds a child.
    await ensureParentFolders(ctx, `${folderPath}/placeholder`);
    return {
      output: `Created folder ${folderPath}.`,
      summary: `Created folder ${folderPath}`,
      changedPaths: [folderPath],
      treeChanged: true,
    };
  },

  async move_path(ctx, args) {
    requireEditor(ctx);
    const from = normalizePath(args.from);
    const to = normalizePath(args.to);
    if (from === to) return { output: "Source and destination are the same.", summary: "Nothing to move" };
    if (to.startsWith(`${from}/`)) throw new ToolError("Cannot move a folder into itself");

    const file = await requireFile(ctx.project.id, from);
    if (await findFile(ctx.project.id, to)) throw new ToolError(`Something already exists at "${to}"`);

    await ensureParentFolders(ctx, to);
    const projectDir = storage.getProjectDir(ctx.project.userId, ctx.project.id);
    await storage.renameFile(path.join(projectDir, from), path.join(projectDir, to));
    await db
      .update(projectFiles)
      .set({ path: to, updatedAt: new Date() })
      .where(eq(projectFiles.id, file.id));

    const changedPaths = [from, to];
    if (file.isDirectory) {
      const oldPrefix = `${from}/`;
      const children = await db
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.projectId, ctx.project.id), like(projectFiles.path, `${oldPrefix}%`)));
      for (const child of children) {
        const childPath = `${to}/${child.path.slice(oldPrefix.length)}`;
        await db
          .update(projectFiles)
          .set({ path: childPath, updatedAt: new Date() })
          .where(eq(projectFiles.id, child.id));
        changedPaths.push(child.path, childPath);
      }
    }

    let mainFile = ctx.project.mainFile;
    if (mainFile === from) mainFile = to;
    else if (file.isDirectory && mainFile.startsWith(`${from}/`)) {
      mainFile = `${to}/${mainFile.slice(from.length + 1)}`;
    }
    const mainChanged = mainFile !== ctx.project.mainFile;
    if (mainChanged) {
      await touchProject(ctx.project.id, { mainFile });
      ctx.project = { ...ctx.project, mainFile };
    } else {
      await touchProject(ctx.project.id);
    }

    // The row keeps its id, so a "created" event is enough for clients to
    // refresh the tree without closing open tabs.
    broadcastFileEvent({
      type: "file:created",
      projectId: ctx.project.id,
      userId: ctx.userId,
      fileId: file.id,
      path: to,
      isDirectory: file.isDirectory ?? false,
    });

    return {
      output: `Moved ${from} to ${to}.${mainChanged ? ` The main file is now ${mainFile}.` : ""}`,
      summary: `Moved ${from} → ${to}`,
      changedPaths,
      treeChanged: true,
    };
  },

  async delete_path(ctx, args) {
    requireEditor(ctx);
    const target = normalizePath(args.path);
    const file = await requireFile(ctx.project.id, target);
    const projectDir = storage.getProjectDir(ctx.project.userId, ctx.project.id);

    if (file.isDirectory) {
      await storage.deleteDirectory(path.join(projectDir, target));
      await db
        .delete(projectFiles)
        .where(
          and(
            eq(projectFiles.projectId, ctx.project.id),
            or(eq(projectFiles.path, target), like(projectFiles.path, `${target}/%`))
          )
        );
    } else {
      await storage.deleteFile(path.join(projectDir, target));
      await db.delete(projectFiles).where(eq(projectFiles.id, file.id));
    }

    const mainFile = ctx.project.mainFile;
    const deletedMain = file.isDirectory
      ? mainFile === target || mainFile.startsWith(`${target}/`)
      : mainFile === target;
    let note = "";
    if (deletedMain) {
      const fallback = (await listProjectFiles(ctx.project.id)).find(
        (entry) => !entry.isDirectory && entry.path.toLowerCase().endsWith(".tex")
      );
      const nextMain = fallback?.path ?? "main.tex";
      await touchProject(ctx.project.id, { mainFile: nextMain });
      ctx.project = { ...ctx.project, mainFile: nextMain };
      note = ` The main file is now ${nextMain}.`;
    } else {
      await touchProject(ctx.project.id);
    }

    broadcastFileEvent({
      type: "file:deleted",
      projectId: ctx.project.id,
      userId: ctx.userId,
      fileId: file.id,
      path: target,
    });

    return {
      output: `Deleted ${target}.${note}`,
      summary: `Deleted ${target}`,
      changedPaths: [target],
      treeChanged: true,
    };
  },

  async compile(ctx) {
    requireEditor(ctx);
    const demoBlock = await checkDemoCompileAllowance(ctx.userId);
    if (demoBlock) throw new ToolError(demoBlock.error);

    const result = await triggerCompile({
      projectId: ctx.project.id,
      storageUserId: ctx.project.userId,
      actorUserId: ctx.userId,
      engine: ctx.project.engine,
      mainFile: ctx.project.mainFile,
    });
    if (!result.ok) throw new ToolError(result.error);

    ctx.onBuildQueued?.(result.buildId);

    const deadline = Date.now() + BUILD_WAIT_MS;
    let status = "queued";
    while (Date.now() < deadline && !ctx.signal?.aborted) {
      await sleep(1_500, ctx.signal);
      const [build] = await db
        .select({ status: builds.status })
        .from(builds)
        .where(eq(builds.id, result.buildId))
        .limit(1);
      status = build?.status ?? status;
      if (status !== "queued" && status !== "compiling") break;
    }

    if (status === "queued" || status === "compiling") {
      return {
        output: `Build ${result.buildId} is still ${status} after ${BUILD_WAIT_MS / 1000}s. Check again with get_build_logs.`,
        summary: "Compile still running",
      };
    }

    return {
      output: await buildReport(ctx.project.id, result.buildId),
      summary: status === "success" ? "Compiled successfully" : `Compile ${status}`,
      isError: status !== "success",
    };
  },

  async get_build_logs(ctx) {
    return { output: await buildReport(ctx.project.id), summary: "Read build logs" };
  },

  async get_pdf_info(ctx) {
    const pdfPath = storage.getPdfPath(ctx.project.userId, ctx.project.id, ctx.project.mainFile);
    if (!(await storage.fileExists(pdfPath))) {
      return { output: "No compiled PDF exists yet for the current main file.", summary: "No PDF yet" };
    }
    const buffer = await storage.readFileBinary(pdfPath);
    // Page objects are "/Type /Page" (not "/Pages"); good enough for a count.
    const pages = (buffer.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
    const [latest] = await db
      .select({ status: builds.status, completedAt: builds.completedAt })
      .from(builds)
      .where(eq(builds.projectId, ctx.project.id))
      .orderBy(desc(builds.createdAt))
      .limit(1);
    return {
      output: [
        `PDF: ${ctx.project.mainFile.replace(/\.tex$/, ".pdf")}`,
        `Size: ${formatSize(buffer.length)}`,
        `Pages: ${pages || "unknown"}`,
        latest ? `Latest build: ${latest.status}${latest.completedAt ? ` at ${latest.completedAt.toISOString()}` : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      summary: "Checked PDF",
    };
  },

  async get_project_settings(ctx) {
    const { name, description, engine, mainFile } = ctx.project;
    return {
      output: JSON.stringify({ name, description, engine, mainFile, yourRole: ctx.role }, null, 2),
      summary: "Read project settings",
    };
  },

  async update_project_settings(ctx, args) {
    requireEditor(ctx);
    const updates: Partial<ProjectRow> = {};
    const changes: string[] = [];

    const ownerOnly = ["name", "description", "engine"].filter((key) => args[key] !== undefined);
    if (ownerOnly.length && ctx.role !== "owner") {
      throw new ToolError(`Only the project owner can change ${ownerOnly.join(", ")}`);
    }

    if (args.name !== undefined) {
      const name = requireString(args, "name").trim();
      if (!name || name.length > 255) throw new ToolError("name must be 1-255 characters");
      updates.name = name;
      changes.push(`name → ${name}`);
    }
    if (args.description !== undefined) {
      const description = requireString(args, "description");
      if (description.length > 1000) throw new ToolError("description must be at most 1000 characters");
      updates.description = description;
      changes.push("description updated");
    }
    if (args.engine !== undefined) {
      const engine = requireString(args, "engine") as Engine;
      if (!ENGINES.includes(engine)) throw new ToolError(`engine must be one of ${ENGINES.join(", ")}`);
      updates.engine = engine;
      changes.push(`engine → ${engine}`);
    }
    if (args.mainFile !== undefined) {
      const mainFile = normalizePath(args.mainFile);
      if (path.extname(mainFile).toLowerCase() !== ".tex") throw new ToolError("mainFile must be a .tex file");
      const file = await findFile(ctx.project.id, mainFile);
      if (!file || file.isDirectory) throw new ToolError(`No .tex file at "${mainFile}"`);
      updates.mainFile = mainFile;
      changes.push(`main file → ${mainFile}`);
    }

    if (changes.length === 0) throw new ToolError("No settings to update");
    await touchProject(ctx.project.id, updates);
    ctx.project = { ...ctx.project, ...updates };
    return {
      output: `Updated: ${changes.join("; ")}.`,
      summary: `Updated settings (${changes.join(", ")})`,
      treeChanged: true,
    };
  },
};

export async function executeAgentTool(
  ctx: AgentToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<AgentToolResult> {
  const handler = handlers[name];
  if (!handler) {
    return { output: `Unknown tool "${name}".`, summary: `Unknown tool ${name}`, isError: true };
  }
  try {
    return await handler(ctx, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ToolError)) {
      console.error(`[ai/agent] Tool ${name} failed:`, error);
    }
    return { output: `Error: ${message}`, summary: `${name} failed: ${message}`, isError: true };
  }
}
