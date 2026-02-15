FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/

# Install all workspace deps because worker imports shared runtime modules from apps/web.
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
COPY apps/worker/ apps/worker/

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@backslash/worker", "start"]
