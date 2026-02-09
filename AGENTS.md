# Repository Guidelines

## Project Structure & Module Organization
This repository is a `pnpm` monorepo.

- `apps/web`: Next.js 15 app (UI + API routes) under `apps/web/src`.
- `apps/ws`: standalone Socket.IO server in `apps/ws/src`.
- `apps/worker`: background compile worker in `apps/worker/src`.
- `packages/shared`: shared TypeScript types/constants in `packages/shared/src`.
- `docker/`: Docker assets (Postgres init and TeX Live image).
- `templates/`: starter LaTeX project templates.

Keep feature code close to its runtime module, and move cross-app contracts to `packages/shared`.

## Build, Test, and Development Commands
- `pnpm install`: install all workspace dependencies.
- `docker compose -f docker-compose.dev.yml up -d`: start local Postgres + Redis.
- `pnpm --filter @backslash/web dev`: run the web app at `localhost:3000`.
- `pnpm --filter @backslash/ws dev`: run WebSocket server with watch mode.
- `pnpm --filter @backslash/worker dev`: run worker with watch mode.
- `pnpm --filter @backslash/web build`: production build for web.
- `pnpm --filter @backslash/ws build`: compile WS TypeScript to `dist/`.
- `pnpm --filter @backslash/web lint`: run ESLint (Next.js).
- `pnpm --filter @backslash/web typecheck`: strict TS check.
- `pnpm --filter @backslash/web db:push`: push Drizzle schema changes.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and follow existing style: 2-space indentation, semicolons, and double quotes.

- React components: `PascalCase` filenames (for example `CodeEditor.tsx`).
- Hooks: `useCamelCase` (for example `useWebSocket.ts`).
- API routes: `src/app/api/**/route.ts`.
- Keep shared interfaces in `packages/shared` instead of duplicating types.

## Testing Guidelines
There is no dedicated automated test framework configured yet. Minimum contribution checks are:

1. Run `pnpm --filter @backslash/web lint`.
2. Run `pnpm --filter @backslash/web typecheck`.
3. Run `pnpm --filter @backslash/ws typecheck` (and other touched packages).
4. Perform a manual smoke test of affected flows (editor, compile, API, or realtime updates).

If you add automated tests, use `*.test.ts`/`*.test.tsx` naming and keep them near the code they validate.

## Commit & Pull Request Guidelines
Recent history follows mostly Conventional Commits (`feat:`, `chore:`). Use:

- `type: concise imperative summary` (example: `feat: add websocket reconnect backoff`).
- One logical change per commit.

For PRs, include:

1. What changed and why.
2. Linked issue (if applicable).
3. Validation steps/commands you ran.
4. Screenshots or short recordings for UI/editor changes.
5. Notes for schema, env, or Docker changes.

## Security & Configuration Tips
Never commit secrets. Keep runtime config in `.env` and update `.env.example` when adding new variables.
