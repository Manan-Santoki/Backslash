"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  BuildStatus,
  ParsedLogEntry,
  PresenceUser,
  CursorSelection,
  ChatMessage,
  DocChange,
} from "@backslash/shared";

// ─── Types ─────────────────────────────────────────

interface BuildCompleteData {
  projectId: string;
  buildId: string;
  status: BuildStatus;
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
  triggeredByUserId?: string | null;
}

interface BuildStatusData {
  projectId: string;
  buildId: string;
  status: "queued" | "compiling";
  triggeredByUserId?: string | null;
}

interface SelfIdentity {
  userId: string;
  name: string;
  email: string;
  color: string;
}

interface UseWebSocketOptions {
  shareToken?: string | null;
  // Identity event (server tells client its assigned identity)
  onSelfIdentity?: (identity: SelfIdentity) => void;
  // Build events
  onBuildStatus?: (data: BuildStatusData) => void;
  onBuildComplete?: (data: BuildCompleteData) => void;
  // Presence events
  onPresenceUsers?: (users: PresenceUser[]) => void;
  onPresenceJoined?: (user: PresenceUser) => void;
  onPresenceLeft?: (userId: string) => void;
  onPresenceUpdated?: (data: { userId: string; activeFileId: string | null; activeFilePath: string | null }) => void;
  // Cursor events
  onCursorUpdated?: (data: { userId: string; fileId: string; selection: CursorSelection }) => void;
  onCursorCleared?: (userId: string) => void;
  // Document events
  onDocChanged?: (data: { userId: string; fileId: string; changes: DocChange[]; version: number }) => void;
  // Chat events
  onChatMessage?: (message: ChatMessage) => void;
  onChatHistory?: (messages: ChatMessage[]) => void;
  onChatRead?: (data: {
    userId: string;
    lastReadMessageId: string;
    timestamp: number;
  }) => void;
  onChatReadState?: (
    reads: Array<{
      userId: string;
      lastReadMessageId: string;
      timestamp: number;
    }>
  ) => void;
  // File events
  onFileCreated?: (data: { userId: string; file: { id: string; path: string; isDirectory: boolean } }) => void;
  onFileDeleted?: (data: { userId: string; fileId: string; path: string }) => void;
  onFileSaved?: (data: { userId: string; fileId: string; path: string }) => void;
}

// ─── WebSocket URL Resolution ──────────────────────

/**
 * Resolves the WebSocket server URL and socket.io path at **runtime**.
 *
 * Behind a reverse proxy (HTTPS / production):
 *   Dokploy routes /ws/* → ws:3001 (stripping the /ws prefix).
 *   So we connect to the same host with path "/ws/socket.io".
 *
 * Direct connection (HTTP / local dev):
 *   Connect to the same hostname on port 3001, path "/socket.io".
 */
function getWsConfig(): { url: string; path: string } {
  // Build-time override (only works if set during `next build`)
  if (process.env.NEXT_PUBLIC_WS_URL) {
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    // If the env URL contains a path component (e.g. /ws), use it as a path prefix
    try {
      const parsed = new URL(envUrl);
      if (parsed.pathname && parsed.pathname !== "/") {
        return {
          url: parsed.origin,
          path: `${parsed.pathname}/socket.io`,
        };
      }
    } catch {
      // Fall through
    }
    return { url: envUrl, path: "/socket.io" };
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const host = window.location.host; // includes port if non-standard

    // Behind HTTPS (production with reverse proxy) → use /ws path prefix
    if (window.location.protocol === "https:") {
      return {
        url: `${protocol}://${host}`,
        path: "/ws/socket.io",
      };
    }

    // Plain HTTP (local dev / bare Docker Compose) → direct port 3001
    return {
      url: `${protocol}://${window.location.hostname}:3001`,
      path: "/socket.io",
    };
  }

  return { url: "http://localhost:3001", path: "/socket.io" };
}

// ─── Hook ──────────────────────────────────────────

export function useWebSocket(
  projectId: string | null,
  options: UseWebSocketOptions = {}
) {
  const socketRef = useRef<Socket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // ── Emit helpers ──────────────────────────────

  const sendActiveFile = useCallback(
    (fileId: string | null, filePath: string | null) => {
      socketRef.current?.emit("presence:activeFile", { fileId, filePath });
    },
    []
  );

  const sendCursorMove = useCallback(
    (fileId: string, selection: CursorSelection) => {
      socketRef.current?.emit("cursor:move", { fileId, selection });
    },
    []
  );

  const sendDocChange = useCallback(
    (fileId: string, changes: DocChange[], version: number) => {
      socketRef.current?.emit("doc:change", { fileId, changes, version });
    },
    []
  );

  const sendChatMessage = useCallback((text: string) => {
    socketRef.current?.emit("chat:send", { text });
  }, []);

  const sendChatRead = useCallback((lastReadMessageId: string) => {
    if (!lastReadMessageId) return;
    socketRef.current?.emit("chat:read", { lastReadMessageId });
  }, []);

  const leaveProject = useCallback((projId: string) => {
    socketRef.current?.emit("leave:project", { projectId: projId });
  }, []);

  // ── Socket lifecycle ──────────────────────────

  useEffect(() => {
    if (!projectId) return;

    const { url: wsUrl, path: wsPath } = getWsConfig();

    const socket = io(wsUrl, {
      path: wsPath,
      withCredentials: true,
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      auth: optionsRef.current.shareToken
        ? { shareToken: optionsRef.current.shareToken }
        : undefined,
    });

    socket.on("connect", () => {
      console.log("[WS] Connected to WebSocket server");
      socket.emit("join:project", { projectId });
    });

    // Identity event — server tells us our assigned userId/name
    socket.on("self:identity", (data: SelfIdentity) => {
      optionsRef.current.onSelfIdentity?.(data);
    });

    // Build events
    socket.on("build:status", (data: BuildStatusData) => {
      optionsRef.current.onBuildStatus?.(data);
    });

    socket.on("build:complete", (data: BuildCompleteData) => {
      optionsRef.current.onBuildComplete?.(data);
    });

    // Presence events
    socket.on("presence:users", (data: { users: PresenceUser[] }) => {
      optionsRef.current.onPresenceUsers?.(data.users);
    });

    socket.on("presence:joined", (data: { user: PresenceUser }) => {
      optionsRef.current.onPresenceJoined?.(data.user);
    });

    socket.on("presence:left", (data: { userId: string }) => {
      optionsRef.current.onPresenceLeft?.(data.userId);
    });

    socket.on(
      "presence:updated",
      (data: { userId: string; activeFileId: string | null; activeFilePath: string | null }) => {
        optionsRef.current.onPresenceUpdated?.(data);
      }
    );

    // Cursor events
    socket.on(
      "cursor:updated",
      (data: { userId: string; fileId: string; selection: CursorSelection }) => {
        optionsRef.current.onCursorUpdated?.(data);
      }
    );

    socket.on("cursor:cleared", (data: { userId: string }) => {
      optionsRef.current.onCursorCleared?.(data.userId);
    });

    // Document change events
    socket.on(
      "doc:changed",
      (data: { userId: string; fileId: string; changes: DocChange[]; version: number }) => {
        optionsRef.current.onDocChanged?.(data);
      }
    );

    // Chat events
    socket.on("chat:message", (data: ChatMessage) => {
      optionsRef.current.onChatMessage?.(data);
    });

    socket.on("chat:history", (data: { messages: ChatMessage[] }) => {
      optionsRef.current.onChatHistory?.(data.messages);
    });

    socket.on(
      "chat:read",
      (data: {
        userId: string;
        lastReadMessageId: string;
        timestamp: number;
      }) => {
        optionsRef.current.onChatRead?.(data);
      }
    );

    socket.on(
      "chat:readState",
      (data: {
        reads: Array<{
          userId: string;
          lastReadMessageId: string;
          timestamp: number;
        }>;
      }) => {
        optionsRef.current.onChatReadState?.(data.reads);
      }
    );

    // File events
    socket.on(
      "file:created",
      (data: { userId: string; file: { id: string; path: string; isDirectory: boolean } }) => {
        optionsRef.current.onFileCreated?.(data);
      }
    );

    socket.on(
      "file:deleted",
      (data: { userId: string; fileId: string; path: string }) => {
        optionsRef.current.onFileDeleted?.(data);
      }
    );

    socket.on(
      "file:saved",
      (data: { userId: string; fileId: string; path: string }) => {
        optionsRef.current.onFileSaved?.(data);
      }
    );

    socket.on("connect_error", (err) => {
      console.warn("[WS] Connection error:", err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [projectId, options.shareToken]);

  return {
    socket: socketRef,
    disconnect,
    sendActiveFile,
    sendCursorMove,
    sendDocChange,
    sendChatMessage,
    sendChatRead,
    leaveProject,
  };
}
