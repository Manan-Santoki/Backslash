export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startCompileRunner } = await import("@/lib/compiler/runner");
      startCompileRunner();
      console.log("[Instrumentation] Compile runner started");
    } catch (err) {
      console.error(
        "[Instrumentation] Failed to start compile runner:",
        err instanceof Error ? err.message : err
      );
    }
  }
}
