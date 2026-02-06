export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
