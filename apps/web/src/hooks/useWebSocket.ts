"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { BuildStatus, ParsedLogEntry } from "@leafedit/shared";

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
  onBuildStatus?: (data: BuildStatusData) => void;
  onBuildComplete?: (data: BuildCompleteData) => void;
}

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

  useEffect(() => {
    if (!projectId) return;

    const socket = io({
      path: "/api/ws",
      query: { projectId },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      socket.emit("join:project", { projectId });
    });

    socket.on("build:status", (data: BuildStatusData) => {
      optionsRef.current.onBuildStatus?.(data);
    });

    socket.on("build:complete", (data: BuildCompleteData) => {
      optionsRef.current.onBuildComplete?.(data);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [projectId]);

  return { socket: socketRef, disconnect };
}
