# ── Build Stage ──────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config and all package.json files
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/ws/package.json apps/ws/
COPY packages/shared/package.json packages/shared/

# Install dependencies from workspace root
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
COPY templates/ templates/

# Build
WORKDIR /app/apps/web
RUN pnpm run build

# ── Production Stage ─────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=builder /app/apps/web/scripts ./apps/web/scripts
COPY --from=builder /app/apps/web/docker-entrypoint.sh ./apps/web/docker-entrypoint.sh

# Install migration dependencies (postgres, drizzle-orm) in an isolated
# directory. Next.js standalone bundles these into webpack chunks so they
# are NOT available in node_modules for the migration script.
RUN npm install --prefix /migrate-deps postgres drizzle-orm 2>/dev/null

# Create data directory
RUN sed -i 's/\r$//' /app/apps/web/docker-entrypoint.sh \
  && mkdir -p /data/projects /data/templates \
  && chmod +x /app/apps/web/docker-entrypoint.sh

EXPOSE 3000

CMD ["/app/apps/web/docker-entrypoint.sh"]
