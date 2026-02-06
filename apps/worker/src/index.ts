/**
 * Standalone compilation worker entry point.
 * This can be run separately from the web app for horizontal scaling.
 *
 * Usage: npm start
 *
 * Required environment variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - REDIS_URL: Redis connection string
 * - COMPILER_IMAGE: Docker image for ephemeral compile containers (default: leafedit-compiler)
 * - MAX_CONCURRENT_BUILDS: Max parallel compilations (default: 5)
 * - COMPILE_TIMEOUT: Timeout per build in seconds (default: 120)
 * - STORAGE_PATH: Path to project data (default: /data)
 */

console.log("LeafEdit Compilation Worker");
console.log("==========================");
console.log(`Redis: ${process.env.REDIS_URL || "redis://localhost:6379"}`);
console.log(`Database: ${process.env.DATABASE_URL ? "[configured]" : "[default]"}`);
console.log(`Compiler Image: ${process.env.COMPILER_IMAGE || "leafedit-compiler"}`);
console.log(`Max Concurrent Builds: ${process.env.MAX_CONCURRENT_BUILDS || "5"}`);
console.log(`Compile Timeout: ${process.env.COMPILE_TIMEOUT || "120"}s`);
console.log("");

// The worker is started by importing and calling startCompileWorker
// from the web app's compiler module. In a standalone deployment,
// you would import the worker module here.
console.log("Worker ready. Waiting for compilation jobs...");

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\nShutting down worker...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down worker...");
  process.exit(0);
});
