#!/usr/bin/env node

/**
 * Standalone migration script for Backslash.
 *
 * Runs on every deployment (via docker-entrypoint.sh) BEFORE the
 * application starts.  It applies all pending Drizzle migrations so the
 * database schema is always up-to-date.
 *
 * Usage:
 *   node scripts/migrate.mjs            (from apps/web/)
 *   node apps/web/scripts/migrate.mjs   (from repo root)
 *
 * The script exits with code 0 on success and 1 on failure.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@postgres:5432/backslash";

// ── Locate the migrations folder ────────────────────
// Works from the repo root, apps/web/, or inside the Docker container.
const candidates = [
  path.resolve(__dirname, "../drizzle/migrations"),            // apps/web/scripts → apps/web/drizzle
  path.resolve(process.cwd(), "drizzle/migrations"),           // CWD = apps/web
  path.resolve(process.cwd(), "apps/web/drizzle/migrations"),  // CWD = repo root
  path.resolve("/app/apps/web/drizzle/migrations"),            // Docker container
  path.resolve("/app/drizzle/migrations"),                     // Docker standalone
];

const migrationsFolder = candidates.find((p) => {
  try {
    return fs.existsSync(path.join(p, "meta/_journal.json"));
  } catch {
    return false;
  }
});

if (!migrationsFolder) {
  console.error("[migrate] ❌ Could not find migrations folder. Searched:");
  candidates.forEach((c) => console.error("  -", c));
  process.exit(1);
}

console.log(`[migrate] Using migrations from: ${migrationsFolder}`);
console.log(`[migrate] Connecting to database...`);

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder });
  console.log("[migrate] ✅ All migrations applied successfully");
} catch (error) {
  console.error("[migrate] ❌ Migration failed:", error?.message || error);
  await client.end();
  process.exit(1);
}

await client.end();
process.exit(0);
