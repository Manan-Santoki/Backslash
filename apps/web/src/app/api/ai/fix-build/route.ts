import { withAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { builds, projectFiles } from "@/lib/db/schema";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { completeStrictJson } from "@/lib/ai/client";
import { getUserAiSettings } from "@/lib/ai/settings";
import { validateFilePath } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import path from "path";
import { demoDisabledResponse, isFeatureDisabled } from "@/lib/demo";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  activeFilePath: z.string().trim().max(1000).optional(),
  activeFileContent: z.string().optional(),
  errorLimit: z.number().int().min(1).max(20).optional(),
  recentBuildLimit: z.number().int().min(1).max(5).optional(),
});

const aiEditSchema = z.object({
  filePath: z.string().trim().min(1).max(1000),
  replaceFrom: z.number().int().min(1),
  replaceTo: z.number().int().min(1),
  newText: z.string(),
});

const aiResponseSchema = z.object({
  edits: z.array(aiEditSchema).max(40),
  explanation: z.string().trim().min(1).max(4000),
});

interface AiEdit {
  filePath: string;
  replaceFrom: number;
  replaceTo: number;
  newText: string;
}

function normalizeFilePath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

function tailLines(input: string, maxLines: number): string {
  const lines = input.split("\n");
  if (lines.length <= maxLines) return input;
  return lines.slice(lines.length - maxLines).join("\n");
}

function applyLineEdits(content: string, edits: AiEdit[]): string {
  const lines = content.split("\n");
  const sorted = [...edits].sort((a, b) => b.replaceFrom - a.replaceFrom);

  for (const edit of sorted) {
    if (edit.replaceTo < edit.replaceFrom) {
      throw new Error(
        `Invalid range for ${edit.filePath}: ${edit.replaceFrom}-${edit.replaceTo}`
      );
    }

    if (edit.replaceTo > lines.length) {
      throw new Error(
        `Out-of-range edit for ${edit.filePath}: max line ${lines.length}, got ${edit.replaceTo}`
      );
    }

    const startIndex = edit.replaceFrom - 1;
    const deleteCount = edit.replaceTo - edit.replaceFrom + 1;
    const replacement = edit.newText.split("\n");
    lines.splice(startIndex, deleteCount, ...replacement);
  }

  return lines.join("\n");
}

function buildAuthHeaders(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const auth = request.headers.get("authorization");
  if (auth) {
    headers.authorization = auth;
  }

  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.cookie = cookie;
  }

  return headers;
}

async function updateFileViaExistingApi(
  request: NextRequest,
  projectId: string,
  fileId: string,
  content: string
): Promise<void> {
  const url = new URL(`/api/projects/${projectId}/files/${fileId}`, request.url);
  const res = await fetch(url, {
    method: "PUT",
    headers: buildAuthHeaders(request),
    body: JSON.stringify({ content, autoCompile: false }),
    cache: "no-store",
  });

  if (!res.ok) {
    const payload = await res.text().catch(() => "");
    throw new Error(
      `Failed to update ${fileId} through file API (${res.status}): ${payload || res.statusText}`
    );
  }
}

async function triggerCompileViaExistingApi(
  request: NextRequest,
  projectId: string
): Promise<{ statusCode: number; payload: unknown }> {
  const url = new URL(`/api/projects/${projectId}/compile`, request.url);
  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(request),
    cache: "no-store",
  });

  let payload: unknown = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  return { statusCode: res.status, payload };
}

export async function POST(request: NextRequest) {
  if (isFeatureDisabled("ai")) {
    return demoDisabledResponse("ai");
  }

  return withAuth(request, async (req, user) => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { projectId } = parsed.data;
    const errorLimit = parsed.data.errorLimit ?? 8;
    const recentBuildLimit = parsed.data.recentBuildLimit ?? 3;

    const access = await checkProjectAccess(user.id, projectId);
    if (!access.access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (access.role === "viewer") {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    const aiSettings = await getUserAiSettings(user.id);
    if (!aiSettings.enabled) {
      return NextResponse.json(
        { error: "AI features are disabled in your settings" },
        { status: 403 }
      );
    }

    const project = access.project;
    const projectDir = storage.getProjectDir(project.userId, projectId);

    const files = await db
      .select({
        id: projectFiles.id,
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const editableFiles = files.filter((file) => !file.isDirectory);
    if (editableFiles.length === 0) {
      return NextResponse.json(
        { error: "No editable files found in project" },
        { status: 404 }
      );
    }

    const requestedActivePath = parsed.data.activeFilePath
      ? normalizeFilePath(parsed.data.activeFilePath)
      : "";

    const activeFile =
      editableFiles.find((file) => file.path === requestedActivePath) ??
      editableFiles.find((file) => file.path === project.mainFile) ??
      editableFiles.find((file) => file.path.toLowerCase().endsWith(".tex")) ??
      editableFiles[0];

    const diskActiveContent = await storage
      .readFile(path.join(projectDir, activeFile.path))
      .catch(() => "");

    const activeFileContent =
      typeof parsed.data.activeFileContent === "string"
        ? parsed.data.activeFileContent
        : diskActiveContent;

    const recentBuilds = await db
      .select({
        id: builds.id,
        status: builds.status,
        logs: builds.logs,
        createdAt: builds.createdAt,
      })
      .from(builds)
      .where(eq(builds.projectId, projectId))
      .orderBy(desc(builds.createdAt))
      .limit(recentBuildLimit);

    const latestLogs = recentBuilds[0]?.logs ?? "";
    const topErrors = parseLatexLog(latestLogs)
      .filter((entry) => entry.type === "error")
      .slice(0, errorLimit)
      .map((entry) => ({
        type: entry.type,
        file: entry.file,
        line: entry.line,
        message: entry.message,
      }));

    const systemPrompt = [
      "You are a senior LaTeX error-fix assistant.",
      "Return ONLY valid JSON matching this exact schema:",
      "{ edits: [{ filePath: string, replaceFrom: number, replaceTo: number, newText: string }], explanation: string }",
      "Rules:",
      "1) filePath must match one of the provided project files.",
      "2) replaceFrom/replaceTo are 1-based inclusive line numbers in filePath.",
      "3) Keep edits minimal and focused on fixing compile errors.",
      "4) Do not include markdown or extra keys.",
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        objective: "Fix current LaTeX build failures with minimal safe edits.",
        project: {
          id: project.id,
          name: project.name,
          engine: project.engine,
          mainFile: project.mainFile,
        },
        activeFile: {
          path: activeFile.path,
          content: activeFileContent.slice(0, 32_000),
        },
        topCompileErrors: topErrors,
        recentBuildLogs: recentBuilds.map((build) => ({
          buildId: build.id,
          status: build.status,
          createdAt: build.createdAt,
          logsTail: tailLines(build.logs ?? "", 80).slice(0, 10_000),
        })),
        availableFiles: editableFiles.map((file) => file.path),
      },
      null,
      2
    );

    let aiPayload: unknown;
    try {
      aiPayload = await completeStrictJson({
        modelSettings: aiSettings.buildFix,
        systemPrompt,
        userPrompt,
        temperature: 0.1,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "AI provider request failed",
        },
        { status: 502 }
      );
    }

    const aiResult = aiResponseSchema.safeParse(aiPayload);
    if (!aiResult.success) {
      return NextResponse.json(
        {
          error: "AI response schema validation failed",
          details: aiResult.error.flatten().fieldErrors,
        },
        { status: 502 }
      );
    }

    const normalizedEdits = aiResult.data.edits
      .map((edit) => ({
        filePath: normalizeFilePath(edit.filePath),
        replaceFrom: edit.replaceFrom,
        replaceTo: edit.replaceTo,
        newText: edit.newText,
      }))
      .filter((edit) => {
        const validPath = validateFilePath(edit.filePath);
        return validPath.valid && edit.replaceTo >= edit.replaceFrom;
      });

    const editsByFile = new Map<string, AiEdit[]>();
    for (const edit of normalizedEdits) {
      const next = editsByFile.get(edit.filePath) ?? [];
      next.push(edit);
      editsByFile.set(edit.filePath, next);
    }

    const applied: Array<{
      filePath: string;
      replaceFrom: number;
      replaceTo: number;
    }> = [];
    const skipped: Array<{ filePath: string; reason: string }> = [];

    for (const [filePath, edits] of editsByFile.entries()) {
      const file = editableFiles.find((entry) => entry.path === filePath);
      if (!file) {
        skipped.push({ filePath, reason: "File not found in project" });
        continue;
      }

      try {
        const current = await storage.readFile(path.join(projectDir, file.path));
        const nextContent = applyLineEdits(current, edits);
        if (nextContent === current) {
          continue;
        }

        await updateFileViaExistingApi(request, projectId, file.id, nextContent);
        for (const edit of edits) {
          applied.push({
            filePath,
            replaceFrom: edit.replaceFrom,
            replaceTo: edit.replaceTo,
          });
        }
      } catch (error) {
        skipped.push({
          filePath,
          reason:
            error instanceof Error ? error.message : "Failed to apply edit",
        });
      }
    }

    const compile = await triggerCompileViaExistingApi(request, projectId);

    return NextResponse.json(
      {
        explanation: aiResult.data.explanation,
        appliedEdits: applied,
        skippedEdits: skipped,
        compile: {
          statusCode: compile.statusCode,
          result: compile.payload,
        },
      }
    );
  });
}
