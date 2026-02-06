# ── Build Stage ──────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN cd apps/web && npm install

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
COPY templates/ templates/

# Build
WORKDIR /app/apps/web
RUN npm run build

# ── Production Stage ─────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/templates ./templates

# Create data directory
RUN mkdir -p /data/projects /data/templates

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
