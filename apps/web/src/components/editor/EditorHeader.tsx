"use client";

import { cn } from "@/lib/utils/cn";
import {
  Play,
  Download,
  FileArchive,
  Loader2,
  Zap,
  ZapOff,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { AppHeader } from "@/components/AppHeader";

// ─── Types ──────────────────────────────────────────

interface EditorHeaderProps {
  projectName: string;
  projectId: string;
  compiling: boolean;
  onCompile: () => void;
  autoCompileEnabled: boolean;
  onAutoCompileToggle: () => void;
  buildStatus: string;
}

// ─── Build Status Badge ────────────────────────────

function BuildStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Built</span>
        </div>
      );
    case "error":
    case "timeout":
      return (
        <div className="flex items-center gap-1.5 text-xs text-error">
          <XCircle className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Failed</span>
        </div>
      );
    case "compiling":
    case "queued":
      return (
        <div className="flex items-center gap-1.5 text-xs text-warning">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden md:inline">Building</span>
        </div>
      );
    default:
      return null;
  }
}

// ─── EditorHeader ──────────────────────────────────

export function EditorHeader({
  projectName,
  projectId,
  compiling,
  onCompile,
  autoCompileEnabled,
  onAutoCompileToggle,
  buildStatus,
}: EditorHeaderProps) {
  function handleDownloadPdf() {
    window.open(`/api/projects/${projectId}/pdf?download=true`, "_blank");
  }

  function handleDownloadZip() {
    window.open(`/api/projects/${projectId}/download`, "_blank");
  }

  return (
    <AppHeader>
      {/* Compilation progress bar */}
      {(buildStatus === "compiling" || buildStatus === "queued") && (
        <div className="absolute top-0 left-0 right-0 overflow-hidden">
          <div className="compilation-progress w-full" />
        </div>
      )}

      {/* Project name */}
      <div className="h-4 w-px bg-border shrink-0" />
      <span className="text-sm font-medium text-text-primary truncate max-w-[180px]">
        {projectName}
      </span>

      <div className="h-4 w-px bg-border shrink-0" />

      {/* Compile button */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCompile}
              disabled={compiling}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium transition-colors",
                compiling
                  ? "bg-accent/50 text-bg-primary cursor-not-allowed"
                  : "bg-accent text-bg-primary hover:bg-accent-hover"
              )}
            >
              {compiling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {compiling ? "Compiling" : "Compile"}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Compile project (Ctrl+Enter)</p>
          </TooltipContent>
        </Tooltip>

        {/* Auto-compile toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onAutoCompileToggle}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                autoCompileEnabled
                  ? "text-accent bg-accent/10 hover:bg-accent/20"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"
              )}
            >
              {autoCompileEnabled ? (
                <Zap className="h-4 w-4" />
              ) : (
                <ZapOff className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Auto-compile {autoCompileEnabled ? "on" : "off"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <BuildStatusBadge status={buildStatus} />

      <div className="h-4 w-px bg-border shrink-0" />

      {/* Download buttons */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary hover:bg-bg-elevated"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden md:inline">PDF</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Download PDF</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleDownloadZip}
              className="flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary hover:bg-bg-elevated"
            >
              <FileArchive className="h-3.5 w-3.5" />
              <span className="hidden md:inline">ZIP</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Download source ZIP</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </AppHeader>
  );
}
