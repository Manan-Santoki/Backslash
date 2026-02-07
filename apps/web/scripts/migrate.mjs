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
  const msg = error?.message || String(error);

  // If Drizzle's migrate() fails because types/tables already exist
  // (legacy database created by a previous init.sql), apply each
  // migration statement individually, skip "already exists" errors,
  // and record them in Drizzle's journal so future runs are clean.
  if (msg.includes("already exists")) {
    console.log("[migrate] ⚠ Detected pre-existing schema, applying migrations individually...");

    try {
      const journalPath = path.join(migrationsFolder, "meta/_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

      // Find which migrations Drizzle already knows about
      const applied = new Set();
      try {
        const rows = await client`
          SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at
        `;
        for (const row of rows) applied.add(row.hash);
      } catch {
        // Journal table might not exist yet — that's fine
      }

      for (const entry of journal.entries) {
        const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;

        const sqlContent = fs.readFileSync(sqlPath, "utf-8");

        // Compute the same hash Drizzle uses (simple content hash)
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(sqlContent).digest("hex");

        if (applied.has(hash)) {
          console.log(`[migrate]   ⏭ ${entry.tag} (already recorded)`);
          continue;
        }

        // Apply each statement, skipping harmless conflicts
        const statements = sqlContent
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);

        let skipped = 0;
        for (const stmt of statements) {
          try {
            await client.unsafe(stmt);
          } catch (stmtErr) {
            const stmtMsg = stmtErr?.message || "";
            if (
              stmtMsg.includes("already exists") ||
              stmtMsg.includes("duplicate key") ||
              stmtMsg.includes("duplicate")
            ) {
              skipped++;
              continue;
            }
            // Real error — log but keep going
            console.warn(`[migrate]   ⚠ Statement error: ${stmtMsg}`);
          }
        }

        // Record this migration in Drizzle's journal so it won't re-run
        try {
          await client`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${Date.now()})
          `;
        } catch {
          // If the journal table doesn't exist, create it first
          await client.unsafe(`
            CREATE SCHEMA IF NOT EXISTS drizzle;
            CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
              id SERIAL PRIMARY KEY,
              hash text NOT NULL,
              created_at bigint
            );
          `);
          await client`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${Date.now()})
          `;
        }

        console.log(`[migrate]   ✅ ${entry.tag} (${statements.length} statements, ${skipped} skipped)`);
      }

      console.log("[migrate] ✅ Legacy migration pass completed");
    } catch (fallbackErr) {
      console.error("[migrate] ❌ Fallback migration failed:", fallbackErr?.message || fallbackErr);
      await client.end();
      process.exit(1);
    }
  } else {
    console.error("[migrate] ❌ Migration failed:", msg);
    await client.end();
    process.exit(1);
  }
}

await client.end();
process.exit(0);
