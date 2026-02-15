import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const LOCK_KEY_1 = 2085062334;
const LOCK_KEY_2 = 1804289383;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@backslash-postgres:5432/backslash";

interface MigrateState {
  promise: Promise<void> | null;
}

const STATE_KEY = "__backslash_migrate_state__" as const;

function getState(): MigrateState {
  const g = globalThis as unknown as Record<string, MigrateState | undefined>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { promise: null };
  }
  return g[STATE_KEY] as MigrateState;
}

function findMigrationsFolder(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/drizzle/migrations"),   // monorepo root
    path.resolve(process.cwd(), "drizzle/migrations"),            // cwd = apps/web
    path.resolve(process.cwd(), "../web/drizzle/migrations"),     // cwd = apps/worker
    path.resolve(__dirname, "../../../drizzle/migrations"),        // relative to this file
  ];

  return (
    candidates.find((c) =>
      fs.existsSync(path.join(c, "meta/_journal.json"))
    ) ?? null
  );
}

function readJournal(migrationsFolder: string) {
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const content = fs.readFileSync(journalPath, "utf-8");
  return JSON.parse(content) as {
    entries: Array<{ tag: string; when?: number }>;
  };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

async function tableExists(
  client: postgres.Sql,
  tableName: string
): Promise<boolean> {
  const rows = await client`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function ensureMigrationsTable(client: postgres.Sql): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
}

async function hasMigrationHash(
  client: postgres.Sql,
  hash: string
): Promise<boolean> {
  const rows = await client`
    SELECT 1
    FROM public.__drizzle_migrations
    WHERE hash = ${hash}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function insertMigrationHash(
  client: postgres.Sql,
  hash: string,
  createdAt: number
): Promise<void> {
  await client`
    INSERT INTO public.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${createdAt})
  `;
}

/**
 * If a DB already has app tables but is missing the baseline hash,
 * insert the hash for the first migration so Drizzle won't re-run 0000.
 */
async function baselineInitialMigrationIfNeeded(
  client: postgres.Sql,
  migrationsFolder: string
): Promise<void> {
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

  await insertMigrationHash(
    client,
    hash,
    Number(firstEntry.when ?? Date.now())
  );
  console.log(`[migrate] Baseline recorded for ${firstEntry.tag}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doMigrate(): Promise<void> {
  const migrationsFolder = findMigrationsFolder();
  if (!migrationsFolder) {
    throw new Error(
      "[migrate] Could not find migrations folder"
    );
  }

  console.log(`[migrate] Using migrations from: ${migrationsFolder}`);

  const maxAttempts = Number(process.env.MIGRATE_MAX_ATTEMPTS ?? "30");
  const retryDelaySeconds = Number(
    process.env.MIGRATE_RETRY_DELAY_SECONDS ?? "2"
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = postgres(DATABASE_URL, { max: 1 });
    let lockAcquired = false;

    try {
      console.log(
        `[migrate] Running database migrations (attempt ${attempt}/${maxAttempts})...`
      );

      await client`SELECT pg_advisory_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
      lockAcquired = true;
      console.log("[migrate] Migration lock acquired");

      await baselineInitialMigrationIfNeeded(client, migrationsFolder);

      const db = drizzle(client);
      await migrate(db, {
        migrationsFolder,
        migrationsSchema: "public",
      });

      console.log("[migrate] Pending migrations applied successfully");
      return;
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);

      if (attempt === maxAttempts) {
        throw new Error(
          `[migrate] Migrations failed after ${maxAttempts} attempts: ${msg}`
        );
      }

      console.warn(
        `[migrate] Attempt ${attempt} failed (${msg}), retrying in ${retryDelaySeconds}s...`
      );
      await sleep(retryDelaySeconds * 1000);
    } finally {
      if (lockAcquired) {
        try {
          await client`SELECT pg_advisory_unlock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
          console.log("[migrate] Migration lock released");
        } catch {
          // lock released on disconnect anyway
        }
      }
      await client.end();
    }
  }
}

/**
 * Run database migrations in-process. Safe to call from multiple entry
 * points — uses a globalThis singleton to ensure only one run per process.
 */
export async function runMigrations(): Promise<void> {
  const state = getState();
  if (state.promise) {
    await state.promise;
    return;
  }

  state.promise = doMigrate();
  await state.promise;
}
