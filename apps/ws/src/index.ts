import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import IORedis from "ioredis";
import postgres from "postgres";
import { randomUUID } from "crypto";

// ─── Shared Types (inlined to avoid monorepo build issues) ─

interface PresenceUser {
  userId: string;
  name: string;
  email: string;
  color: string;
  activeFileId: string | null;
  activeFilePath: string | null;
}

interface CursorPosition {
  line: number;
  ch: number;
}

interface CursorSelection {
  anchor: CursorPosition;
  head: CursorPosition;
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

interface DocChange {
  from: number;
  to: number;
  insert: string;
}

// ─── Socket.IO Event Maps ──────────────────────────

interface ServerToClientEvents {
  "build:status": (data: { projectId: string; buildId: string; status: "queued" | "compiling" }) => void;
  "build:complete": (data: { projectId: string; buildId: string; status: string; pdfUrl: string | null; logs: string; durationMs: number; errors: any[] }) => void;
  "presence:users": (data: { users: PresenceUser[] }) => void;
  "presence:joined": (data: { user: PresenceUser }) => void;
  "presence:left": (data: { userId: string }) => void;
  "presence:updated": (data: { userId: string; activeFileId: string | null; activeFilePath: string | null }) => void;
  "cursor:updated": (data: { userId: string; fileId: string; selection: CursorSelection }) => void;
  "cursor:cleared": (data: { userId: string }) => void;
  "doc:changed": (data: { userId: string; fileId: string; changes: DocChange[]; version: number }) => void;
  "chat:message": (data: ChatMessage) => void;
  "chat:history": (data: { messages: ChatMessage[] }) => void;
  "file:created": (data: { userId: string; file: { id: string; path: string; isDirectory: boolean } }) => void;
  "file:deleted": (data: { userId: string; fileId: string; path: string }) => void;
  "file:saved": (data: { userId: string; fileId: string; path: string }) => void;
}

interface ClientToServerEvents {
  "join:project": (data: { projectId: string }) => void;
  "leave:project": (data: { projectId: string }) => void;
  "presence:activeFile": (data: { fileId: string | null; filePath: string | null }) => void;
  "cursor:move": (data: { fileId: string; selection: CursorSelection }) => void;
  "doc:change": (data: { fileId: string; changes: DocChange[]; version: number }) => void;
  "chat:send": (data: { text: string }) => void;
}

// ─── Configuration ─────────────────────────────────

const PORT = parseInt(process.env.WS_PORT || "3001", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@postgres:5432/backslash";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// ─── Presence Colors ───────────────────────────────

const PRESENCE_COLORS = [
  "#f38ba8", // red
  "#fab387", // peach
  "#f9e2af", // yellow
  "#a6e3a1", // green
  "#94e2d5", // teal
  "#89b4fa", // blue
  "#b4befe", // lavender
  "#cba6f7", // mauve
  "#f5c2e7", // pink
  "#89dceb", // sky
];

let colorIndex = 0;
function nextColor(): string {
  const color = PRESENCE_COLORS[colorIndex % PRESENCE_COLORS.length];
  colorIndex++;
  return color;
}

// ─── Database ──────────────────────────────────────

const sql = postgres(DATABASE_URL);

/**
 * Validates a session token against the database.
 * Returns user info if valid, null otherwise.
 */
async function validateSession(
  token: string
): Promise<{ id: string; email: string; name: string } | null> {
  try {
    const result = await sql`
      SELECT u.id, u.email, u.name
      FROM sessions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
      LIMIT 1
    `;
    if (result.length === 0) return null;
    return result[0] as { id: string; email: string; name: string };
  } catch (err) {
    console.error("[WS] Session validation error:", err);
    return null;
  }
}

/**
 * Check if a user has access to a project (owner or shared).
 */
async function checkProjectAccess(
  userId: string,
  projectId: string
): Promise<{ access: boolean; role: "owner" | "viewer" | "editor" }> {
  try {
    // Check if owner
    const ownerResult = await sql`
      SELECT id FROM projects
      WHERE id = ${projectId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (ownerResult.length > 0) {
      return { access: true, role: "owner" };
    }

    // Check if shared
    const shareResult = await sql`
      SELECT role FROM project_shares
      WHERE project_id = ${projectId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (shareResult.length > 0) {
      return { access: true, role: shareResult[0].role as "viewer" | "editor" };
    }

    return { access: false, role: "viewer" };
  } catch (err) {
    console.error("[WS] Project access check error:", err);
    return { access: false, role: "viewer" };
  }
}

// ─── Redis Pub/Sub ─────────────────────────────────

const subscriber = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});

subscriber.on("error", (err) => {
  console.error("[Redis] Subscriber error:", err.message);
});

subscriber.on("connect", () => {
  console.log("[Redis] Subscriber connected");
});

// ─── Socket.IO Server ──────────────────────────────

const httpServer = createServer((_req, res) => {
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "backslash-ws" }));
});

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(","),
    credentials: true,
  },
  transports: ["websocket", "polling"],
  path: "/socket.io",
  pingInterval: 25000,
  pingTimeout: 20000,
});

// ─── Room Helpers ──────────────────────────────────

function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}

// ─── In-memory State ───────────────────────────────

// Presence: projectId -> Map<userId, PresenceUser>
const presenceMap = new Map<string, Map<string, PresenceUser>>();

// Chat history: projectId -> ChatMessage[] (last 100)
const chatHistory = new Map<string, ChatMessage[]>();

const MAX_CHAT_HISTORY = 100;

// Track which project each socket is in: socketId -> projectId
const socketProjectMap = new Map<string, string>();

function getProjectPresence(projectId: string): Map<string, PresenceUser> {
  let map = presenceMap.get(projectId);
  if (!map) {
    map = new Map();
    presenceMap.set(projectId, map);
  }
  return map;
}

function getProjectChat(projectId: string): ChatMessage[] {
  let msgs = chatHistory.get(projectId);
  if (!msgs) {
    msgs = [];
    chatHistory.set(projectId, msgs);
  }
  return msgs;
}

function addChatMessage(projectId: string, msg: ChatMessage): void {
  const msgs = getProjectChat(projectId);
  msgs.push(msg);
  if (msgs.length > MAX_CHAT_HISTORY) {
    msgs.shift();
  }
}

// ─── Authentication Middleware ──────────────────────

io.use(async (socket, next) => {
  try {
    // Extract session token from cookie header or auth query param
    const cookieHeader = socket.handshake.headers.cookie;
    let token = extractCookieToken(cookieHeader);

    // Fallback: check query param (for environments where cookies aren't forwarded)
    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token as string;
    }

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const user = await validateSession(token);
    if (!user) {
      return next(new Error("Invalid or expired session"));
    }

    // Attach user data to socket
    socket.data.userId = user.id;
    socket.data.email = user.email;
    socket.data.name = user.name;
    socket.data.color = nextColor();

    next();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Authentication failed";
    next(new Error(message));
  }
});

// ─── Connection Handler ────────────────────────────

io.on("connection", (socket) => {
  const { userId, name, email, color } = socket.data;
  console.log(`[WS] User connected: ${name} (${userId})`);

  // Automatically join the user's personal room
  socket.join(getUserRoom(userId));

  // ── Join project room ──────────────────────

  socket.on("join:project", async ({ projectId }) => {
    if (!projectId || typeof projectId !== "string") return;

    // Check access (owner or shared)
    const { access, role } = await checkProjectAccess(userId, projectId);
    if (!access) {
      socket.emit("build:status", {
        projectId,
        buildId: "",
        status: "queued",
      });
      return;
    }

    // Leave any previously joined project
    const prevProject = socketProjectMap.get(socket.id);
    if (prevProject && prevProject !== projectId) {
      leaveProject(socket, prevProject);
    }

    socket.join(getProjectRoom(projectId));
    socketProjectMap.set(socket.id, projectId);
    socket.data.projectId = projectId;
    socket.data.role = role;

    // Add to presence
    const presence = getProjectPresence(projectId);
    const presenceUser: PresenceUser = {
      userId,
      name,
      email,
      color,
      activeFileId: null,
      activeFilePath: null,
    };
    presence.set(userId, presenceUser);

    // Send current presence to the joining user
    socket.emit("presence:users", {
      users: Array.from(presence.values()),
    });

    // Send chat history
    const history = getProjectChat(projectId);
    if (history.length > 0) {
      socket.emit("chat:history", { messages: history });
    }

    // Notify others about the new user
    socket.to(getProjectRoom(projectId)).emit("presence:joined", {
      user: presenceUser,
    });

    console.log(`[WS] User ${name} joined project ${projectId} as ${role}`);
  });

  // ── Leave project room ─────────────────────

  socket.on("leave:project", ({ projectId }) => {
    if (!projectId || typeof projectId !== "string") return;
    leaveProject(socket, projectId);
  });

  // ── Presence: active file ──────────────────

  socket.on("presence:activeFile", ({ fileId, filePath }) => {
    const projectId = socket.data.projectId;
    if (!projectId) return;

    const presence = getProjectPresence(projectId);
    const existing = presence.get(userId);
    if (existing) {
      existing.activeFileId = fileId;
      existing.activeFilePath = filePath;
    }

    socket.to(getProjectRoom(projectId)).emit("presence:updated", {
      userId,
      activeFileId: fileId,
      activeFilePath: filePath,
    });
  });

  // ── Cursor movement ────────────────────────

  socket.on("cursor:move", ({ fileId, selection }) => {
    const projectId = socket.data.projectId;
    if (!projectId) return;

    socket.to(getProjectRoom(projectId)).emit("cursor:updated", {
      userId,
      fileId,
      selection,
    });
  });

  // ── Document changes (collaborative) ───────

  socket.on("doc:change", ({ fileId, changes, version }) => {
    const projectId = socket.data.projectId;
    if (!projectId) return;

    // Viewers can't send document changes
    if (socket.data.role === "viewer") return;

    // Relay to all other users in the project
    socket.to(getProjectRoom(projectId)).emit("doc:changed", {
      userId,
      fileId,
      changes,
      version,
    });
  });

  // ── Chat ───────────────────────────────────

  socket.on("chat:send", ({ text }) => {
    const projectId = socket.data.projectId;
    if (!projectId || !text || !text.trim()) return;

    const msg: ChatMessage = {
      id: randomUUID(),
      userId,
      userName: name,
      text: text.trim(),
      timestamp: Date.now(),
    };

    addChatMessage(projectId, msg);

    // Broadcast to everyone in the project room (including sender)
    io.to(getProjectRoom(projectId)).emit("chat:message", msg);
  });

  // ── Disconnect ─────────────────────────────

  socket.on("disconnect", (reason) => {
    const projectId = socketProjectMap.get(socket.id);
    if (projectId) {
      leaveProject(socket, projectId);
    }
    console.log(`[WS] User disconnected: ${name} (${userId}) - ${reason}`);
  });

  socket.on("error", (err) => {
    console.error(`[WS] Socket error for ${userId}:`, err.message);
  });
});

/**
 * Remove a socket from a project room and clean up presence.
 */
function leaveProject(socket: any, projectId: string) {
  const userId = socket.data.userId;

  socket.leave(getProjectRoom(projectId));
  socketProjectMap.delete(socket.id);

  // Remove from presence
  const presence = getProjectPresence(projectId);
  presence.delete(userId);

  // Clean up empty maps
  if (presence.size === 0) {
    presenceMap.delete(projectId);
  }

  // Notify others
  socket.to(getProjectRoom(projectId)).emit("presence:left", { userId });
  socket.to(getProjectRoom(projectId)).emit("cursor:cleared", { userId });

  if (socket.data.projectId === projectId) {
    socket.data.projectId = null;
    socket.data.role = null;
  }
}

// ─── Redis Subscription ────────────────────────────

const BUILD_CHANNEL = "build:updates";
const FILE_CHANNEL = "file:updates";

subscriber.subscribe(BUILD_CHANNEL, FILE_CHANNEL, (err) => {
  if (err) {
    console.error("[Redis] Failed to subscribe:", err);
  } else {
    console.log(`[Redis] Subscribed to ${BUILD_CHANNEL}, ${FILE_CHANNEL}`);
  }
});

subscriber.on("message", (channel, message) => {
  try {
    if (channel === BUILD_CHANNEL) {
      handleBuildUpdate(message);
    } else if (channel === FILE_CHANNEL) {
      handleFileUpdate(message);
    }
  } catch (err) {
    console.error("[WS] Failed to process Redis message:", err);
  }
});

function handleBuildUpdate(message: string) {
  const { userId, payload } = JSON.parse(message) as {
    userId: string;
    payload: any;
  };

  const userRoom = getUserRoom(userId);
  const projectRoom = getProjectRoom(payload.projectId);

  // Determine event type based on status
  const isComplete =
    payload.status === "success" ||
    payload.status === "error" ||
    payload.status === "timeout";

  if (isComplete) {
    io.to(userRoom).to(projectRoom).emit("build:complete", {
      projectId: payload.projectId,
      buildId: payload.buildId,
      status: payload.status,
      pdfUrl: payload.pdfUrl ?? null,
      logs: payload.logs ?? "",
      durationMs: payload.durationMs ?? 0,
      errors: payload.errors ?? [],
    });
  } else {
    io.to(userRoom).to(projectRoom).emit("build:status", {
      projectId: payload.projectId,
      buildId: payload.buildId,
      status: payload.status,
    });
  }
}

function handleFileUpdate(message: string) {
  const payload = JSON.parse(message) as {
    type: string;
    projectId: string;
    userId: string;
    fileId: string;
    path: string;
    isDirectory?: boolean;
  };

  const projectRoom = getProjectRoom(payload.projectId);

  switch (payload.type) {
    case "file:created":
      io.to(projectRoom).emit("file:created", {
        userId: payload.userId,
        file: {
          id: payload.fileId,
          path: payload.path,
          isDirectory: payload.isDirectory ?? false,
        },
      });
      break;
    case "file:deleted":
      io.to(projectRoom).emit("file:deleted", {
        userId: payload.userId,
        fileId: payload.fileId,
        path: payload.path,
      });
      break;
    case "file:saved":
      io.to(projectRoom).emit("file:saved", {
        userId: payload.userId,
        fileId: payload.fileId,
        path: payload.path,
      });
      break;
  }
}

// ─── Start Server ──────────────────────────────────

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Backslash WebSocket Server         ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Port:     ${String(PORT).padEnd(25)}║`);
  console.log(`║  Redis:    ${REDIS_URL.padEnd(25)}║`);
  console.log(`║  Database: [configured]${" ".repeat(14)}║`);
  console.log(`║  CORS:     ${CORS_ORIGIN.substring(0, 25).padEnd(25)}║`);
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  console.log("[WS] Server ready — waiting for connections...");
});

// ─── Graceful Shutdown ─────────────────────────────

async function shutdown(signal: string) {
  console.log(`\n[WS] Received ${signal}, shutting down...`);

  // Disconnect all clients
  const sockets = await io.fetchSockets();
  for (const socket of sockets) {
    socket.disconnect(true);
  }

  // Close servers
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });

  subscriber.disconnect();
  await sql.end();

  console.log("[WS] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─── Helpers ───────────────────────────────────────

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
