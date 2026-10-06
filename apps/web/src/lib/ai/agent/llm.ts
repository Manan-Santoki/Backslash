import type { AiModelSettings } from "@/lib/ai/types";
import { resolveAiApiKey, resolveAiBaseUrl } from "@/lib/ai/settings";

// ─── Provider-neutral conversation types ───────────

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface AgentToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input object. */
  parameters: Record<string, unknown>;
}

export interface AgentCompletion {
  content: string;
  toolCalls: AgentToolCall[];
}

export interface AgentCompletionParams {
  modelSettings: AiModelSettings;
  systemPrompt: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 180_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Combines the caller's abort signal with a per-request timeout. */
function withTimeout(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

// ─── OpenAI-compatible (OpenAI, OpenRouter, custom) ─

interface OpenAiToolCallPayload {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChoicePayload {
  message?: { content?: string | null; tool_calls?: OpenAiToolCallPayload[] };
  delta?: { content?: string | null; tool_calls?: OpenAiToolCallPayload[] };
}

function toOpenAiMessages(systemPrompt: string, messages: AgentMessage[]) {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        };
      }
      return { role: message.role, content: message.content };
    }),
  ];
}

// Some OpenAI-compatible proxies stream SSE chunks even when stream=false,
// so accept either a plain completion body or "data: {...}" chunk lines.
function parseOpenAiBody(body: string): AgentCompletion {
  const trimmed = body.trim();

  if (!trimmed.startsWith("data:")) {
    const json = JSON.parse(trimmed) as { choices?: OpenAiChoicePayload[] };
    const message = json.choices?.[0]?.message;
    return {
      content: message?.content ?? "",
      toolCalls: (message?.tool_calls ?? []).map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.function?.name ?? "",
        arguments: parseArguments(call.function?.arguments),
      })),
    };
  }

  let content = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for (const line of trimmed.split("\n")) {
    const data = line.trim();
    if (!data.startsWith("data:")) continue;
    const chunk = data.slice(5).trim();
    if (!chunk || chunk === "[DONE]") continue;
    const json = JSON.parse(chunk) as { choices?: OpenAiChoicePayload[] };
    const delta = json.choices?.[0]?.delta ?? json.choices?.[0]?.message;
    if (!delta) continue;
    content += delta.content ?? "";
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? calls.size;
      const existing = calls.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) existing.id = call.id;
      if (call.function?.name) existing.name += call.function.name;
      if (call.function?.arguments) existing.args += call.function.arguments;
      calls.set(index, existing);
    }
  }

  return {
    content,
    toolCalls: Array.from(calls.entries())
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: parseArguments(call.args),
      })),
  };
}

async function completeOpenAiCompatible(
  params: AgentCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<AgentCompletion> {
  const { signal, cleanup } = withTimeout(params.signal);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    if (params.modelSettings.provider === "openrouter") {
      headers["HTTP-Referer"] = process.env.APP_BASE_URL || "https://backslash.app";
      headers["X-Title"] = "Backslash";
    }

    const res = await fetch(`${trimTrailingSlash(baseUrl)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.modelSettings.model,
        stream: false,
        temperature: 0.2,
        messages: toOpenAiMessages(params.systemPrompt, params.messages),
        tools: params.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: "auto",
      }),
      signal,
    });

    const body = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `AI provider request failed (${res.status}): ${body.slice(0, 1000) || res.statusText}`
      );
    }

    return parseOpenAiBody(body);
  } finally {
    cleanup();
  }
}

// ─── Anthropic ─────────────────────────────────────

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toAnthropicMessages(messages: AgentMessage[]) {
  const result: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = result[result.length - 1];
      // Consecutive tool results must share a single user turn.
      if (last?.role === "user" && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "(no response)" });
      result.push({ role: "assistant", content: blocks });
      continue;
    }

    result.push({ role: "user", content: [{ type: "text", text: message.content }] });
  }

  return result;
}

async function completeAnthropic(
  params: AgentCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<AgentCompletion> {
  const { signal, cleanup } = withTimeout(params.signal);

  try {
    const res = await fetch(`${trimTrailingSlash(baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.modelSettings.model,
        max_tokens: 8_192,
        system: params.systemPrompt,
        messages: toAnthropicMessages(params.messages),
        tools: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }),
      signal,
    });

    const body = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `Anthropic request failed (${res.status}): ${body.slice(0, 1000) || res.statusText}`
      );
    }

    const json = JSON.parse(body) as {
      content?: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
        | { type: string }
      >;
    };

    let content = "";
    const toolCalls: AgentToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text" && "text" in block) {
        content += block.text;
      } else if (block.type === "tool_use" && "id" in block) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: parseArguments(block.input),
        });
      }
    }

    return { content, toolCalls };
  } finally {
    cleanup();
  }
}

// ─── Entry point ───────────────────────────────────

export async function completeWithTools(
  params: AgentCompletionParams
): Promise<AgentCompletion> {
  const apiKey = resolveAiApiKey(params.modelSettings);
  if (!apiKey) {
    throw new Error(
      `Missing API key for provider "${params.modelSettings.provider}". Set it in Settings or environment variables.`
    );
  }

  const baseUrl = resolveAiBaseUrl(params.modelSettings);
  if (!baseUrl) {
    throw new Error(
      `Missing API endpoint for provider "${params.modelSettings.provider}".`
    );
  }

  return params.modelSettings.provider === "anthropic"
    ? completeAnthropic(params, apiKey, baseUrl)
    : completeOpenAiCompatible(params, apiKey, baseUrl);
}
