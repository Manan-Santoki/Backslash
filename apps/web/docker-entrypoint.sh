#!/bin/sh
set -e

echo "── Running database migrations ──"
node apps/web/scripts/migrate.mjs

echo "── Starting application ──"
exec node apps/web/server.js
