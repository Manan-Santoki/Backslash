#!/usr/bin/env node

/**
 * Migration script for Backslash.
 *
 * Handles four scenarios:
 *   1. Fresh install        – no tables exist → run migrate() normally
 *   2. Existing DB, no tracking – app tables exist but no __drizzle_migrations records
 *                              → repair partial schema, baseline initial migration, then migrate()
 *   3. Stale migration records – records exist from old journal (different timestamps)
 *                              → clear old records, repair, baseline, then migrate()
 *   4. Normal upgrade       – records match current journal → migrate() applies only new migrations
 *
 * Usage:
 *   node scripts/migrate.mjs            (from apps/web/)
 *   node apps/web/scripts/migrate.mjs   (from repo root)
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const LOCK_KEY_1 = 2085062334;
const LOCK_KEY_2 = 1804289383;

const EXPECTED_TABLES = [
  "users",
  "sessions",
  "projects",
  "project_files",
  "builds",
  "api_keys",
  "project_shares",
  "project_public_shares",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@postgres:5432/backslash";

// In Docker, migration deps are installed in /migrate-deps because standalone
// output does not expose node_modules in a regular layout.
const migrateDeps = fs.existsSync("/migrate-deps/node_modules")
  ? createRequire("/migrate-deps/node_modules/")
  : createRequire(import.meta.url);

const postgres = migrateDeps("postgres");
const { drizzle } = migrateDeps("drizzle-orm/postgres-js");
const { migrate } = migrateDeps("drizzle-orm/postgres-js/migrator");

// ─── Helpers ──────────────────────────────────────────

function findMigrationsFolder() {
  const candidates = [
    path.resolve(__dirname, "../drizzle/migrations"),
    path.resolve(process.cwd(), "drizzle/migrations"),
    path.resolve(process.cwd(), "apps/web/drizzle/migrations"),
    path.resolve("/app/apps/web/drizzle/migrations"),
    path.resolve("/app/drizzle/migrations"),
  ];

  const folder = candidates.find((p) => {
    try {
      return fs.existsSync(path.join(p, "meta/_journal.json"));
    } catch {
      return false;
    }
  });

  if (!folder) {
    console.error("[migrate] Could not find migrations folder. Searched:");
    candidates.forEach((p) => console.error(`  - ${p}`));
    return null;
  }

  return folder;
}

/** Check if the users table exists (sentinel for "app was previously set up"). */
async function appTablesExist(client) {
  const result = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS "exists"
  `;
  return result[0].exists;
}

/**
 * Check migration tracking state.
 * Returns { hasTable, records: [...] } where records are the existing __drizzle_migrations rows.
 */
async function checkMigrationState(client) {
  const tableCheck = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
    ) AS "exists"
  `;

  if (!tableCheck[0].exists) {
    return { hasTable: false, records: [] };
  }

  const records = await client`
    SELECT hash, created_at FROM public.__drizzle_migrations ORDER BY created_at
  `;
  return { hasTable: true, records };
}

/**
 * Detect if existing migration records are from the old journal (pre-reset).
 * The new journal has a single entry with timestamp 1770679219262.
 * Old entries had timestamps like 1770364737047, 1770452462206, etc.
 */
function needsRebaseline(records, migrationsFolder) {
  if (records.length === 0) return true;

  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const currentHashes = new Set();

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (fs.existsSync(sqlPath)) {
      const content = fs.readFileSync(sqlPath, "utf-8");
      currentHashes.add(createHash("sha256").update(content).digest("hex"));
    }
  }

  // If none of the existing records match current journal hashes, it's stale
  return !records.some((r) => currentHashes.has(r.hash));
}

/**
 * Idempotent DDL to create any missing tables/columns from old 0002/0003 migrations.
 * This is a one-time bridge for users who had partial migrations.
 */
async function repairPartialSchema(client) {
  console.log("[migrate] Repairing partial schema (idempotent)...");

  // Ensure share_role enum exists (needed by project_public_shares)
  await client.unsafe(`
    DO $$ BEGIN
      CREATE TYPE "share_role" AS ENUM ('viewer', 'editor');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // From old 0002: add expires_at to project_shares if missing
  await client.unsafe(`
    ALTER TABLE "project_shares"
    ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
  `);

  // From old 0002: create project_public_shares if missing
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "project_public_shares" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "project_id" uuid NOT NULL,
      "token" varchar(128) NOT NULL,
      "role" "share_role" DEFAULT 'viewer' NOT NULL,
      "expires_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  // FK for project_public_shares → projects
  await client.unsafe(`
    DO $$ BEGIN
      ALTER TABLE "project_public_shares"
      ADD CONSTRAINT "project_public_shares_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // Indexes for project_public_shares
  await client.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "public_shares_project_idx" ON "project_public_shares" USING btree ("project_id");`);
  await client.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "public_shares_token_idx" ON "project_public_shares" USING btree ("token");`);
  await client.unsafe(`CREATE INDEX IF NOT EXISTS "public_shares_expires_idx" ON "project_public_shares" USING btree ("expires_at");`);

  // From old 0002: index on project_shares.expires_at
  await client.unsafe(`CREATE INDEX IF NOT EXISTS "shares_expires_idx" ON "project_shares" USING btree ("expires_at");`);

  // From old 0003: add token column if missing (for DBs that ran 0002 but not 0003)
  await client.unsafe(`
    ALTER TABLE "project_public_shares"
    ADD COLUMN IF NOT EXISTS "token" varchar(128);
  `);

  // Backfill token from id for any rows that have NULL token
  await client.unsafe(`
    UPDATE "project_public_shares"
    SET "token" = "id"::text
    WHERE "token" IS NULL;
  `);

  // Make token NOT NULL if it isn't already
  await client.unsafe(`
    ALTER TABLE "project_public_shares"
    ALTER COLUMN "token" SET NOT NULL;
  `);

  console.log("[migrate] Partial schema repair complete");
}

/** Ensure build_status enum includes all runtime terminal statuses. */
async function ensureBuildStatusEnum(client) {
  await client.unsafe(`
    DO $$ BEGIN
      ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'timeout';
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `);

  await client.unsafe(`
    DO $$ BEGIN
      ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'canceled';
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `);
}

/** Ensure engine enum includes the "auto" value. */
async function ensureEngineEnum(client) {
  await client.unsafe(`
    DO $$ BEGIN
      ALTER TYPE "engine" ADD VALUE IF NOT EXISTS 'auto';
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `);

  await client.unsafe(`
    ALTER TABLE "projects"
    ALTER COLUMN "engine" SET DEFAULT 'auto';
  `);
}

/**
 * Insert a record into __drizzle_migrations for the new 0000 migration
 * so Drizzle skips it on existing DBs.
 */
async function baselineInitialMigration(client, migrationsFolder) {
  console.log("[migrate] Baselining initial migration...");

  // Ensure the migrations table exists
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const initialEntry = journal.entries[0];

  const sqlPath = path.join(migrationsFolder, `${initialEntry.tag}.sql`);
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");
  const hash = createHash("sha256").update(sqlContent).digest("hex");

  // Check if already baselined
  const existing = await client`
    SELECT 1 FROM public.__drizzle_migrations WHERE hash = ${hash}
  `;

  if (existing.length === 0) {
    await client`
      INSERT INTO public.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${Date.now()})
    `;
    console.log(`[migrate] Baselined: ${initialEntry.tag}`);
  } else {
    console.log(`[migrate] Already baselined: ${initialEntry.tag}`);
  }
}

/** Post-migration check that all expected tables exist. */
async function verifySchema(client) {
  const result = await client`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${EXPECTED_TABLES})
  `;

  const found = new Set(result.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !found.has(t));

  if (missing.length > 0) {
    console.warn(`[migrate] WARNING: Missing tables after migration: ${missing.join(", ")}`);
  } else {
    console.log(`[migrate] Schema verified: all ${EXPECTED_TABLES.length} tables present`);
  }
}

// ─── Main ──────────────────────────────────────────

async function main() {
  const migrationsFolder = findMigrationsFolder();
  if (!migrationsFolder) {
    process.exit(1);
    return;
  }

  console.log(`[migrate] Using migrations from: ${migrationsFolder}`);
  console.log("[migrate] Connecting to database...");

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  let lockAcquired = false;
  let hasError = false;

  try {
    console.log("[migrate] Acquiring migration lock...");
    await client`SELECT pg_advisory_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
    lockAcquired = true;
    console.log("[migrate] Migration lock acquired");

    const hasAppTables = await appTablesExist(client);

    if (!hasAppTables) {
      // Scenario 1: Fresh install
      console.log("[migrate] Fresh install detected. Running migrations...");
      await migrate(db, { migrationsFolder, migrationsSchema: "public" });
    } else {
      // Existing DB — check migration tracking
      const { hasTable, records } = await checkMigrationState(client);

      if (!hasTable || records.length === 0 || needsRebaseline(records, migrationsFolder)) {
        // Scenario 2 or 3: Need to repair + baseline
        if (hasTable && records.length > 0) {
          console.log("[migrate] Stale migration records detected. Clearing old records...");
          await client`DELETE FROM public.__drizzle_migrations`;
        } else {
          console.log("[migrate] Existing DB without migration tracking detected.");
        }

        await repairPartialSchema(client);
        await baselineInitialMigration(client, migrationsFolder);

        // Now run migrate() for any subsequent migrations beyond the baselined one
        await migrate(db, { migrationsFolder, migrationsSchema: "public" });
      } else {
        // Scenario 4: Normal upgrade
        console.log("[migrate] Running pending migrations...");
        await migrate(db, { migrationsFolder, migrationsSchema: "public" });
      }
    }

    await ensureBuildStatusEnum(client);
    await ensureEngineEnum(client);
    await verifySchema(client);
    console.log("[migrate] All migrations applied successfully");
  } catch (error) {
    hasError = true;
    console.error("[migrate] Migration failed:", error?.message || error);
  } finally {
    if (lockAcquired) {
      try {
        await client`SELECT pg_advisory_unlock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
        console.log("[migrate] Migration lock released");
      } catch (unlockError) {
        console.warn(
          "[migrate] Failed to release migration lock:",
          unlockError?.message || unlockError
        );
      }
    }

    await client.end();
  }

  if (hasError) {
    process.exit(1);
    return;
  }

  process.exit(0);
}

await main();
