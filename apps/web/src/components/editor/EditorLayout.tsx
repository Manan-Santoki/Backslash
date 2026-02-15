"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { FileTree } from "@/components/editor/FileTree";
import { CodeEditor, CodeEditorHandle } from "@/components/editor/CodeEditor";
import { EditorTabs } from "@/components/editor/EditorTabs";
import { PdfViewer, PdfViewerHandle } from "@/components/editor/PdfViewer";
import { BuildLogs } from "@/components/editor/BuildLogs";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { FileText } from "lucide-react";
import type { PresenceUser, ChatMessage, CursorSelection, DocChange } from "@backslash/shared";

// ─── Types ──────────────────────────────────────────

interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isDirectory: boolean | null;
  createdAt: string;
  updatedAt: string;
}

interface Build {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  engine: string;
  logs: string | null;
  durationMs: number | null;
  pdfPath: string | null;
  exitCode: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

interface OpenFile {
  id: string;
  path: string;
}

interface LogError {
  type: string;
  file: string;
  line: number;
  message: string;
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

interface ChatReadReceipt {
  userId: string;
  lastReadMessageId: string;
  timestamp: number;
}

interface CollaboratorInfo {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "viewer" | "editor";
  createdAt: string;
  expiresAt?: string | null;
}

interface PublicShareInfo {
  enabled: boolean;
  role: "viewer" | "editor";
  expiresAt: string | null;
  token?: string | null;
  url?: string | null;
}

interface EditorLayoutProps {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
  role?: "owner" | "viewer" | "editor";
  currentUser?: CurrentUser;
  shareToken?: string | null;
  isPublicShare?: boolean;
  onIdentityResolved?: (user: CurrentUser) => void;
}

// ─── Editor Layout ──────────────────────────────────

export function EditorLayout({
  project,
  files: initialFiles,
  lastBuild: initialBuild,
  role = "owner",
  currentUser: initialCurrentUser = { id: "", email: "", name: "" },
  shareToken = null,
  isPublicShare = false,
  onIdentityResolved,
}: EditorLayoutProps) {
  // Viewers can only see live changes and PDF — no editing, no builds
  const canEdit = role === "owner" || role === "editor";

  const [currentUser, setCurrentUser] = useState<CurrentUser>(initialCurrentUser);
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>("");
  // Normalize stale in-progress build statuses: if DB says queued/compiling,
  // the build may have finished or crashed while nobody was watching.
  const initialBuildStatus = (() => {
    const s = initialBuild?.status;
    if (s === "queued" || s === "compiling") return "idle";
    return s ?? "idle";
  })();
  const initialBuildMaybeRunning =
    initialBuild?.status === "queued" || initialBuild?.status === "compiling";

  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(
    initialBuild?.status === "success"
      ? shareToken
        ? `/api/projects/${project.id}/pdf?t=${Date.now()}&share=${encodeURIComponent(
            shareToken
          )}`
        : `/api/projects/${project.id}/pdf?t=${Date.now()}`
      : null
  );
  const [buildStatus, setBuildStatus] = useState(initialBuildStatus);
  const [buildLogs, setBuildLogs] = useState(initialBuild?.logs ?? "");
  const [buildDuration, setBuildDuration] = useState<number | null>(
    initialBuild?.durationMs ?? null
  );
  const [buildActorName, setBuildActorName] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<LogError[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Disable auto-compile if last build failed (prevents rebuild loop on refresh)
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(() => {
    if (initialBuild?.status === "error" || initialBuild?.status === "timeout") {
      return false;
    }
    return true;
  });

  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());

  // ─── Compile Guards (prevent build pileup) ────────

  // Ref-based compiling flag: avoids stale closures in callbacks
  const compilingRef = useRef(false);
  // When a save+compile is requested while already compiling, set this flag.
  // After the current build completes successfully, we'll trigger a recompile.
  const pendingRecompileRef = useRef(false);
  // Track autoCompileEnabled via ref for use in WS callbacks
  const autoCompileEnabledRef = useRef(autoCompileEnabled);
  autoCompileEnabledRef.current = autoCompileEnabled;

  // ─── Collaboration State ──────────────────────────

  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatReadState, setChatReadState] = useState<
    Map<string, { lastReadMessageId: string; timestamp: number }>
  >(new Map());
  const [isSharedProject, setIsSharedProject] = useState(role !== "owner");
  const [shareHistoryEntries, setShareHistoryEntries] = useState<string[]>([]);

  const [remoteChanges, setRemoteChanges] = useState<{
    fileId: string;
    userId: string;
    changes: DocChange[];
  } | null>(null);

  const [remoteCursors, setRemoteCursors] = useState<
    Map<string, { color: string; name: string; selection: CursorSelection }>
  >(new Map());

  // ─── Follow Mode State ──────────────────────────

  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const followingUserIdRef = useRef<string | null>(null);
  followingUserIdRef.current = followingUserId;

  // User color map for chat
  const userColorMap = new Map<string, string>();
  presenceUsers.forEach((u) => userColorMap.set(u.userId, u.color));
  const userNameMap = new Map<string, string>();
  presenceUsers.forEach((u) => userNameMap.set(u.userId, u.name));
  chatMessages.forEach((m) => {
    if (!userNameMap.has(m.userId)) {
      userNameMap.set(m.userId, m.userName);
    }
  });
  if (currentUser.id) {
    userNameMap.set(currentUser.id, currentUser.name || "You");
  }

  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const pdfViewerRef = useRef<PdfViewerHandle>(null);
  const editorScrollRef = useRef<number | null>(null);
  const editorSelectionRef = useRef<{ anchor: number; head: number } | null>(
    null
  );
  const savedContentRef = useRef<Map<string, string>>(new Map());
  const fileContentsRef = useRef<Map<string, string>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoOpenedMainRef = useRef(false);
  const fileLoadRetriesRef = useRef<Map<string, number>>(new Map());

  const activeFileIdRef = useRef<string | null>(null);
  activeFileIdRef.current = activeFileId;

  const withShareToken = useCallback(
    (url: string) => {
      if (!shareToken) return url;
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}share=${encodeURIComponent(shareToken)}`;
    },
    [shareToken]
  );

  const saveViewPositionsBeforeBuild = useCallback(() => {
    pdfViewerRef.current?.saveScrollPosition();
    editorScrollRef.current = codeEditorRef.current?.getScrollPosition() ?? null;
    editorSelectionRef.current = codeEditorRef.current?.getSelection() ?? null;
  }, []);

  const restoreViewPositionsAfterBuild = useCallback(() => {
    requestAnimationFrame(() => {
      if (editorScrollRef.current !== null) {
        codeEditorRef.current?.setScrollPosition(editorScrollRef.current);
      }
      if (editorSelectionRef.current) {
        codeEditorRef.current?.setSelection(editorSelectionRef.current);
      }
      editorScrollRef.current = null;
      editorSelectionRef.current = null;
    });
  }, []);

  const formatExpiry = useCallback((expiresAt: string | null | undefined) => {
    if (!expiresAt) return "no expiry";
    const when = new Date(expiresAt);
    return `expires ${when.toLocaleString()}`;
  }, []);

  const refreshShareState = useCallback(async () => {
    if (shareToken) {
      setIsSharedProject(true);
      setShareHistoryEntries([]);
      return;
    }

    try {
      const [collabRes, publicRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/collaborators`, { cache: "no-store" }),
        fetch(`/api/projects/${project.id}/share-link`, { cache: "no-store" }),
      ]);

      const collaborators: CollaboratorInfo[] = collabRes.ok
        ? (await collabRes.json()).collaborators ?? []
        : [];

      const publicShare: PublicShareInfo = publicRes.ok
        ? (await publicRes.json()).share ?? {
            enabled: false,
            role: "viewer",
            expiresAt: null,
          }
        : { enabled: false, role: "viewer", expiresAt: null };

      const historyEntries: string[] = [];

      if (publicShare.enabled) {
        historyEntries.push(
          `Shared with anyone (${publicShare.role}, ${formatExpiry(
            publicShare.expiresAt
          )})`
        );
      }

      collaborators
        .slice()
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
        .forEach((collab) => {
          historyEntries.push(
            `Shared with ${collab.email} (${collab.role}, ${formatExpiry(
              collab.expiresAt
            )})`
          );
        });

      setShareHistoryEntries(historyEntries);
      setIsSharedProject(
        role !== "owner" || publicShare.enabled || collaborators.length > 0
      );
    } catch {
      setShareHistoryEntries([]);
      setIsSharedProject(role !== "owner");
    }
  }, [formatExpiry, project.id, role, shareToken]);

  const resolveActorName = useCallback(
    (triggeredByUserId?: string | null): string | null => {
      if (!triggeredByUserId) return null;
      if (triggeredByUserId === currentUser.id) return "You";
      return (
        presenceUsers.find((u) => u.userId === triggeredByUserId)?.name ??
        null
      );
    },
    [currentUser.id, presenceUsers]
  );

  // ─── Helpers ───────────────────────────────────────

  const clearAllPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /** Reset all compiling state back to idle */
  const resetCompileState = useCallback(() => {
    compilingRef.current = false;
    setCompiling(false);
    setPdfLoading(false);
    clearAllPolling();
  }, [clearAllPolling]);

  const applyChangesToCache = useCallback(
    (fileId: string, changes: DocChange[]) => {
      const cached = fileContentsRef.current.get(fileId);
      if (cached === undefined) return;

      let result = cached;
      const sorted = [...changes].sort((a, b) => b.from - a.from);
      for (const change of sorted) {
        const from = Math.min(change.from, result.length);
        const to = Math.min(change.to, result.length);
        result = result.slice(0, from) + change.insert + result.slice(to);
      }
      fileContentsRef.current.set(fileId, result);
    },
    []
  );

  const fetchFileContent = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(
          withShareToken(`/api/projects/${project.id}/files/${fileId}`),
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          const content = data.content ?? "";
          fileContentsRef.current.set(fileId, content);
          fileLoadRetriesRef.current.delete(fileId);
          if (activeFileIdRef.current === fileId) {
            setActiveFileContent(content);
          }
          savedContentRef.current.set(fileId, content);
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.delete(fileId);
            return next;
          });
        } else {
          const retries = fileLoadRetriesRef.current.get(fileId) ?? 0;
          if (retries < 2) {
            fileLoadRetriesRef.current.set(fileId, retries + 1);
            setTimeout(() => {
              if (activeFileIdRef.current === fileId) {
                fetchFileContent(fileId);
              }
            }, 300);
          }
        }
      } catch {
        const retries = fileLoadRetriesRef.current.get(fileId) ?? 0;
        if (retries < 2) {
          fileLoadRetriesRef.current.set(fileId, retries + 1);
          setTimeout(() => {
            if (activeFileIdRef.current === fileId) {
              fetchFileContent(fileId);
            }
          }, 300);
          return;
        }
        if (activeFileIdRef.current === fileId) {
          setActiveFileContent("");
        }
      }
    },
    [project.id, withShareToken]
  );

  // ─── Polling fallback for build completion ────────

  const startBuildPolling = useCallback(() => {
    clearAllPolling();

    pollIntervalRef.current = setInterval(async () => {
      try {
        const logsRes = await fetch(withShareToken(`/api/projects/${project.id}/logs`), {
          cache: "no-store",
        });
        if (!logsRes.ok) return;

        const logsData = await logsRes.json();
        const build = logsData.build;

        if (
          build.status === "success" ||
          build.status === "error" ||
          build.status === "timeout" ||
          build.status === "canceled"
        ) {
          clearAllPolling();

          // Only update if still compiling (WS may have handled it)
          if (!compilingRef.current) return;

          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(logsData.errors ?? []);

          if (build.status === "success") {
            setPdfUrl(withShareToken(`/api/projects/${project.id}/pdf?t=${Date.now()}`));
            restoreViewPositionsAfterBuild();
            setAutoCompileEnabled(true);

            // If file was changed during build, recompile
            if (pendingRecompileRef.current) {
              pendingRecompileRef.current = false;
              setBuildStatus("queued");
              saveViewPositionsBeforeBuild();
              fetch(withShareToken(`/api/projects/${project.id}/compile`), {
                method: "POST",
              })
                .then((res) => {
                  if (res.ok) {
                    startBuildPolling();
                  } else {
                    resetCompileState();
                    setBuildStatus("error");
                  }
                })
                .catch(() => {
                  resetCompileState();
                  setBuildStatus("error");
                });
              return; // Keep compiling state — recompile in progress
            }
          }

          if (build.status === "error" || build.status === "timeout") {
            setAutoCompileEnabled(false);
            pendingRecompileRef.current = false;
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = null;
            }
            navigateToFirstError(logsData.errors ?? []);
          }

          if (build.status === "canceled") {
            pendingRecompileRef.current = false;
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = null;
            }
          }

          resetCompileState();
        }
      } catch {
        // Polling error — keep trying
      }
    }, 1500);

    // Hard timeout: if polling finds nothing after 120s, give up
    pollTimeoutRef.current = setTimeout(() => {
      clearAllPolling();
      if (compilingRef.current) {
        setBuildStatus("timeout");
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        resetCompileState();
      }
    }, 120_000);
  // navigateToFirstError is defined later in this module.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clearAllPolling,
    project.id,
    resetCompileState,
    restoreViewPositionsAfterBuild,
    saveViewPositionsBeforeBuild,
    withShareToken,
  ]);

  // ─── Check for stale in-progress build on mount ───
  // If the DB had a queued/compiling build, poll once to see if it's still running.
  useEffect(() => {
    if (!initialBuildMaybeRunning) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withShareToken(`/api/projects/${project.id}/logs`), {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const build = data.build;

        if (cancelled) return;

        if (build.status === "queued" || build.status === "compiling") {
          // Build is actually still running — start tracking it
          compilingRef.current = true;
          setCompiling(true);
          setBuildStatus(build.status);
          setPdfLoading(true);
          startBuildPolling();
        } else if (build.status === "success") {
          setBuildStatus("success");
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(data.errors ?? []);
          setPdfUrl(withShareToken(`/api/projects/${project.id}/pdf?t=${Date.now()}`));
        } else if (build.status === "error" || build.status === "timeout") {
          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(data.errors ?? []);
          setAutoCompileEnabled(false);
        } else if (build.status === "canceled") {
          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors([]);
        }
      } catch {
        // Failed to check — stay at idle
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── WebSocket Integration ────────────────────────

  const {
    sendActiveFile,
    sendCursorMove,
    sendDocChange,
    sendChatMessage,
    sendChatRead,
  } = useWebSocket(project.id, {
    shareToken,
    onSelfIdentity: (identity) => {
      // Update currentUser with WS-assigned identity (for anonymous users)
      if (!currentUser.id || currentUser.id !== identity.userId) {
        const resolved = { id: identity.userId, email: identity.email, name: identity.name };
        setCurrentUser(resolved);
        onIdentityResolved?.(resolved);
      }
    },
    onBuildStatus: (data) => {
      setBuildStatus(data.status);
      setBuildActorName(resolveActorName(data.triggeredByUserId));
      if (!compilingRef.current) {
        compilingRef.current = true;
        setCompiling(true);
      }
      setPdfLoading(true);
    },
    onBuildComplete: (data) => {
      clearAllPolling();

      setBuildStatus(data.status);
      setBuildActorName(resolveActorName(data.triggeredByUserId));
      setBuildLogs(data.logs ?? "");
      setBuildDuration(data.durationMs);
      setBuildErrors((data.errors as LogError[]) ?? []);

      if (data.status === "success") {
        setPdfUrl(withShareToken(`/api/projects/${project.id}/pdf?t=${Date.now()}`));
        restoreViewPositionsAfterBuild();
        setAutoCompileEnabled(true);

        // If file was changed during build, recompile with latest content
        if (pendingRecompileRef.current) {
          pendingRecompileRef.current = false;
          setBuildStatus("queued");
          setPdfLoading(true);
          saveViewPositionsBeforeBuild();
          fetch(withShareToken(`/api/projects/${project.id}/compile`), {
            method: "POST",
          })
            .then((res) => {
              if (res.ok) {
                startBuildPolling();
              } else {
                resetCompileState();
                setBuildStatus("error");
              }
            })
            .catch(() => {
              resetCompileState();
              setBuildStatus("error");
            });
          return; // Keep compiling state — recompile in progress
        }
      }

      if (data.status === "error" || data.status === "timeout") {
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        navigateToFirstError((data.errors as LogError[]) ?? []);
      }

      if (data.status === "canceled") {
        pendingRecompileRef.current = false;
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }

      resetCompileState();
    },
    // Presence events
    onPresenceUsers: (users) => {
      setPresenceUsers(users);
    },
    onPresenceJoined: (user) => {
      setPresenceUsers((prev) => {
        if (prev.find((u) => u.userId === user.userId)) return prev;
        return [...prev, user];
      });
    },
    onPresenceLeft: (userId) => {
      setPresenceUsers((prev) => prev.filter((u) => u.userId !== userId));
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      // Break follow mode if followed user disconnects
      if (followingUserIdRef.current === userId) {
        setFollowingUserId(null);
      }
    },
    onPresenceUpdated: (data) => {
      setPresenceUsers((prev) =>
        prev.map((u) =>
          u.userId === data.userId
            ? { ...u, activeFileId: data.activeFileId, activeFilePath: data.activeFilePath }
            : u
        )
      );
      // Follow mode: switch file if followed user changes file
      if (followingUserIdRef.current === data.userId && data.activeFileId) {
        const file = files.find((f) => f.id === data.activeFileId);
        if (file && data.activeFileId !== activeFileIdRef.current) {
          handleFileSelect(file.id, file.path);
        }
      }
    },
    // Chat events
    onChatMessage: (message) => {
      setChatMessages((prev) => [...prev, message]);
    },
    onChatHistory: (messages) => {
      setChatMessages(messages);
    },
    onChatRead: (receipt: ChatReadReceipt) => {
      setChatReadState((prev) => {
        const next = new Map(prev);
        next.set(receipt.userId, {
          lastReadMessageId: receipt.lastReadMessageId,
          timestamp: receipt.timestamp,
        });
        return next;
      });
    },
    onChatReadState: (reads: ChatReadReceipt[]) => {
      const next = new Map<string, { lastReadMessageId: string; timestamp: number }>();
      for (const read of reads) {
        next.set(read.userId, {
          lastReadMessageId: read.lastReadMessageId,
          timestamp: read.timestamp,
        });
      }
      setChatReadState(next);
    },
    // File events
    onFileCreated: () => {
      refreshFiles();
    },
    onFileDeleted: (data) => {
      refreshFiles();
      if (openFiles.some((f) => f.id === data.fileId)) {
        handleCloseTab(data.fileId);
      }
    },
    onFileSaved: (data) => {
      if (data.fileId !== activeFileIdRef.current) {
        fileContentsRef.current.delete(data.fileId);
      } else {
        fetchFileContent(data.fileId);
      }
    },
    // Collaborative editing
    onDocChanged: (data) => {
      const { userId, fileId, changes } = data;
      if (fileId === activeFileIdRef.current) {
        setRemoteChanges({ fileId, userId, changes });
      }
      applyChangesToCache(fileId, changes);
    },
    onCursorUpdated: (data) => {
      if (data.fileId === activeFileIdRef.current) {
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          const user = presenceUsers.find((u) => u.userId === data.userId);
          next.set(data.userId, {
            color: user?.color || "#888",
            name: user?.name || "Unknown",
            selection: data.selection,
          });
          return next;
        });
      }
      // Follow mode: scroll to followed user's cursor
      if (followingUserIdRef.current === data.userId && data.fileId === activeFileIdRef.current) {
        codeEditorRef.current?.scrollToLine(data.selection.head.line);
      }
    },
    onCursorCleared: (userId) => {
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    },
  });

  // ─── File content loading ─────────────────────────

  useEffect(() => {
    if (!activeFileId) return;

    const cached = fileContentsRef.current.get(activeFileId);
    if (cached !== undefined) {
      setActiveFileContent(cached);
      return;
    }

    fetchFileContent(activeFileId);
  }, [activeFileId, fetchFileContent]);

  // ─── File operations ──────────────────────────────

  const handleFileSelect = useCallback(
    (fileId: string, filePath: string) => {
      if (activeFileId && activeFileContent !== undefined) {
        fileContentsRef.current.set(activeFileId, activeFileContent);
      }

      setRemoteCursors(new Map());
      setActiveFileId(fileId);
      const cached = fileContentsRef.current.get(fileId);
      setActiveFileContent(cached ?? "");

      const alreadyOpen = openFiles.some((f) => f.id === fileId);
      if (!alreadyOpen) {
        setOpenFiles((prev) => [...prev, { id: fileId, path: filePath }]);
      }

      sendActiveFile(fileId, filePath);
    },
    [openFiles, sendActiveFile, activeFileId, activeFileContent]
  );

  const handleCloseTab = useCallback(
    (fileId: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.id !== fileId);
        if (activeFileId === fileId) {
          const newActive = next.length > 0 ? next[next.length - 1] : null;
          setActiveFileId(newActive?.id ?? null);
          if (!newActive) setActiveFileContent("");
        }
        return next;
      });
      setDirtyFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      savedContentRef.current.delete(fileId);
      fileContentsRef.current.delete(fileId);
    },
    [activeFileId]
  );

  // ─── Save & Compile ───────────────────────────────

  const handleSave = useCallback(
    async (content: string, shouldCompile: boolean) => {
      if (!canEdit) return;
      if (!activeFileId) return;

      // Decide whether to actually trigger a compile
      const willCompile = shouldCompile && !compilingRef.current;

      try {
        await fetch(withShareToken(`/api/projects/${project.id}/files/${activeFileId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, autoCompile: willCompile }),
        });

        savedContentRef.current.set(activeFileId, content);
        setDirtyFileIds((prev) => {
          const next = new Set(prev);
          next.delete(activeFileId);
          return next;
        });

      if (willCompile) {
        saveViewPositionsBeforeBuild();
        compilingRef.current = true;
        pendingRecompileRef.current = false;
        setBuildActorName("You");
        setCompiling(true);
        setBuildStatus("queued");
        setPdfLoading(true);
          startBuildPolling();
        } else if (shouldCompile && compilingRef.current) {
          // Wanted to compile but already compiling — recompile after current build
          pendingRecompileRef.current = true;
        }
      } catch {
        // Save failed silently
      }
    },
    [activeFileId, canEdit, project.id, saveViewPositionsBeforeBuild, startBuildPolling, withShareToken]
  );

  const handleEditorChange = useCallback(
    (content: string) => {
      if (!canEdit) return;

      // Break follow mode on local edit
      if (followingUserIdRef.current) {
        setFollowingUserId(null);
      }

      setActiveFileContent(content);

      if (activeFileId) {
        fileContentsRef.current.set(activeFileId, content);

        const savedContent = savedContentRef.current.get(activeFileId);
        if (savedContent !== content) {
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.add(activeFileId);
            return next;
          });
        } else {
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.delete(activeFileId);
            return next;
          });
        }
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      const delay = autoCompileEnabled ? 2000 : 1000;

      saveTimeoutRef.current = setTimeout(() => {
        handleSave(content, autoCompileEnabled);
      }, delay);
    },
    [handleSave, activeFileId, autoCompileEnabled, canEdit]
  );

  const handleImmediateSave = useCallback(() => {
    if (!activeFileId) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    handleSave(activeFileContent, true);
  }, [activeFileId, activeFileContent, handleSave]);

  const handleCompile = useCallback(async () => {
    if (!canEdit) return;
    if (compilingRef.current) return;

    saveViewPositionsBeforeBuild();
    compilingRef.current = true;
    pendingRecompileRef.current = false;
    setBuildActorName("You");
    setCompiling(true);
    setBuildStatus("compiling");
    setPdfLoading(true);

    try {
      const res = await fetch(withShareToken(`/api/projects/${project.id}/compile`), {
        method: "POST",
      });

      if (!res.ok) {
        setBuildStatus("error");
        resetCompileState();
        return;
      }

      startBuildPolling();
    } catch {
      setBuildStatus("error");
      resetCompileState();
    }
  }, [
    canEdit,
    project.id,
    resetCompileState,
    saveViewPositionsBeforeBuild,
    startBuildPolling,
    withShareToken,
  ]);

  const handleCancelBuild = useCallback(async () => {
    if (!canEdit) return;
    if (!(buildStatus === "compiling" || buildStatus === "queued")) return;

    try {
      const res = await fetch(withShareToken(`/api/projects/${project.id}/cancel`), {
        method: "POST",
      });

      if (!res.ok) {
        setBuildStatus("error");
        resetCompileState();
        return;
      }

      setBuildActorName("You");
      setBuildStatus("canceled");
      setBuildLogs("Build canceled by user.");
      setBuildDuration(null);
      setBuildErrors([]);
      pendingRecompileRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      resetCompileState();
    } catch {
      setBuildStatus("error");
      resetCompileState();
    }
  }, [buildStatus, canEdit, project.id, resetCompileState, withShareToken]);

  // ─── Hard safety timeout ──────────────────────────
  // If we're stuck in "compiling" for 3 minutes, force-reset.
  // This prevents the UI from being stuck forever if both WS and polling fail.

  useEffect(() => {
    if (!compiling) return;

    const hardTimeout = setTimeout(() => {
      if (compilingRef.current) {
        console.warn("[Build] Hard timeout — resetting compile state after 3 minutes");
        setBuildStatus("timeout");
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        resetCompileState();
      }
    }, 180_000);

    return () => clearTimeout(hardTimeout);
  }, [compiling, resetCompileState]);

  // ─── Keyboard shortcuts ───────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleCompile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleImmediateSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCompile, handleImmediateSave]);

  // ─── Refresh files ────────────────────────────────

  const refreshFiles = useCallback(async () => {
    try {
      const res = await fetch(withShareToken(`/api/projects/${project.id}/files`), {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
      }
    } catch {
      // Silently fail
    }
  }, [project.id, withShareToken]);

  const isImageFile = useCallback(
    (fileId: string | null): boolean => {
      if (!fileId) return false;
      const file = files.find((f) => f.id === fileId);
      return file?.mimeType?.startsWith("image/") ?? false;
    },
    [files]
  );

  const handlePdfTextSelect = useCallback((text: string) => {
    codeEditorRef.current?.highlightText(text);
  }, []);

  /** Navigate to the first build error's file and line */
  const navigateToFirstError = useCallback(
    (errors: LogError[]) => {
      const firstError = errors.find((e) => e.type === "error" && e.line > 0);
      if (!firstError) return;
      const target = files.find(
        (f) => f.path === firstError.file || f.path.endsWith(firstError.file) || `./${f.path}` === firstError.file
      );
      if (target) {
        // Open the file if not already active
        if (target.id !== activeFileIdRef.current) {
          handleFileSelect(target.id, target.path);
        }
        // Scroll to the error line (delay to allow file content to load)
        setTimeout(() => {
          codeEditorRef.current?.scrollToLine(firstError.line);
        }, 300);
      }
    },
    [files, handleFileSelect]
  );

  // Filter build errors for the currently active file
  const activeFileErrors = (() => {
    if (!activeFileId || buildErrors.length === 0) return [];
    const activeFile = files.find((f) => f.id === activeFileId);
    if (!activeFile) return [];
    return buildErrors.filter(
      (e) => e.type === "error" && (
        activeFile.path === e.file ||
        activeFile.path.endsWith(e.file) ||
        e.file.endsWith(activeFile.path) ||
        `./${activeFile.path}` === e.file
      )
    );
  })();

  const handleErrorClick = useCallback(
    (file: string, line: number) => {
      const target = files.find(
        (f) =>
          f.path === file ||
          f.path.endsWith(file) ||
          `./${f.path}` === file ||
          file.endsWith(f.path)
      );
      if (target) {
        handleFileSelect(target.id, target.path);
        // Scroll to the error line after the file loads
        setTimeout(() => {
          codeEditorRef.current?.scrollToLine(line);
        }, 200);
      }
    },
    [files, handleFileSelect]
  );

  // ─── Follow Mode ─────────────────────────────────

  const handleFollowUser = useCallback(
    (userId: string) => {
      if (followingUserId === userId) {
        setFollowingUserId(null);
        return;
      }
      setFollowingUserId(userId);

      // Jump to the user's current file
      const user = presenceUsers.find((u) => u.userId === userId);
      if (user?.activeFileId && user.activeFileId !== activeFileId) {
        const file = files.find((f) => f.id === user.activeFileId);
        if (file) {
          handleFileSelect(file.id, file.path);
        }
      }

      // Scroll to their cursor if we already have it
      const cursor = remoteCursors.get(userId);
      if (cursor) {
        codeEditorRef.current?.scrollToLine(cursor.selection.head.line);
      }
    },
    [followingUserId, presenceUsers, activeFileId, files, handleFileSelect, remoteCursors]
  );

  // Refresh share state (for header badge + chat visibility/history)
  useEffect(() => {
    refreshShareState();
  }, [refreshShareState]);

  // Auto-open main tex file once files are available
  useEffect(() => {
    if (autoOpenedMainRef.current) return;
    if (activeFileId || openFiles.length > 0) {
      autoOpenedMainRef.current = true;
      return;
    }
    if (files.length === 0) return;

    const mainFile = files.find((f) => f.path === project.mainFile);
    if (mainFile) {
      autoOpenedMainRef.current = true;
      handleFileSelect(mainFile.id, mainFile.path);
      return;
    }

    const fallbackTex = files.find((f) => !f.isDirectory && f.path.endsWith(".tex"));
    if (fallbackTex) {
      autoOpenedMainRef.current = true;
      handleFileSelect(fallbackTex.id, fallbackTex.path);
    }
  }, [activeFileId, files, handleFileSelect, openFiles.length, project.mainFile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllPolling();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [clearAllPolling]);

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary">
      {/* Top header */}
      <EditorHeader
        projectName={project.name}
        projectId={project.id}
        compiling={compiling}
        onCompile={handleCompile}
        autoCompileEnabled={autoCompileEnabled}
        onAutoCompileToggle={() => setAutoCompileEnabled((prev) => !prev)}
        buildStatus={buildStatus}
        onCancelBuild={handleCancelBuild}
        presenceUsers={presenceUsers}
        currentUserId={currentUser.id}
        role={role}
        followingUserId={followingUserId}
        onFollowUser={handleFollowUser}
        isSharedProject={isSharedProject}
        onShareUpdated={refreshShareState}
        shareToken={shareToken}
        canManageShare={!isPublicShare && role === "owner"}
        canEdit={canEdit}
      />

      {/* Main content area */}
      <div className="flex-1 min-h-0 relative">
        <PanelGroup
          direction="vertical"
          className="h-full w-full"
          autoSaveId={`editor-layout-${project.id}-vertical`}
        >
          {/* Editor panels */}
          <Panel defaultSize={80} minSize={40}>
            <PanelGroup
              direction="horizontal"
              className="h-full w-full"
              autoSaveId={`editor-layout-${project.id}-horizontal`}
            >
              {/* File tree */}
              <Panel defaultSize={15} minSize={10} collapsible>
                <FileTree
                  projectId={project.id}
                  files={files}
                  activeFileId={activeFileId}
                  onFileSelect={handleFileSelect}
                  onFilesChanged={refreshFiles}
                  shareToken={shareToken}
                  readOnly={!canEdit}
                />
              </Panel>

              <PanelResizeHandle className="w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/30 data-[resize-handle-active]:bg-accent/30 relative after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-px after:bg-border" />

              {/* Code editor */}
              <Panel defaultSize={45} minSize={20}>
                <div className="flex h-full flex-col bg-bg-primary">
                  <EditorTabs
                    openFiles={openFiles}
                    activeFileId={activeFileId}
                    dirtyFileIds={dirtyFileIds}
                    onSelectTab={(fileId) => {
                      if (activeFileId && activeFileContent !== undefined) {
                        fileContentsRef.current.set(activeFileId, activeFileContent);
                      }
                      setRemoteCursors(new Map());
                      setActiveFileId(fileId);
                    }}
                    onCloseTab={handleCloseTab}
                  />
                  <div className="flex-1 min-h-0">
                    {activeFileId ? (
                      isImageFile(activeFileId) ? (
                        <div className="flex h-full items-center justify-center bg-bg-primary p-4 overflow-auto">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={withShareToken(
                              `/api/projects/${project.id}/files/${activeFileId}?raw`
                            )}
                            alt={openFiles.find((f) => f.id === activeFileId)?.path ?? "Image"}
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                      ) : (
                        <CodeEditor
                          ref={codeEditorRef}
                          content={activeFileContent}
                          onChange={handleEditorChange}
                          language="latex"
                          readOnly={!canEdit}
                          errors={activeFileErrors}
                          onDocChange={(changes) => {
                            if (activeFileId) sendDocChange(activeFileId, changes, Date.now());
                          }}
                          onCursorChange={(selection) => {
                            if (activeFileId) sendCursorMove(activeFileId, selection);
                          }}
                          remoteChanges={remoteChanges}
                          remoteCursors={remoteCursors}
                        />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center animate-fade-in">
                        <div className="flex flex-col items-center gap-3 text-center px-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-elevated">
                            <FileText className="h-6 w-6 text-text-muted" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text-secondary">
                              No file open
                            </p>
                            <p className="mt-1 text-xs text-text-muted">
                              Select a file from the sidebar to start editing
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/30 data-[resize-handle-active]:bg-accent/30 relative after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-px after:bg-border" />

              {/* PDF viewer */}
              <Panel defaultSize={40} minSize={15}>
                <PdfViewer ref={pdfViewerRef} pdfUrl={pdfUrl} loading={pdfLoading} onTextSelect={handlePdfTextSelect} />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="h-2 cursor-row-resize touch-none bg-transparent transition-colors hover:bg-accent/30 data-[resize-handle-active]:bg-accent/30 relative after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:h-px after:bg-border" />

          {/* Build logs */}
          <Panel defaultSize={20} minSize={5} collapsible collapsedSize={4}>
            <BuildLogs
              logs={buildLogs}
              status={buildStatus}
              duration={buildDuration}
              errors={buildErrors}
              actorName={buildActorName}
              onErrorClick={handleErrorClick}
            />
          </Panel>
        </PanelGroup>

        {/* Chat Panel */}
        {isSharedProject && (
          <ChatPanel
            messages={chatMessages}
            onSendMessage={sendChatMessage}
            currentUserId={currentUser.id}
            userColors={userColorMap}
            userNames={userNameMap}
            readState={chatReadState}
            onMarkRead={sendChatRead}
            shareHistoryEntries={shareHistoryEntries}
          />
        )}
      </div>
    </div>
  );
}
