import { sql } from "drizzle-orm";
import { db } from "./index";

interface BuildStatusCompatState {
  ensured: boolean;
  inFlight: Promise<void> | null;
}

const STATE_KEY = "__backslash_build_status_compat_state__" as const;

function getState(): BuildStatusCompatState {
  const globalStore = globalThis as unknown as Record<string, BuildStatusCompatState | undefined>;
  if (!globalStore[STATE_KEY]) {
    globalStore[STATE_KEY] = { ensured: false, inFlight: null };
  }
  return globalStore[STATE_KEY] as BuildStatusCompatState;
}

export function isBuildStatusEnumValueError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error && typeof error.message === "string"
    ? error.message
    : "";
  return message.includes('invalid input value for enum build_status');
}

export async function ensureBuildStatusEnumCompat(): Promise<void> {
  const state = getState();
  if (state.ensured) return;

  if (state.inFlight) {
    await state.inFlight;
    return;
  }

  state.inFlight = (async () => {
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'timeout';
      EXCEPTION
        WHEN undefined_object THEN NULL;
      END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'canceled';
      EXCEPTION
        WHEN undefined_object THEN NULL;
      END $$;
    `);

    state.ensured = true;
  })().finally(() => {
    state.inFlight = null;
  });

  await state.inFlight;
}
