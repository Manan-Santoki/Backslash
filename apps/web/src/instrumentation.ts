export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Database migrations are handled by scripts/migrate.mjs which runs
    // before the app starts (via docker-entrypoint.sh on deploy, or
    // `pnpm db:deploy` manually). No migration logic needed here.

    // Start compile worker immediately — it only needs Redis, not the HTTP server
    const { startCompileWorker } = await import("@/lib/compiler/worker");
    startCompileWorker();
    console.log("[Instrumentation] Compile worker started");
  }
}
