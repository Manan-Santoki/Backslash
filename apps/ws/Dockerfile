# ── Build Stage ──────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config and all package.json files
COPY package.json pnpm-workspace.yaml ./
COPY apps/ws/package.json apps/ws/
COPY packages/shared/package.json packages/shared/

# Install dependencies from workspace root
RUN pnpm install --no-frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/ws/ apps/ws/

# Build
WORKDIR /app/apps/ws
RUN pnpm run build

# ── Production Stage ─────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install pnpm for production install
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config and package files
COPY package.json pnpm-workspace.yaml ./
COPY apps/ws/package.json apps/ws/
COPY packages/shared/package.json packages/shared/

# Install production dependencies only
RUN pnpm install --no-frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/apps/ws/dist ./apps/ws/dist

EXPOSE 3001

CMD ["node", "apps/ws/dist/index.js"]
