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
}

interface BuildStatusData {
  projectId: string;
  buildId: string;
  status: "queued" | "compiling";
}

interface UseWebSocketOptions {
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
  // File events
  onFileCreated?: (data: { userId: string; file: { id: string; path: string; isDirectory: boolean } }) => void;
  onFileDeleted?: (data: { userId: string; fileId: string; path: string }) => void;
  onFileSaved?: (data: { userId: string; fileId: string; path: string }) => void;
}

// ─── WebSocket URL Resolution ──────────────────────

/**
 * Resolves the WebSocket server URL at **runtime** (in the browser).
 *
 * Priority:
 * 1. NEXT_PUBLIC_WS_URL env var – but since NEXT_PUBLIC_ vars are
 *    inlined at build time this only works when the Docker build
 *    receives the arg.  For most deployments the automatic
 *    detection below is preferred.
 *
 * 2. Same origin with `/ws` path – works behind any reverse proxy
 *    (Dokploy, Coolify, Traefik, Caddy …) that forwards /ws to
 *    the WebSocket service.
 *
 * 3. Same hostname, port 3001 – bare Docker Compose / local dev
 *    where no reverse proxy rewrites paths.
 */
function getWsUrl(): string {
  // Build-time override (only works if set during `next build`)
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const host = window.location.host; // includes port if non-standard

    // Behind HTTPS (production with reverse proxy) → use /ws path
    if (window.location.protocol === "https:") {
      return `${protocol}://${host}/ws`;
    }

    // Plain HTTP (local dev / bare Docker Compose) → port 3001
    return `${protocol}://${window.location.hostname}:3001`;
  }

  return "http://localhost:3001";
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

  const leaveProject = useCallback((projId: string) => {
    socketRef.current?.emit("leave:project", { projectId: projId });
  }, []);

  // ── Socket lifecycle ──────────────────────────

  useEffect(() => {
    if (!projectId) return;

    const wsUrl = getWsUrl();

    const socket = io(wsUrl, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("[WS] Connected to WebSocket server");
      socket.emit("join:project", { projectId });
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
  }, [projectId]);

  return {
    socket: socketRef,
    disconnect,
    sendActiveFile,
    sendCursorMove,
    sendDocChange,
    sendChatMessage,
    leaveProject,
  };
}
