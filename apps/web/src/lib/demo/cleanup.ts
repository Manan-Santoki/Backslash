import fs from "fs/promises";
import path from "path";
import { inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { deleteDirectory } from "@/lib/storage";
import { demoConfig, isDemoExemptEmail } from "./config";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IdleUser {
  id: string;
  email: string;
}

/**
 * Accounts that are safe to delete: no unexpired session (so nobody is using
 * them right now) and no activity within the demo TTL.
 *
 * "Activity" is the newest of the user row itself, their sessions, their
 * projects, and their builds.
 */
async function findIdleUsers(): Promise<IdleUser[]> {
  const result = await db.execute<{ id: string; email: string }>(sql`
    SELECT u.id, u.email
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.user_id = u.id AND s.expires_at > now()
    )
    AND GREATEST(
      u.updated_at,
      COALESCE((SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id), u.created_at),
      COALESCE((SELECT max(p.updated_at) FROM projects p WHERE p.user_id = u.id), u.created_at),
      COALESCE((SELECT max(b.created_at) FROM builds b WHERE b.user_id = u.id), u.created_at)
    ) < now() - make_interval(hours => ${demoConfig.ttlHours})
  `);

  const rows = Array.from(result as unknown as IdleUser[]);

  return rows.filter((row) => !isDemoExemptEmail(row.email));
}

/**
 * Remove project storage belonging to users that no longer exist. Cleans up
 * after a sweep that was interrupted between the disk delete and the row delete.
 */
async function sweepOrphanProjectDirs(): Promise<number> {
  const projectsRoot = path.join(STORAGE_PATH, "projects");

  let entries;
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    // Nothing written yet.
    return 0;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
    .map((entry) => entry.name);

  if (candidates.length === 0) return 0;

  const known = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, candidates));
  const knownIds = new Set(known.map((row) => row.id));

  let removed = 0;
  for (const dir of candidates) {
    if (knownIds.has(dir)) continue;
    await deleteDirectory(path.join(projectsRoot, dir));
    removed++;
  }

  return removed;
}

async function sweep(): Promise<void> {
  const idle = await findIdleUsers();

  let dirsRemoved = 0;

  // Disk first: if this crashes halfway, the user row survives and the next
  // sweep retries instead of leaking orphaned files forever.
  for (const user of idle) {
    try {
      await deleteDirectory(path.join(STORAGE_PATH, "projects", user.id));
      dirsRemoved++;
    } catch (err) {
      console.error(
        `[demo-reaper] Failed to remove storage for ${user.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (idle.length > 0) {
    // Every child table cascades from users (projects, files, builds, sessions,
    // labels, api keys, ai settings, shares, reset tokens).
    await db.delete(users).where(
      inArray(
        users.id,
        idle.map((user) => user.id)
      )
    );
  }

  await db.execute(sql`DELETE FROM sessions WHERE expires_at < now()`);

  const orphans = await sweepOrphanProjectDirs();

  if (idle.length > 0 || orphans > 0) {
    console.log(
      `[demo-reaper] swept ${idle.length} account(s), freed ${dirsRemoved} project dir(s)` +
        (orphans > 0 ? `, reclaimed ${orphans} orphaned dir(s)` : "")
    );
  }
}

// ─── Lifecycle (survives Next.js hot-reloads) ────────

interface ReaperState {
  interval: ReturnType<typeof setInterval>;
  initial: ReturnType<typeof setTimeout>;
  sweeping: boolean;
}

const REAPER_KEY = "__backslash_demo_reaper__" as const;

function getState(): ReaperState | null {
  return (
    ((globalThis as unknown) as Record<string, ReaperState | undefined>)[
      REAPER_KEY
    ] ?? null
  );
}

function setState(state: ReaperState | null): void {
  ((globalThis as unknown) as Record<string, ReaperState | null>)[REAPER_KEY] =
    state;
}

async function runSweep(state: ReaperState): Promise<void> {
  if (state.sweeping) return;
  state.sweeping = true;
  try {
    await sweep();
  } catch (err) {
    console.error(
      "[demo-reaper] Sweep failed:",
      err instanceof Error ? err.message : err
    );
  } finally {
    state.sweeping = false;
  }
}

/**
 * Starts the demo cleanup loop. No-op unless DEMO_MODE is enabled.
 */
export function startDemoReaper(): void {
  if (!demoConfig.enabled) return;
  if (getState()) return;

  const intervalMs = Math.max(demoConfig.sweepIntervalMinutes, 1) * 60_000;

  const state = {} as ReaperState;
  state.sweeping = false;
  state.initial = setTimeout(() => {
    void runSweep(state);
  }, 60_000);
  state.interval = setInterval(() => {
    void runSweep(state);
  }, intervalMs);

  // Never hold the process open just for the sweeper.
  state.interval.unref?.();
  state.initial.unref?.();

  setState(state);

  console.log(
    `[demo-reaper] Started (ttl=${demoConfig.ttlHours}h, interval=${demoConfig.sweepIntervalMinutes}m)`
  );
}

export function shutdownDemoReaper(): void {
  const state = getState();
  if (!state) return;

  clearTimeout(state.initial);
  clearInterval(state.interval);
  setState(null);

  console.log("[demo-reaper] Stopped");
}
