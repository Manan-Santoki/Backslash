"use client";

import { useState, useCallback, useRef } from "react";
import type { BuildStatus, ParsedLogEntry } from "@backslash/shared";

interface CompileResult {
  status: BuildStatus;
  logs: string;
  errors: ParsedLogEntry[];
  durationMs: number | null;
  pdfUrl: string | null;
}

export function useCompiler(projectId: string | null) {
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollBuildStatus = useCallback(
    async (pid: string) => {
      try {
        const res = await fetch(`/api/projects/${pid}/logs`);
        if (!res.ok) return;
        const data = await res.json();
        const build = data.build;

        if (
          build.status === "success" ||
          build.status === "error" ||
          build.status === "timeout" ||
          build.status === "canceled"
        ) {
          stopPolling();
          setCompiling(false);

          const compileResult: CompileResult = {
            status: build.status,
            logs: build.logs || "",
            errors: data.errors || [],
            durationMs: build.durationMs,
            pdfUrl:
              build.status === "success"
                ? `/api/projects/${pid}/pdf?t=${Date.now()}`
                : null,
          };
          setResult(compileResult);
          return compileResult;
        }
      } catch {
        // Continue polling
      }
      return null;
    },
    [stopPolling]
  );

  const compile = useCallback(
    async (engine?: string): Promise<CompileResult | null> => {
      if (!projectId || compiling) return null;

      setCompiling(true);
      setResult(null);
      stopPolling();

      try {
        const res = await fetch(`/api/projects/${projectId}/compile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(engine ? { engine } : {}),
        });

        if (!res.ok) {
          setCompiling(false);
          const err = await res.json().catch(() => ({ error: "Compilation failed" }));
          setResult({
            status: "error",
            logs: err.error || "Failed to start compilation",
            errors: [],
            durationMs: null,
            pdfUrl: null,
          });
          return null;
        }

        // Start polling for build completion
        pollRef.current = setInterval(() => {
          pollBuildStatus(projectId);
        }, 1500);

        // Also do an immediate check after a short delay
        setTimeout(() => pollBuildStatus(projectId), 500);

        return null;
      } catch {
        setCompiling(false);
        return null;
      }
    },
    [projectId, compiling, stopPolling, pollBuildStatus]
  );

  return { compile, compiling, result, stopPolling };
}
