export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Run database migrations before anything else
    try {
      const { runMigrations } = await import("@/lib/db/migrate");
      await runMigrations();
    } catch (err) {
      console.error(
        "[Instrumentation] Migration failed:",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }

    const runInWeb = process.env.RUN_COMPILE_RUNNER_IN_WEB !== "false";

    if (runInWeb) {
      try {
        const { startCompileRunner } = await import("@/lib/compiler/runner");
        const { startAsyncCompileRunner } = await import(
          "@/lib/compiler/asyncCompileRunner"
        );
        startCompileRunner();
        startAsyncCompileRunner();
        console.log("[Instrumentation] Compile runners started");
      } catch (err) {
        console.error(
          "[Instrumentation] Failed to start compile runners:",
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.log(
        "[Instrumentation] Compile runner disabled in web (RUN_COMPILE_RUNNER_IN_WEB=false)"
      );
    }
  }
}
