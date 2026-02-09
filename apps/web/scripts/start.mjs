#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleepMs(ms) {
  const waitBuffer = new SharedArrayBuffer(4);
  const waitView = new Int32Array(waitBuffer);
  Atomics.wait(waitView, 0, 0, ms);
}

function resolveMigrateScriptPath() {
  const candidates = [
    path.resolve(__dirname, "migrate.mjs"),
    path.resolve(process.cwd(), "scripts/migrate.mjs"),
    path.resolve(process.cwd(), "apps/web/scripts/migrate.mjs"),
    path.resolve("/app/apps/web/scripts/migrate.mjs"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runMigrations() {
  if (process.env.AUTO_DB_MIGRATE === "false") {
    console.log("[start] AUTO_DB_MIGRATE=false, skipping migrations");
    return;
  }

  const migrateScriptPath = resolveMigrateScriptPath();
  if (!migrateScriptPath) {
    console.error("[start] Could not find migration script");
    process.exit(1);
  }

  const maxAttempts = Number(process.env.MIGRATE_MAX_ATTEMPTS ?? "30");
  const retryDelaySeconds = Number(process.env.MIGRATE_RETRY_DELAY_SECONDS ?? "2");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(
      `[start] Running database migrations (attempt ${attempt}/${maxAttempts})...`
    );

    const migrateResult = spawnSync(process.execPath, [migrateScriptPath], {
      env: process.env,
      stdio: "inherit",
    });

    if ((migrateResult.status ?? 1) === 0) {
      console.log("[start] Migrations completed successfully");
      return;
    }

    if (attempt === maxAttempts) {
      console.error("[start] Migrations failed after all retry attempts");
      process.exit(1);
    }

    console.warn(`[start] Migration failed, retrying in ${retryDelaySeconds}s...`);
    sleepMs(retryDelaySeconds * 1000);
  }
}

function resolveStandaloneServerPath() {
  const candidates = [
    path.resolve(process.cwd(), "server.js"),
    path.resolve(process.cwd(), "apps/web/server.js"),
    path.resolve("/app/apps/web/server.js"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function startAppServer() {
  const standaloneServerPath = resolveStandaloneServerPath();
  if (standaloneServerPath) {
    console.log(`[start] Starting standalone server: ${standaloneServerPath}`);
    const result = spawnSync(process.execPath, [standaloneServerPath], {
      env: process.env,
      stdio: "inherit",
    });
    process.exit(result.status ?? 1);
  }

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  console.log("[start] Starting Next.js server");
  const result = spawnSync(process.execPath, [nextBin, "start"], {
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

runMigrations();
startAppServer();
