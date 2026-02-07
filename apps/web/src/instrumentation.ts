export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startCompileWorker } = await import("@/lib/compiler/worker");
      startCompileWorker();
      console.log("[Instrumentation] Compile worker started");
    } catch (err) {
      console.error(
        "[Instrumentation] Failed to start compile worker:",
        err instanceof Error ? err.message : err
      );
    }
  }
}
