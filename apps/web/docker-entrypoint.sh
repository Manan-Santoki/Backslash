#!/bin/sh
set -e

MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
RETRY_DELAY_SECONDS="${MIGRATE_RETRY_DELAY_SECONDS:-2}"
ATTEMPT=1

while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
  echo "[entrypoint] Running database migrations (attempt ${ATTEMPT}/${MAX_ATTEMPTS})..."
  if node apps/web/scripts/migrate.mjs; then
    echo "[entrypoint] Migrations completed successfully"
    break
  fi

  if [ "$ATTEMPT" -eq "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] Migrations failed after ${MAX_ATTEMPTS} attempts"
    exit 1
  fi

  echo "[entrypoint] Migration attempt failed. Retrying in ${RETRY_DELAY_SECONDS}s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep "$RETRY_DELAY_SECONDS"
done

# The entrypoint already applied migrations. Skip duplicate startup migration
# invocation from app instrumentation for this process.
export AUTO_DB_MIGRATE=false

echo "[entrypoint] Starting application..."
exec node apps/web/server.js
