#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

startAppServer();
