export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Run database migrations on startup — creates tables if they don't exist
    try {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      const { db } = await import("@/lib/db");
      const path = await import("path");
      const fs = await import("fs");

      // Next.js standalone changes CWD, so check multiple possible locations
      const candidates = [
        path.resolve(process.cwd(), "drizzle/migrations"),
        path.resolve(process.cwd(), "apps/web/drizzle/migrations"),
        path.resolve("/app/apps/web/drizzle/migrations"),
        path.resolve("/app/drizzle/migrations"),
      ];

      const migrationsFolder = candidates.find((p) => {
        try {
          return fs.existsSync(path.join(p, "meta/_journal.json"));
        } catch {
          return false;
        }
      });

      if (migrationsFolder) {
        await migrate(db, { migrationsFolder });
        console.log("[DB] Migrations applied successfully");
      } else {
        console.warn("[DB] Migrations folder not found, skipping. Searched:", candidates);
      }
    } catch (error: any) {
      console.error("[DB] Migration failed:", error?.message || error);
      // Don't crash — the tables might already exist
    }

    // Start compile worker immediately — it only needs Redis, not the HTTP server
    const { startCompileWorker } = await import("@/lib/compiler/worker");
    startCompileWorker();
    console.log("[Instrumentation] Compile worker started");

    // Intercept http.createServer to attach Socket.IO (needs the HTTP server instance)
    const http = require("http") as typeof import("http");
    const origCreateServer = http.createServer;

    (http as any).createServer = function (this: any, ...args: any[]) {
      const server = (origCreateServer as Function).apply(this, args);

      // Restore immediately — only intercept the first call
      http.createServer = origCreateServer;

      // Attach Socket.IO to the HTTP server
      import("@/lib/websocket/server").then(({ initSocketServer }) => {
        initSocketServer(server);
      });

      return server;
    };
  }
}
