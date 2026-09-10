import { withAuth } from "@/lib/auth/middleware";
import {
  getUserAiSettings,
  toPublicAiSettings,
  upsertUserAiSettings,
} from "@/lib/ai/settings";
import type { AiModelSettings, AiProvider } from "@/lib/ai/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoDisabledResponse, isFeatureDisabled } from "@/lib/demo";

const providerSchema = z.enum([
  "openai",
  "openrouter",
  "anthropic",
  "custom",
] satisfies [AiProvider, ...AiProvider[]]);

const modelConfigSchema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1).max(255),
  endpoint: z.string().trim().max(2000).nullable().optional(),
  apiKey: z.string().trim().max(4000).nullable().optional(),
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  buildFix: modelConfigSchema,
  latexWriter: modelConfigSchema,
});

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModelConfig(
  input: z.infer<typeof modelConfigSchema>,
  existing: AiModelSettings
): AiModelSettings {
  const endpoint = normalizeNullable(input.endpoint);
  if (input.provider === "custom" && !endpoint) {
    throw new Error("Custom provider requires endpoint");
  }

  let apiKey = existing.apiKey;
  if (input.apiKey !== undefined) {
    apiKey = normalizeNullable(input.apiKey);
  }

  return {
    provider: input.provider,
    model: input.model.trim(),
    endpoint,
    apiKey,
  };
}

export async function GET(request: NextRequest) {
  if (isFeatureDisabled("ai")) {
    return demoDisabledResponse("ai");
  }

  return withAuth(request, async (_req, user) => {
    const settings = await getUserAiSettings(user.id);
    return NextResponse.json({ settings: toPublicAiSettings(settings) });
  });
}

export async function PUT(request: NextRequest) {
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

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    try {
      const existing = await getUserAiSettings(user.id);
      const next = {
        enabled: parsed.data.enabled ?? existing.enabled,
        buildFix: normalizeModelConfig(parsed.data.buildFix, existing.buildFix),
        latexWriter: normalizeModelConfig(
          parsed.data.latexWriter,
          existing.latexWriter
        ),
      };

      const saved = await upsertUserAiSettings(user.id, next);
      return NextResponse.json({ settings: toPublicAiSettings(saved) });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to save AI settings",
        },
        { status: 400 }
      );
    }
  });
}
