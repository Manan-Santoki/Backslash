#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node apps/web/scripts/migrate.mjs

echo "[entrypoint] Starting application..."
exec node apps/web/server.js
