"use client";

import { useState, useRef, useEffect, useCallback, Fragment, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Sparkles,
  Send,
  Square,
  X,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
} from "lucide-react";
import type { AiChatStreamEvent } from "@/lib/ai/agent/events";

// ─── Types ──────────────────────────────────────────

type MessagePart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      summary?: string;
      status: "running" | "ok" | "error";
    };

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  error?: string;
}

interface AiAssistantPanelProps {
  projectId: string;
  activeFilePath: string | null;
  /** Persists unsaved editor changes and returns the current selection, if any. */
  onBeforeSend: () => Promise<{ selection: string | null }>;
  onFilesChanged: (changedPaths: string[], treeChanged: boolean) => void;
  onBuildQueued: () => void;
  onRunFinished: () => void;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Fix the current build errors",
  "Proofread the open file and fix typos",
  "Summarize this document",
  "Organize the project into folders",
];

const MAX_HISTORY_MESSAGES = 40;

// ─── Helpers ────────────────────────────────────────

function storageKey(projectId: string) {
  return `ai-assistant-chat-${projectId}`;
}

function loadMessages(projectId: string): UiMessage[] {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UiMessage[]) : [];
  } catch {
    return [];
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Flattens a UI message into plain text for the model's conversation history. */
function toHistoryContent(message: UiMessage): string {
  const text = message.parts
    .filter((part): part is Extract<MessagePart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("\n\n");
  const actions = message.parts
    .filter((part): part is Extract<MessagePart, { kind: "tool" }> => part.kind === "tool")
    .map((part) => `- ${part.summary ?? part.name}`);
  const parts = [text];
  if (actions.length) parts.push(`[Actions taken]\n${actions.join("\n")}`);
  if (message.error) parts.push(`[Error] ${message.error}`);
  return parts.filter(Boolean).join("\n\n") || "(no response)";
}

function toolLabel(part: Extract<MessagePart, { kind: "tool" }>): string {
  if (part.summary) return part.summary;
  const target = part.args.path ?? part.args.from ?? part.args.query;
  const verb = part.name.replace(/_/g, " ");
  return typeof target === "string" ? `${verb}: ${target}` : verb;
}

/** Minimal Markdown: fenced code, inline code and bold. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((chunk, index) => {
    if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 2) {
      return (
        <code key={index} className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[0.85em]">
          {chunk.slice(1, -1)}
        </code>
      );
    }
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      return <strong key={index}>{chunk.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{chunk}</Fragment>;
  });
}

function MessageText({ text }: { text: string }) {
  const segments = text.split(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g);
  return (
    <>
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <pre
            key={index}
            className="my-1.5 overflow-x-auto rounded-md bg-bg-tertiary p-2 font-mono text-xs"
          >
            {segment.replace(/\n$/, "")}
          </pre>
        ) : (
          <span key={index} className="whitespace-pre-wrap break-words">
            {renderInline(segment)}
          </span>
        )
      )}
    </>
  );
}

// ─── AiAssistantPanel ───────────────────────────────

export function AiAssistantPanel({
  projectId,
  activeFilePath,
  onBeforeSend,
  onFilesChanged,
  onBuildQueued,
  onRunFinished,
  onClose,
}: AiAssistantPanelProps) {
  // The panel only mounts client-side (after AI settings load), so reading
  // localStorage in the initializer is safe and avoids clobbering saved
  // history from a mount-time effect.
  const [messages, setMessages] = useState<UiMessage[]>(() => loadMessages(projectId));
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey(projectId),
        JSON.stringify(messages.slice(-MAX_HISTORY_MESSAGES))
      );
    } catch {
      // Ignore localStorage errors
    }
  }, [messages, projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateAssistant = useCallback(
    (assistantId: string, update: (message: UiMessage) => UiMessage) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === assistantId ? update(message) : message))
      );
    },
    []
  );

  const handleEvent = useCallback(
    (assistantId: string, event: AiChatStreamEvent) => {
      switch (event.type) {
        case "assistant_text":
          updateAssistant(assistantId, (message) => ({
            ...message,
            parts: [...message.parts, { kind: "text", text: event.text }],
          }));
          break;
        case "tool_start":
          updateAssistant(assistantId, (message) => ({
            ...message,
            parts: [
              ...message.parts,
              { kind: "tool", id: event.id, name: event.name, args: event.args, status: "running" },
            ],
          }));
          break;
        case "tool_end":
          updateAssistant(assistantId, (message) => ({
            ...message,
            parts: message.parts.map((part) =>
              part.kind === "tool" && part.id === event.id && part.status === "running"
                ? { ...part, summary: event.summary, status: event.isError ? "error" : "ok" }
                : part
            ),
          }));
          if (event.changedPaths.length > 0 || event.treeChanged) {
            onFilesChanged(event.changedPaths, event.treeChanged);
          }
          break;
        case "build_queued":
          onBuildQueued();
          break;
        case "error":
          updateAssistant(assistantId, (message) => ({ ...message, error: event.message }));
          break;
        case "done":
          break;
      }
    },
    [onBuildQueued, onFilesChanged, updateAssistant]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || running) return;

      const userMessage: UiMessage = { id: newId(), role: "user", parts: [{ kind: "text", text: trimmed }] };
      const assistantId = newId();
      const history = [...messages, userMessage].slice(-MAX_HISTORY_MESSAGES);

      setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", parts: [] }]);
      setInput("");
      setRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { selection } = await onBeforeSend();

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            activeFilePath: activeFilePath ?? undefined,
            selection: selection ?? undefined,
            messages: history.map((message) => ({
              role: message.role,
              content: toHistoryContent(message),
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `AI request failed (HTTP ${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            const data = rawEvent
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (!data) continue;
            try {
              handleEvent(assistantId, JSON.parse(data) as AiChatStreamEvent);
            } catch {
              // Ignore malformed events
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          updateAssistant(assistantId, (message) => ({
            ...message,
            error: error instanceof Error ? error.message : "AI request failed",
          }));
        }
      } finally {
        // Anything still marked running was interrupted.
        updateAssistant(assistantId, (message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.kind === "tool" && part.status === "running"
              ? { ...part, status: "error", summary: `${toolLabel(part)} (interrupted)` }
              : part
          ),
          error:
            message.error ??
            (controller.signal.aborted ? "Stopped." : message.parts.length === 0 ? "No response from the AI." : undefined),
        }));
        abortRef.current = null;
        setRunning(false);
        onRunFinished();
        inputRef.current?.focus();
      }
    },
    [activeFilePath, handleEvent, messages, onBeforeSend, onRunFinished, projectId, running, updateAssistant]
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="flex h-full flex-col border-l border-border bg-bg-secondary">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-semibold text-text-primary">AI Assistant</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setMessages([])}
          disabled={running || messages.length === 0}
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-40"
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
          aria-label="Close AI assistant"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Ask anything about this project</p>
              <p className="mt-1 text-xs text-text-muted">
                I can read and edit files, organize folders, compile and fix errors.
              </p>
            </div>
            <div className="flex w-full flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendMessage(suggestion)}
                  className="rounded-md border border-border px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="ml-6 self-end rounded-lg bg-accent/15 px-3 py-2 text-sm text-text-primary">
                  <MessageText text={toHistoryContent(message)} />
                </div>
              ) : (
                <div key={message.id} className="flex flex-col gap-1.5 text-sm text-text-primary">
                  {message.parts.map((part, index) =>
                    part.kind === "text" ? (
                      <div key={index} className="leading-relaxed">
                        <MessageText text={part.text} />
                      </div>
                    ) : (
                      <div
                        key={part.id || index}
                        className={cn(
                          "flex items-start gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]",
                          part.status === "error"
                            ? "border-error/30 text-error"
                            : "border-border text-text-muted"
                        )}
                      >
                        {part.status === "running" ? (
                          <Loader2 className="mt-px h-3 w-3 shrink-0 animate-spin" />
                        ) : part.status === "ok" ? (
                          <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-success" />
                        ) : (
                          <XCircle className="mt-px h-3 w-3 shrink-0" />
                        )}
                        <span className="break-all">{toolLabel(part)}</span>
                      </div>
                    )
                  )}
                  {running && message.id === messages[messages.length - 1]?.id && (
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      <Wrench className="h-3 w-3 animate-pulse" />
                      Working…
                    </div>
                  )}
                  {message.error && <p className="text-xs text-error">{message.error}</p>}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-border p-2">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg-primary px-2 py-1.5 focus-within:border-accent/60">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            rows={2}
            placeholder={running ? "Working…" : "Ask the AI to edit, fix or explain…"}
            disabled={running}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {running ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
              aria-label="Stop"
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-md bg-accent p-1.5 text-bg-primary transition-colors hover:bg-accent-hover disabled:opacity-40"
              aria-label="Send"
              title="Send (Enter)"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        {activeFilePath && (
          <p className="mt-1 truncate px-1 text-[10px] text-text-muted">
            Context: {activeFilePath} · selected text is included
          </p>
        )}
      </form>
    </div>
  );
}
