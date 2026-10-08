import { resolveProjectAccess } from "@/lib/auth/project-access";
import { db } from "@/lib/db";
import { builds, projectFiles } from "@/lib/db/schema";
import { resolveProjectAiModel } from "@/lib/ai/settings";
import { completeWithTools, type AgentMessage } from "@/lib/ai/agent/llm";
import { agentTools, executeAgentTool, type AgentToolContext } from "@/lib/ai/agent/tools";
import { demoDisabledResponse, isFeatureDisabled } from "@/lib/demo";
import type { AiChatStreamEvent } from "@/lib/ai/agent/events";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAX_STEPS = 80;
const HEARTBEAT_MS = 15_000;

const requestSchema = z.object({
  projectId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(100_000),
      })
    )
    .min(1)
    .max(60),
  activeFilePath: z.string().trim().max(1000).optional(),
  selection: z.string().max(20_000).optional(),
});

/** Drops large string arguments (file bodies) before echoing tool calls to the UI. */
function previewArgs(args: Record<string, unknown>): Record<string, unknown> {
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    preview[key] =
      typeof value === "string" && value.length > 200
        ? `${value.slice(0, 200)}… (${value.length} chars)`
        : value;
  }
  return preview;
}

export async function POST(request: NextRequest) {
  if (isFeatureDisabled("ai")) {
    return demoDisabledResponse("ai");
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { projectId, activeFilePath, selection } = parsed.data;

  const access = await resolveProjectAccess(request, projectId);
  if (!access.access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const userId = access.user?.id ?? null;
  if (!userId && access.role !== "editor") {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const aiModel = await resolveProjectAiModel(
    userId,
    access.project,
    access.role,
    "latexWriter"
  );
  if (!aiModel.enabled) {
    return NextResponse.json(
      {
        error: userId
          ? "AI features are disabled in your settings"
          : "The project owner hasn't shared their AI on this project",
      },
      { status: 403 }
    );
  }

  const role = access.role;
  const project = access.project;

  const files = await db
    .select({
      path: projectFiles.path,
      isDirectory: projectFiles.isDirectory,
      sizeBytes: projectFiles.sizeBytes,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(projectFiles.path);

  const [latestBuild] = await db
    .select({ status: builds.status, createdAt: builds.createdAt })
    .from(builds)
    .where(eq(builds.projectId, projectId))
    .orderBy(desc(builds.createdAt))
    .limit(1);

  const fileList = files
    .slice(0, 300)
    .map((file) =>
      file.isDirectory
        ? `${file.path}/`
        : `${file.path} (${Math.max(1, Math.round((file.sizeBytes ?? 0) / 1024))} KB)`
    )
    .join("\n");

  const systemPrompt = [
    "You are the AI assistant built into Backslash, a collaborative LaTeX editor.",
    "You work inside one project and can read, create, edit, move and delete its files and folders, compile it to PDF, read build logs and change project settings using the provided tools.",
    "",
    "How to work:",
    "- Work like a careful engineer exploring a codebase: find what you need, read it, then act. Never guess file contents.",
    "- Navigate before reading: use get_outline to see a file's (or the whole project's) sections, figures, tables and \\input/\\include structure with line numbers, then read_file only the line ranges you need. Use search_files (with contextLines and path) to locate specific text, labels, commands or citations across all files.",
    "- read_file returns a window of lines and tells you when more remain. When a task covers a whole file or document (proofreading, summarizing, reviewing, consistency checks), keep reading consecutive ranges until you reach [End of file.], and follow every \\input/\\include into its file. Do not stop early or claim to have covered text you have not read.",
    "- The document can span several files; the main file is the entry point. When a question is about the document as a whole, check the other .tex and .bib files it pulls in.",
    "- Use read_pdf to see what the compiled document actually says (resolved references, citation numbers, page breaks) or to read a PDF the user uploaded. Always make changes in the source files.",
    "- Prefer edit_file with a small, exact oldString over rewriting whole files. Use multi_edit to apply several fixes to one file in a single step.",
    "- If a tool result looks garbled, abbreviated or has placeholders instead of text, re-read a smaller range rather than working from it.",
    "- After changing LaTeX, compile and fix any errors you introduced. Do not loop forever: stop after a few failed attempts and explain.",
    "- When moving or renaming files, update \\input, \\include, \\includegraphics, \\bibliography and similar references.",
    "- Only delete files when the user asked for it or it is clearly part of the requested reorganisation.",
    "- If the request is a question, answer it; only change files when asked to.",
    "- Finish with a short summary of what you changed (files and why). Use Markdown sparingly.",
    role === "viewer"
      ? "- The user is a VIEWER: you can only read and explain. Do not attempt changes."
      : "",
    "",
    "Project:",
    `- Name: ${project.name}`,
    `- Engine: ${project.engine}`,
    `- Main file: ${project.mainFile}`,
    `- Latest build: ${latestBuild ? latestBuild.status : "never built"}`,
    activeFilePath ? `- The user currently has open: ${activeFilePath}` : "",
    "",
    `Files (${files.length}):`,
    fileList || "(empty project)",
    files.length > 300 ? "(list truncated — use list_files)" : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const history: AgentMessage[] = parsed.data.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (selection?.trim()) {
    const last = history[history.length - 1];
    if (last?.role === "user") {
      last.content = `${last.content}\n\n[Selected text in ${activeFilePath ?? "the editor"}]\n${selection}`;
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AiChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Keep proxies from closing the connection during long model calls.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const ctx: AgentToolContext = {
        project,
        role,
        userId,
        signal: abort.signal,
        onBuildQueued: (buildId) => send({ type: "build_queued", buildId }),
      };

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          if (abort.signal.aborted) break;

          const completion = await completeWithTools({
            modelSettings: aiModel.modelSettings,
            systemPrompt,
            messages: history,
            tools: agentTools,
            signal: abort.signal,
          });

          history.push({
            role: "assistant",
            content: completion.content,
            toolCalls: completion.toolCalls,
          });

          if (completion.content.trim()) {
            send({ type: "assistant_text", text: completion.content });
          }

          if (completion.toolCalls.length === 0) break;

          for (const call of completion.toolCalls) {
            if (abort.signal.aborted) break;
            send({ type: "tool_start", id: call.id, name: call.name, args: previewArgs(call.arguments) });
            const result = await executeAgentTool(ctx, call.name, call.arguments);
            send({
              type: "tool_end",
              id: call.id,
              name: call.name,
              summary: result.summary,
              isError: Boolean(result.isError),
              changedPaths: result.changedPaths ?? [],
              treeChanged: Boolean(result.treeChanged),
            });
            history.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: result.output,
            });
          }

          if (step === MAX_STEPS - 1) {
            send({
              type: "assistant_text",
              text: `Stopped after ${MAX_STEPS} steps. Ask me to continue if there is more to do.`,
            });
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[ai/chat] Agent run failed:", error);
          send({
            type: "error",
            message: error instanceof Error ? error.message : "AI request failed",
          });
        }
      } finally {
        clearInterval(heartbeat);
        send({ type: "done" });
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream already closed by the client.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
