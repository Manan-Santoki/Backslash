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
import { PdfViewer } from "@/components/editor/PdfViewer";
import { BuildLogs } from "@/components/editor/BuildLogs";
import { useWebSocket } from "@/hooks/useWebSocket";
import { FileText } from "lucide-react";

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

interface EditorLayoutProps {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
}

// ─── Editor Layout ──────────────────────────────────

export function EditorLayout({
  project,
  files: initialFiles,
  lastBuild: initialBuild,
}: EditorLayoutProps) {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>("");
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(
    initialBuild?.status === "success"
      ? `/api/projects/${project.id}/pdf?t=${Date.now()}`
      : null
  );
  const [buildStatus, setBuildStatus] = useState(
    initialBuild?.status ?? "idle"
  );
  const [buildLogs, setBuildLogs] = useState(initialBuild?.logs ?? "");
  const [buildDuration, setBuildDuration] = useState<number | null>(
    initialBuild?.durationMs ?? null
  );
  const [buildErrors, setBuildErrors] = useState<LogError[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(true);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());

  const codeEditorRef = useRef<CodeEditorHandle>(null);
  // Track saved content per file to detect dirtiness
  const savedContentRef = useRef<Map<string, string>>(new Map());
  // Track active poll interval so we can clear it
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── WebSocket Integration ────────────────────────

  useWebSocket(project.id, {
    onBuildStatus: (data) => {
      setBuildStatus(data.status);
      setCompiling(true);
      setPdfLoading(true);
    },
    onBuildComplete: (data) => {
      setBuildStatus(data.status);
      setBuildLogs(data.logs ?? "");
      setBuildDuration(data.durationMs);
      setBuildErrors((data.errors as LogError[]) ?? []);
      setCompiling(false);
      // Clear polling since WS handled it
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }

      if (data.status === "success") {
        setPdfUrl(`/api/projects/${project.id}/pdf?t=${Date.now()}`);
      }
      setPdfLoading(false);
    },
  });

  // ─── Polling fallback for build completion ────────

  const startBuildPolling = useCallback(() => {
    // Clear any existing poll
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const logsRes = await fetch(`/api/projects/${project.id}/logs`);
        if (!logsRes.ok) return;

        const logsData = await logsRes.json();
        const build = logsData.build;

        if (
          build.status === "success" ||
          build.status === "error" ||
          build.status === "timeout"
        ) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          // Only update if still compiling (WebSocket may have already handled it)
          setCompiling((prev) => {
            if (prev) {
              setBuildStatus(build.status);
              setBuildLogs(build.logs ?? "");
              setBuildDuration(build.durationMs);
              setBuildErrors(logsData.errors ?? []);
              if (build.status === "success") {
                setPdfUrl(
                  `/api/projects/${project.id}/pdf?t=${Date.now()}`
                );
              }
              setPdfLoading(false);
            }
            return false;
          });
        }
      } catch {
        // Polling error -- keep trying
      }
    }, 1500);

    // Timeout after 120s
    pollTimeoutRef.current = setTimeout(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setCompiling((prev) => {
        if (prev) {
          setBuildStatus("timeout");
          setPdfLoading(false);
        }
        return false;
      });
    }, 120_000);
  }, [project.id]);

  // Fetch file content when active file changes
  useEffect(() => {
    if (!activeFileId) return;

    async function fetchFileContent() {
      try {
        const res = await fetch(
          `/api/projects/${project.id}/files/${activeFileId}`
        );
        if (res.ok) {
          const data = await res.json();
          const content = data.content ?? "";
          setActiveFileContent(content);
          savedContentRef.current.set(activeFileId!, content);
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.delete(activeFileId!);
            return next;
          });
        }
      } catch {
        setActiveFileContent("");
      }
    }

    fetchFileContent();
  }, [activeFileId, project.id]);

  // Open a file in the editor
  const handleFileSelect = useCallback(
    (fileId: string, filePath: string) => {
      setActiveFileId(fileId);

      const alreadyOpen = openFiles.some((f) => f.id === fileId);
      if (!alreadyOpen) {
        setOpenFiles((prev) => [...prev, { id: fileId, path: filePath }]);
      }
    },
    [openFiles]
  );

  // Close a tab
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
    },
    [activeFileId]
  );

  // Save file content (with optional auto-compile)
  const handleSave = useCallback(
    async (content: string, autoCompile: boolean) => {
      if (!activeFileId) return;

      try {
        await fetch(`/api/projects/${project.id}/files/${activeFileId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, autoCompile }),
        });

        savedContentRef.current.set(activeFileId, content);
        setDirtyFileIds((prev) => {
          const next = new Set(prev);
          next.delete(activeFileId);
          return next;
        });

        if (autoCompile) {
          setCompiling(true);
          setBuildStatus("queued");
          setPdfLoading(true);
          // Start polling as fallback in case WS doesn't deliver
          startBuildPolling();
        }
      } catch {
        // Save failed silently
      }
    },
    [activeFileId, project.id, startBuildPolling]
  );

  // Debounced save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEditorChange = useCallback(
    (content: string) => {
      setActiveFileContent(content);

      if (activeFileId) {
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
    [handleSave, activeFileId, autoCompileEnabled]
  );

  // Immediate save (for Ctrl+S) — always compiles
  const handleImmediateSave = useCallback(() => {
    if (!activeFileId) return;
    // Cancel pending debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    handleSave(activeFileContent, true);
  }, [activeFileId, activeFileContent, handleSave]);

  // Compile project (manual)
  const handleCompile = useCallback(async () => {
    if (compiling) return;
    setCompiling(true);
    setBuildStatus("compiling");
    setPdfLoading(true);

    try {
      const res = await fetch(`/api/projects/${project.id}/compile`, {
        method: "POST",
      });

      if (!res.ok) {
        setBuildStatus("error");
        setCompiling(false);
        setPdfLoading(false);
        return;
      }

      // WebSocket handles real-time updates, polling is fallback
      startBuildPolling();
    } catch {
      setBuildStatus("error");
      setCompiling(false);
      setPdfLoading(false);
    }
  }, [compiling, project.id, startBuildPolling]);

  // Keyboard shortcuts: Ctrl+Enter (compile), Ctrl+S (save)
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

  // Refresh file list
  const refreshFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
      }
    } catch {
      // Silently fail
    }
  }, [project.id]);

  // PDF text selection → highlight in editor
  const handlePdfTextSelect = useCallback((text: string) => {
    codeEditorRef.current?.highlightText(text);
  }, []);

  // Handle error click in build logs
  const handleErrorClick = useCallback(
    (file: string, line: number) => {
      const target = files.find(
        (f) => f.path === file || f.path.endsWith(file)
      );
      if (target) {
        handleFileSelect(target.id, target.path);
      }
    },
    [files, handleFileSelect]
  );

  // Auto-open main tex file on mount
  useEffect(() => {
    if (project.mainFile && files.length > 0 && openFiles.length === 0) {
      const mainFile = files.find((f) => f.path === project.mainFile);
      if (mainFile) {
        handleFileSelect(mainFile.id, mainFile.path);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

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
      />

      {/* Main content area */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="vertical">
          {/* Editor panels */}
          <Panel defaultSize={80} minSize={40}>
            <PanelGroup direction="horizontal">
              {/* File tree */}
              <Panel defaultSize={15} minSize={10} collapsible>
                <FileTree
                  projectId={project.id}
                  files={files}
                  activeFileId={activeFileId}
                  onFileSelect={handleFileSelect}
                  onFilesChanged={refreshFiles}
                />
              </Panel>

              <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors data-[resize-handle-active]:bg-accent" />

              {/* Code editor */}
              <Panel defaultSize={45} minSize={20}>
                <div className="flex h-full flex-col bg-bg-primary">
                  <EditorTabs
                    openFiles={openFiles}
                    activeFileId={activeFileId}
                    dirtyFileIds={dirtyFileIds}
                    onSelectTab={setActiveFileId}
                    onCloseTab={handleCloseTab}
                  />
                  <div className="flex-1 min-h-0">
                    {activeFileId ? (
                      <CodeEditor
                        ref={codeEditorRef}
                        content={activeFileContent}
                        onChange={handleEditorChange}
                        language="latex"
                      />
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

              <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors data-[resize-handle-active]:bg-accent" />

              {/* PDF viewer */}
              <Panel defaultSize={40} minSize={15}>
                <PdfViewer pdfUrl={pdfUrl} loading={pdfLoading} onTextSelect={handlePdfTextSelect} />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors data-[resize-handle-active]:bg-accent" />

          {/* Build logs */}
          <Panel defaultSize={20} minSize={5} collapsible collapsedSize={4}>
            <BuildLogs
              logs={buildLogs}
              status={buildStatus}
              duration={buildDuration}
              errors={buildErrors}
              onErrorClick={handleErrorClick}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
