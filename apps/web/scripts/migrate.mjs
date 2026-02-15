#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const LOCK_KEY_1 = 2085062334;
const LOCK_KEY_2 = 1804289383;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@backslash-postgres:5432/backslash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Docker runtime, standalone output does not expose workspace node_modules in
// a regular layout. Keep a dedicated migration dependency folder as fallback.
const migrateDeps = fs.existsSync("/migrate-deps/node_modules")
  ? createRequire("/migrate-deps/node_modules/")
  : createRequire(import.meta.url);

const postgres = migrateDeps("postgres");
const { drizzle } = migrateDeps("drizzle-orm/postgres-js");
const { migrate } = migrateDeps("drizzle-orm/postgres-js/migrator");

function findMigrationsFolder() {
  const candidates = [
    path.resolve(__dirname, "../drizzle/migrations"),
    path.resolve(process.cwd(), "drizzle/migrations"),
    path.resolve(process.cwd(), "apps/web/drizzle/migrations"),
    path.resolve("/app/apps/web/drizzle/migrations"),
  ];

  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "meta/_journal.json"))
  ) ?? null;
}

function readJournal(migrationsFolder) {
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const content = fs.readFileSync(journalPath, "utf-8");
  return JSON.parse(content);
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

async function tableExists(client, tableName) {
  const rows = await client`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function ensureMigrationsTable(client) {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
}

async function hasMigrationHash(client, hash) {
  const rows = await client`
    SELECT 1
    FROM public.__drizzle_migrations
    WHERE hash = ${hash}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function insertMigrationHash(client, hash, createdAt) {
  await client`
    INSERT INTO public.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${createdAt})
  `;
}

/**
 * Legacy compatibility:
 * If a DB already has app tables but is missing the reset baseline hash,
 * insert the hash for the first migration so Drizzle won't re-run 0000.
 * Real schema upgrades must come from proper migration files after 0000.
 */
async function baselineInitialMigrationIfNeeded(client, migrationsFolder) {
  const usersTableExists = await tableExists(client, "users");
  if (!usersTableExists) return;

  await ensureMigrationsTable(client);

  const journal = readJournal(migrationsFolder);
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("Migration journal is empty");
  }

  const firstEntry = journal.entries[0];
  const sqlPath = path.join(migrationsFolder, `${firstEntry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing migration SQL file: ${firstEntry.tag}.sql`);
  }

  const hash = sha256File(sqlPath);
  const alreadyRecorded = await hasMigrationHash(client, hash);
  if (alreadyRecorded) return;

  await insertMigrationHash(client, hash, Number(firstEntry.when ?? Date.now()));
  console.log(`[migrate] Baseline recorded for ${firstEntry.tag}`);
}

async function main() {
  const migrationsFolder = findMigrationsFolder();
  if (!migrationsFolder) {
    console.error("[migrate] Could not find migrations folder");
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
    await client`SELECT pg_advisory_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
    lockAcquired = true;
    console.log("[migrate] Migration lock acquired");

    await baselineInitialMigrationIfNeeded(client, migrationsFolder);

    await migrate(db, {
      migrationsFolder,
      migrationsSchema: "public",
    });

    console.log("[migrate] Pending migrations applied successfully");
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

  process.exit(hasError ? 1 : 0);
}

await main();
