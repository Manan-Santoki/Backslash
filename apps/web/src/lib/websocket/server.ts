import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { validateSession } from "@/lib/auth/session";
import {
  type BuildUpdatePayload,
  type InterServerEvents,
  type SocketData,
  isBuildComplete,
  getUserRoom,
  getProjectRoom,
} from "./events";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@leafedit/shared";

// ─── Type Alias ────────────────────────────────────

type LeafEditSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// ─── Singleton ─────────────────────────────────────

let io: LeafEditSocketServer | null = null;

// ─── Server Setup ──────────────────────────────────

/**
 * Initializes the Socket.IO server and attaches it to the given
 * HTTP server instance.
 *
 * Features:
 * - Session-token authentication via handshake auth or cookie
 * - Automatic user-room joining on connect
 * - Project room joining on client request
 */
export function initSocketServer(httpServer: HttpServer): LeafEditSocketServer {
  if (io) {
    return io;
  }

  io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    path: "/api/ws",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1 MB
  });

  // ── Authentication Middleware ─────────────────────
  io.use(async (socket, next) => {
    try {
      // Accept token from handshake auth object or from cookie header
      const token =
        (socket.handshake.auth as { token?: string })?.token ||
        extractCookieToken(socket.handshake.headers.cookie);

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const result = await validateSession(token);

      if (!result) {
        return next(new Error("Session expired or invalid"));
      }

      // Attach user data to the socket
      socket.data.userId = result.user.id;
      socket.data.email = result.user.email;
      socket.data.name = result.user.name;

      next();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      next(new Error(message));
    }
  });

  // ── Connection Handler ───────────────────────────
  io.on("connection", (socket) => {
    const { userId, name } = socket.data;
    console.log(`[WS] User connected: ${name} (${userId})`);

    // Automatically join the user's personal room
    socket.join(getUserRoom(userId));

    // Handle project room subscriptions
    socket.on("join:project", ({ projectId }) => {
      if (!projectId || typeof projectId !== "string") {
        return;
      }
      socket.join(getProjectRoom(projectId));
      console.log(`[WS] User ${userId} joined project room: ${projectId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[WS] User disconnected: ${name} (${userId}) - ${reason}`);
    });

    socket.on("error", (err) => {
      console.error(`[WS] Socket error for ${userId}:`, err.message);
    });
  });

  console.log("[WS] Socket.IO server initialized");

  return io;
}

// ─── Broadcast ─────────────────────────────────────

/**
 * Broadcasts a build update to the specified user's room.
 *
 * - Status-only updates (queued, compiling) emit `build:status`
 * - Completed updates (success, error, timeout) emit `build:complete`
 *
 * The update is sent to:
 * 1. The user's personal room (all their connected clients)
 * 2. The project's room (any clients observing that project)
 */
export function broadcastBuildUpdate(
  userId: string,
  payload: BuildUpdatePayload
): void {
  if (!io) {
    console.warn(
      "[WS] Socket.IO server not initialized; skipping broadcast"
    );
    return;
  }

  const userRoom = getUserRoom(userId);
  const projectRoom = getProjectRoom(payload.projectId);

  if (isBuildComplete(payload)) {
    const data = {
      projectId: payload.projectId,
      buildId: payload.buildId,
      status: payload.status,
      pdfUrl: payload.pdfUrl,
      logs: payload.logs,
      durationMs: payload.durationMs,
      errors: payload.errors,
    };

    io.to(userRoom).to(projectRoom).emit("build:complete", data);
  } else {
    const data = {
      projectId: payload.projectId,
      buildId: payload.buildId,
      status: payload.status,
    };

    io.to(userRoom).to(projectRoom).emit("build:status", data);
  }
}

// ─── Accessors ─────────────────────────────────────

/**
 * Returns the Socket.IO server instance, or null if not yet initialized.
 */
export function getSocketServer(): LeafEditSocketServer | null {
  return io;
}

/**
 * Returns the count of currently connected sockets.
 */
export async function getConnectionCount(): Promise<number> {
  if (!io) return 0;
  const sockets = await io.fetchSockets();
  return sockets.length;
}

// ─── Shutdown ──────────────────────────────────────

/**
 * Gracefully shuts down the Socket.IO server, disconnecting all clients.
 */
export async function shutdownSocketServer(): Promise<void> {
  if (io) {
    console.log("[WS] Shutting down Socket.IO server...");

    // Disconnect all clients
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }

    await new Promise<void>((resolve) => {
      io!.close(() => {
        resolve();
      });
    });

    io = null;
    console.log("[WS] Socket.IO server stopped");
  }
}

// ─── Helpers ───────────────────────────────────────

/**
 * Extracts the session token from a raw cookie header string.
 */
function extractCookieToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name.trim() === "session") {
      return rest.join("=").trim();
    }
  }

  return null;
}
