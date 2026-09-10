import { NextResponse } from "next/server";
import type { DemoFeature } from "./config";

const FEATURE_MESSAGES: Record<DemoFeature, string> = {
  api: "The public REST API is disabled on this demo instance. Self-host Backslash to use it.",
  ai: "AI features are disabled on this demo instance.",
  sharing: "Collaborators and share links are disabled on this demo instance.",
};

/**
 * Standard 403 for a feature that is switched off in demo mode.
 */
export function demoDisabledResponse(feature: DemoFeature): NextResponse {
  return NextResponse.json(
    {
      error: FEATURE_MESSAGES[feature],
      code: "demo_disabled",
      feature,
      demo: true,
    },
    { status: 403 }
  );
}

/**
 * Why a demo action was refused. Kept as data so callers that must not fail the
 * whole request (e.g. save-then-optionally-compile) can report it inline.
 */
export interface DemoBlock {
  status: 429 | 503;
  code: string;
  error: string;
  retryAfterSeconds?: number;
  extra?: Record<string, unknown>;
}

export function demoBlockResponse(block: DemoBlock): NextResponse {
  const headers: Record<string, string> = {};
  if (block.retryAfterSeconds) {
    headers["Retry-After"] = String(Math.max(block.retryAfterSeconds, 1));
  }

  return NextResponse.json(
    {
      error: block.error,
      code: block.code,
      demo: true,
      ...(block.retryAfterSeconds
        ? { retryAfterSeconds: block.retryAfterSeconds }
        : {}),
      ...(block.extra ?? {}),
    },
    { status: block.status, headers }
  );
}
