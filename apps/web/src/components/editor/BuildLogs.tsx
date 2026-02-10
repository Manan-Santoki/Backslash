"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Ban,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface LogError {
  type: string;
  file: string;
  line: number;
  message: string;
}

interface BuildLogsProps {
  logs: string;
  status: string;
  duration: number | null;
  errors: LogError[];
  actorName?: string | null;
  onErrorClick?: (file: string, line: number) => void;
}

// ─── Helpers ────────────────────────────────────────

function getStatusIcon(status: string) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "error":
    case "timeout":
      return <XCircle className="h-4 w-4 text-error" />;
    case "canceled":
      return <Ban className="h-4 w-4 text-text-muted" />;
    case "compiling":
    case "queued":
      return <Loader2 className="h-4 w-4 animate-spin text-warning" />;
    default:
      return <div className="h-4 w-4 rounded-full border-2 border-text-muted" />;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "success":
      return "Build succeeded";
    case "error":
      return "Build failed";
    case "timeout":
      return "Build timed out";
    case "canceled":
      return "Build canceled";
    case "compiling":
      return "Compiling...";
    case "queued":
      return "Queued";
    default:
      return "No builds";
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── BuildLogs ──────────────────────────────────────

export function BuildLogs({
  logs,
  status,
  duration,
  errors,
  actorName = null,
  onErrorClick,
}: BuildLogsProps) {
  const [expanded, setExpanded] = useState(false);

  const errorCount = errors.filter(
    (e) => e.type === "error" || e.type === "fatal"
  ).length;
  const warningCount = errors.filter((e) => e.type === "warning").length;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* Status bar -- always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between border-b border-border px-4 py-1.5 transition-colors hover:bg-bg-elevated/50"
      >
        <div className="flex items-center gap-3">
          {getStatusIcon(status)}
          <span className="text-xs font-medium text-text-secondary">
            {getStatusLabel(status)}
          </span>
          {actorName && (status === "queued" || status === "compiling") && (
            <span className="text-xs text-text-muted">by {actorName}</span>
          )}

          {duration !== null && (
            <span className="text-xs text-text-muted">
              {formatDuration(duration)}
            </span>
          )}

          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-error">
              <XCircle className="h-3 w-3" />
              {errorCount} {errorCount === 1 ? "error" : "errors"}
            </span>
          )}

          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" />
              {warningCount} {warningCount === 1 ? "warning" : "warnings"}
            </span>
          )}
        </div>

        <div className="flex items-center text-text-muted">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="flex-1 min-h-0 overflow-auto">
          {/* Error/warning entries */}
          {errors.length > 0 && (
            <div className="border-b border-border">
              {errors.map((error, index) => {
                const isError =
                  error.type === "error" || error.type === "fatal";
                const isWarning = error.type === "warning";

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() =>
                      onErrorClick?.(error.file, error.line)
                    }
                    className={cn(
                      "flex w-full items-start gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-bg-elevated/50",
                      isError && "bg-error/5",
                      isWarning && "bg-warning/5"
                    )}
                  >
                    {isError ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-error" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-medium",
                            isError ? "text-error" : "text-warning"
                          )}
                        >
                          {error.type}
                        </span>
                        {error.file && (
                          <span className="text-text-muted">
                            {error.file}
                            {error.line > 0 ? `:${error.line}` : ""}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-text-secondary break-all">
                        {error.message}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Raw log output */}
          {logs && (
            <pre className="whitespace-pre-wrap break-all p-4 font-mono text-xs text-text-muted leading-relaxed">
              {logs}
            </pre>
          )}

          {/* Empty state */}
          {!logs && errors.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-text-muted">
                No build logs available. Compile the project to see output.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
