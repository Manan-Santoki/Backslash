import { withAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { builds, projectFiles } from "@/lib/db/schema";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { getUserAiSettings } from "@/lib/ai/settings";
import { completeWithTools, type AgentMessage } from "@/lib/ai/agent/llm";
import { agentTools, executeAgentTool, type AgentToolContext } from "@/lib/ai/agent/tools";
import { demoDisabledResponse, isFeatureDisabled } from "@/lib/demo";
import type { AiChatStreamEvent } from "@/lib/ai/agent/events";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAX_STEPS = 40;
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
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { projectId, activeFilePath, selection } = parsed.data;

    const access = await checkProjectAccess(user.id, projectId);
    if (!access.access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const aiSettings = await getUserAiSettings(user.id);
    if (!aiSettings.enabled) {
      return NextResponse.json(
        { error: "AI features are disabled in your settings" },
        { status: 403 }
      );
    }

    const role = access.role;
    const project = access.project;

    const files = await db
      .select({ path: projectFiles.path, isDirectory: projectFiles.isDirectory })
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
      .map((file) => (file.isDirectory ? `${file.path}/` : file.path))
      .join("\n");

    const systemPrompt = [
      "You are the AI assistant built into Backslash, a collaborative LaTeX editor.",
      "You work inside one project and can read, create, edit, move and delete its files and folders, compile it to PDF, read build logs and change project settings using the provided tools.",
      "",
      "How to work:",
      "- Read the relevant files before editing them. Never guess file contents.",
      "- Prefer edit_file with a small, exact oldString over rewriting whole files.",
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
    req.signal.addEventListener("abort", () => abort.abort());

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
          userId: user.id,
          signal: abort.signal,
          onBuildQueued: (buildId) => send({ type: "build_queued", buildId }),
        };

        try {
          for (let step = 0; step < MAX_STEPS; step++) {
            if (abort.signal.aborted) break;

            const completion = await completeWithTools({
              modelSettings: aiSettings.latexWriter,
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
  });
}
