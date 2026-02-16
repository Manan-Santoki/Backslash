#!/bin/sh
set -e

echo "[entrypoint] Starting application..."
exec node apps/web/server.js
