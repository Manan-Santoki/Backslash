# Contributing to Backslash

Thank you for contributing to Backslash.

This guide explains how to develop, validate, and submit changes in this monorepo using the actual project structure and runtime flow.

## Table of Contents

1. Scope and Principles
2. Repository Layout
3. Prerequisites
4. Local Development Workflows
5. Code Standards and Conventions
6. Working by Subsystem
7. Database and Migration Workflow (Drizzle)
8. Validation and Testing Requirements
9. Environment and Configuration Changes
10. Docker and Deployment-Sensitive Changes
11. Commit and Pull Request Standards
12. Security Requirements
13. Troubleshooting Notes

## 1. Scope and Principles

Backslash is a `pnpm` monorepo with multiple runtime services:

- Next.js web app (`apps/web`) for UI and HTTP API
- Standalone Socket.IO server (`apps/ws`) for realtime events
- Standalone worker (`apps/worker`) for compile execution
- Shared contracts (`packages/shared`) used across services

Contribution principles:

- Keep changes scoped to one logical purpose.
- Keep cross-service contracts in `packages/shared`.
- Prefer explicit, typed boundaries over implicit behavior.
- Validate every touched runtime, not only `apps/web`.

## 2. Repository Layout

- `apps/web`: Next.js 15 app, App Router pages, API routes, compiler queue orchestration, DB schema.
- `apps/ws`: WebSocket server, Redis pub/sub subscriber, presence/chat/collab transport.
- `apps/worker`: Compile runner process for queued jobs, heartbeat publisher.
- `packages/shared`: Shared TypeScript types and constants (`Engine`, `BuildStatus`, websocket events, limits).
- `docker/texlive`: Compiler image build context.
- `docker/postgres/init.sql`: Postgres initialization assets.
- `templates/`: Built-in LaTeX starter templates.

## 3. Prerequisites

Install before contributing:

- Node.js 22+
- `pnpm`
- Docker + Docker Compose

Install workspace dependencies from repo root:

```bash
pnpm install
```

## 4. Local Development Workflows

### Workflow A: Local app processes + local Postgres/Redis

1. Start infrastructure:

```bash
docker compose -f docker-compose.dev.yml up -d
```

2. Ensure app env is configured (create `apps/web/.env` if needed):

- `DATABASE_URL=postgresql://backslash:devpassword@localhost:5432/backslash`
- `REDIS_URL=redis://localhost:6379`
- `STORAGE_PATH=./data`
- `TEMPLATES_PATH=../../templates`
- `COMPILER_IMAGE=backslash-compiler`
- `SESSION_SECRET=...`

3. Start services in separate terminals:

```bash
pnpm --filter @backslash/web dev
pnpm --filter @backslash/ws dev
pnpm --filter @backslash/worker dev
```

4. Build compiler image once if compile paths are involved:

```bash
docker compose build compiler-image
```

### Workflow B: Full stack in Docker Compose

Use when testing production-like startup behavior:

```bash
docker compose up -d
```

This includes:

- migration init container
- app service
- worker service
- websocket service
- postgres and redis

## 5. Code Standards and Conventions

Project conventions:

- Language: TypeScript with strict typing
- Formatting style: 2 spaces, semicolons, double quotes
- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- API route files: `src/app/api/**/route.ts`

Boundary rules:

- Shared API/websocket/data contracts belong in `packages/shared`.
- Avoid duplicating shared interfaces in app-level code unless there is a runtime isolation reason.
- Keep feature logic close to runtime module (`web`, `ws`, or `worker`).

Import/path conventions:

- `apps/web` uses `@/*` alias for `apps/web/src/*`.
- Shared package alias in apps: `@backslash/shared`.

## 6. Working by Subsystem

### Web API and app routes (`apps/web/src/app`)

- Session-protected endpoints should use `withAuth(...)`.
- API-key endpoints should use `withApiKey(...)`.
- Project resource endpoints that allow public-share access should use `resolveProjectAccess(...)`.

### Realtime (`apps/ws` + `apps/web/src/lib/websocket`)

- If you change websocket event payloads, update `packages/shared/src/types/websocket.ts`.
- Keep `apps/ws/src/index.ts` and `apps/web/src/hooks/useWebSocket.ts` in sync with event names/payloads.

### Compile pipeline (`apps/web/src/lib/compiler` + `apps/worker`)

- Queue contracts are in `compileQueue.ts` and `asyncCompileQueue.ts`.
- Worker process starts runners from `apps/web` compiler modules.
- Health/heartbeat behavior affects `/api/health`; update both if you change worker liveness semantics.

### Storage/filesystem (`apps/web/src/lib/storage`)

- Use provided helpers for file operations.
- Validate paths via existing validation utilities before writing files.

## 7. Database and Migration Workflow (Drizzle)

Backslash uses migration-driven schema changes.

### Source of truth

- Schema definitions: `apps/web/src/lib/db/schema.ts`
- Generated SQL migrations: `apps/web/drizzle/migrations/*.sql`
- Migration journal/snapshots: `apps/web/drizzle/migrations/meta/*`

### Standard workflow for schema changes

1. Update schema in `apps/web/src/lib/db/schema.ts`.
2. Generate migration:

```bash
pnpm --filter @backslash/web db:generate
```

3. Review generated SQL and metadata.
4. Apply migrations locally:

```bash
pnpm --filter @backslash/web db:migrate
```

5. Validate behavior in affected API/UI flows.
6. Commit schema changes and generated migration files together.

### Important rules

- Do not edit historical migrations that may already be applied in shared environments.
- Add new migration files for new changes.
- `db:push` is for disposable/local prototyping only; use generated SQL migrations for real changes.
- `__drizzle_migrations` is expected and required. Postgres notices like "already exists" are not migration failures.

### Why Drizzle scripts are wired this way

`apps/web/package.json` uses explicit Node invocation for `drizzle-kit` to avoid `pnpm` symlink/module-resolution edge cases. Keep this script style unless you validate an alternative across environments.

## 8. Validation and Testing Requirements

There is no dedicated automated test suite yet. Minimum required validation for contributions:

```bash
pnpm --filter @backslash/web lint
pnpm --filter @backslash/web typecheck
pnpm --filter @backslash/ws typecheck
pnpm --filter @backslash/worker typecheck
```

If your change touches only one service, still run all relevant typechecks for touched packages.

Manual smoke testing expectations:

- Editor flow: open project, edit file, save, compile, PDF loads.
- Realtime flow: two sessions in same project, presence/cursor/chat/file updates.
- API flow: affected endpoint(s) return expected auth/error/success behavior.
- Worker flow: queue, compile, cancel, timeout behavior as applicable.

If you add automated tests, place them near related code with `*.test.ts` or `*.test.tsx` naming.

## 9. Environment and Configuration Changes

When adding/changing env vars:

1. Update code usage.
2. Update `.env.example`.
3. Update `README.md` relevant sections.
4. Update Compose files and Dockerfiles only if runtime needs change.

Never commit actual secrets.

## 10. Docker and Deployment-Sensitive Changes

Be explicit and careful when changing:

- `docker-compose.yml`
- `docker-compose.override.yml`
- `apps/*/Dockerfile`
- startup scripts (`apps/web/docker-entrypoint.sh`, migration scripts)

Checklist for Docker-sensitive PRs:

- Validate container startup order and dependencies.
- Validate migration behavior on startup.
- Confirm app and worker boot correctly after migration init completion.
- Document any image size or startup behavior changes in PR notes.

## 11. Commit and Pull Request Standards

Commit style:

- Prefer Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- One logical change per commit.

PR should include:

1. What changed.
2. Why it changed.
3. Validation commands and results.
4. Manual test notes.
5. Screenshots/recordings for UI changes.
6. Migration/env/docker notes if applicable.

## 12. Security Requirements

Required security hygiene:

- Never commit secrets or real credentials.
- Preserve auth checks (`withAuth`, `withApiKey`, `resolveProjectAccess`) for protected routes.
- Preserve path validation before filesystem writes.
- Keep compile sandbox assumptions intact (Docker isolation settings).

## 13. Troubleshooting Notes

Common issues:

- Drizzle generation fails due to dependency resolution: run from workspace root and use existing `db:*` scripts in `apps/web/package.json`.
- Migration logs show `__drizzle_migrations already exists`: this is expected Postgres notice behavior.
- Compile queue appears idle in web mode: check `RUN_COMPILE_RUNNER_IN_WEB` and worker heartbeat in `/api/health`.
- Realtime missing behind reverse proxy: verify WS path prefix and routing (`/ws/socket.io` path alignment).

---

If you are unsure where a change belongs, open a draft PR early with your proposed file boundary and validation plan.
