"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { X } from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface OpenFile {
  id: string;
  path: string;
}

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeFileId: string | null;
  dirtyFileIds?: Set<string>;
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
}

// ─── Helpers ────────────────────────────────────────

function getFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

// ─── EditorTabs ─────────────────────────────────────

export function EditorTabs({
  openFiles,
  activeFileId,
  dirtyFileIds,
  onSelectTab,
  onCloseTab,
}: EditorTabsProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, fileId: string) => {
      // Middle-click to close
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(fileId);
      }
    },
    [onCloseTab]
  );

  if (openFiles.length === 0) {
    return (
      <div className="h-9 border-b border-border bg-bg-secondary" />
    );
  }

  return (
    <div className="flex h-9 items-end overflow-x-auto border-b border-border bg-bg-secondary scrollbar-none">
      {openFiles.map((file) => {
        const isActive = file.id === activeFileId;
        const isDirty = dirtyFileIds?.has(file.id) ?? false;
        const filename = getFilename(file.path);

        return (
          <div
            key={file.id}
            onMouseDown={(e) => handleMouseDown(e, file.id)}
            className={cn(
              "group relative flex h-full shrink-0 items-center gap-2 border-r border-border px-3 text-sm transition-colors cursor-pointer select-none",
              isActive
                ? "bg-bg-primary text-text-primary"
                : "bg-bg-secondary text-text-muted hover:text-text-secondary hover:bg-bg-elevated/50"
            )}
          >
            {/* Active indicator */}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}

            {/* Tab label */}
            <button
              type="button"
              onClick={() => onSelectTab(file.id)}
              className="truncate max-w-[120px] text-xs"
              title={file.path}
            >
              {filename}
            </button>

            {/* Dirty indicator or close button */}
            {isDirty ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.id);
                }}
                className={cn(
                  "relative rounded p-0.5 transition-colors",
                  isActive
                    ? "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                    : "text-text-muted group-hover:text-text-muted hover:!text-text-primary hover:bg-bg-elevated"
                )}
              >
                {/* Dirty dot — hidden on hover, close icon shown instead */}
                <span className="block group-hover:hidden">
                  <span className="block h-3 w-3 rounded-full flex items-center justify-center">
                    <span className="block h-2 w-2 rounded-full bg-text-muted" />
                  </span>
                </span>
                <span className="hidden group-hover:block">
                  <X className="h-3 w-3" />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.id);
                }}
                className={cn(
                  "rounded p-0.5 transition-colors",
                  isActive
                    ? "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                    : "text-transparent group-hover:text-text-muted hover:!text-text-primary hover:bg-bg-elevated"
                )}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
