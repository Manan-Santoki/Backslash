import type { AiModelSettings } from "@/lib/ai/types";
import { resolveAiApiKey, resolveAiBaseUrl } from "@/lib/ai/settings";

export interface StrictJsonCompletionParams {
  modelSettings: AiModelSettings;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("AI returned an empty response");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue trying to recover JSON from fenced or mixed responses.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error("AI response did not contain valid JSON");
  }

  const sliced = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(sliced);
}

type OpenAiCompletionPayload = {
  choices?: Array<{
    message?: { content?: string | null };
    delta?: { content?: string | null };
  }>;
};

// Some OpenAI-compatible proxies stream SSE chunks even when stream=false,
// so accept either a plain completion body or "data: {...}" chunk lines.
function parseOpenAiCompletionContent(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("data:")) {
    const json = JSON.parse(trimmed) as OpenAiCompletionPayload;
    return json.choices?.[0]?.message?.content ?? null;
  }

  let content = "";
  for (const line of trimmed.split("\n")) {
    const data = line.trim();
    if (!data.startsWith("data:")) continue;
    const chunk = data.slice(5).trim();
    if (!chunk || chunk === "[DONE]") continue;
    const json = JSON.parse(chunk) as OpenAiCompletionPayload;
    const choice = json.choices?.[0];
    content += choice?.delta?.content ?? choice?.message?.content ?? "";
  }
  return content || null;
}

async function callOpenAiCompatible(
  params: StrictJsonCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

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
        temperature: params.temperature ?? 0.1,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: params.systemPrompt,
          },
          {
            role: "user",
            content: params.userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `AI provider request failed (${res.status}): ${body || res.statusText}`
      );
    }

    const content = parseOpenAiCompletionContent(await res.text());
    if (!content || typeof content !== "string") {
      throw new Error("AI provider returned no completion content");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function callAnthropic(
  params: StrictJsonCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

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
        max_tokens: params.maxTokens ?? 2_000,
        temperature: params.temperature ?? 0.1,
        system: params.systemPrompt,
        messages: [
          {
            role: "user",
            content: params.userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Anthropic request failed (${res.status}): ${body || res.statusText}`
      );
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const firstText = json.content?.find((item) => item.type === "text")?.text;
    if (!firstText) {
      throw new Error("Anthropic returned no text content");
    }

    return firstText;
  } finally {
    clearTimeout(timeout);
  }
}

export async function completeStrictJson(
  params: StrictJsonCompletionParams
): Promise<unknown> {
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

  const text =
    params.modelSettings.provider === "anthropic"
      ? await callAnthropic(params, apiKey, baseUrl)
      : await callOpenAiCompatible(params, apiKey, baseUrl);

  return extractJsonPayload(text);
}
