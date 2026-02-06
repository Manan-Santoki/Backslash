"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import {
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Upload,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

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

interface TreeNode {
  name: string;
  path: string;
  file: ProjectFile | null;
  isDirectory: boolean;
  children: TreeNode[];
}

interface FileTreeProps {
  projectId: string;
  files: ProjectFile[];
  activeFileId: string | null;
  onFileSelect: (fileId: string, filePath: string) => void;
  onFilesChanged: () => void;
}

// ─── Build tree structure from flat file list ───────

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Sort directories first, then alphabetically
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existingNode = current.find((n) => n.name === part);

      if (existingNode) {
        if (isLast) {
          existingNode.file = file;
          existingNode.isDirectory = !!file.isDirectory;
        }
        current = existingNode.children;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          file: isLast ? file : null,
          isDirectory: isLast ? !!file.isDirectory : true,
          children: [],
        };
        current.push(newNode);
        current = newNode.children;
      }
    }
  }

  return root;
}

function getParentPath(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

// ─── Context Menu ───────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  onDelete: () => void;
  onRename: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, onDelete, onRename, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-bg-secondary py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        onClick={onRename}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
      >
        <Pencil className="h-4 w-4" />
        Rename
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-error transition-colors hover:bg-bg-elevated"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
    </div>
  );
}

// ─── Tree Node Item ─────────────────────────────────

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  activeFileId: string | null;
  renamingFileId: string | null;
  onFileSelect: (fileId: string, filePath: string) => void;
  onDeleteFile: (fileId: string) => void;
  onContextMenu: (e: React.MouseEvent, fileId: string) => void;
  onRenameSubmit: (fileId: string, oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
}

function TreeNodeItem({
  node,
  depth,
  activeFileId,
  renamingFileId,
  onFileSelect,
  onDeleteFile,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
}: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isActive = node.file?.id === activeFileId;
  const isRenaming = node.file?.id === renamingFileId;

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          // Select the name without extension for files
          if (!node.isDirectory) {
            const dotIdx = node.name.lastIndexOf(".");
            if (dotIdx > 0) {
              renameInputRef.current.setSelectionRange(0, dotIdx);
            } else {
              renameInputRef.current.select();
            }
          } else {
            renameInputRef.current.select();
          }
        }
      }, 0);
    }
  }, [isRenaming, node.name, node.isDirectory]);

  function handleClick() {
    if (isRenaming) return;
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else if (node.file) {
      onFileSelect(node.file.id, node.file.path);
    }
  }

  function handleRightClick(e: React.MouseEvent) {
    e.preventDefault();
    if (node.file) {
      onContextMenu(e, node.file.id);
    }
  }

  function handleRenameSubmit() {
    if (!node.file) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === node.name) {
      onRenameCancel();
      return;
    }
    onRenameSubmit(node.file.id, node.file.path, trimmed);
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleRightClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
          isActive
            ? "bg-accent/15 text-accent"
            : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            )}
            {expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-accent" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <File className="h-4 w-4 shrink-0 text-text-muted" />
          </>
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleRenameSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 rounded border border-accent bg-bg-tertiary px-1 py-0 text-sm text-text-primary outline-none"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </button>

      {node.isDirectory && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFileId={activeFileId}
              renamingFileId={renamingFileId}
              onFileSelect={onFileSelect}
              onDeleteFile={onDeleteFile}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          ))}
          {node.children.length === 0 && (
            <div
              className="px-2 py-1 text-xs text-text-muted italic"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── File Tree ──────────────────────────────────────

export function FileTree({
  projectId,
  files,
  activeFileId,
  onFileSelect,
  onFilesChanged,
}: FileTreeProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    fileId: string;
  } | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creating]);

  const tree = buildTree(files);

  // ─── Rename API call ──────────────────────────────

  const handleMove = useCallback(
    async (fileId: string, newPath: string) => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/files/${fileId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newPath }),
          }
        );
        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      }
    },
    [projectId, onFilesChanged]
  );

  // ─── File upload via drag-and-drop from OS ────────

  const uploadFiles = useCallback(
    async (droppedFiles: FileList) => {
      if (droppedFiles.length === 0) return;
      setUploading(true);

      try {
        const formData = new FormData();

        for (let i = 0; i < droppedFiles.length; i++) {
          const file = droppedFiles[i];
          formData.append("files", file);
          // Use webkitRelativePath if available (folder upload), otherwise just filename
          const filePath =
            (file as any).webkitRelativePath || file.name;
          formData.append("paths", filePath);
        }

        const res = await fetch(
          `/api/projects/${projectId}/files/upload`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      } finally {
        setUploading(false);
      }
    },
    [projectId, onFilesChanged]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles]
  );

  // ─── Rename handlers ─────────────────────────────

  const handleRenameSubmit = useCallback(
    (fileId: string, oldPath: string, newName: string) => {
      setRenamingFileId(null);
      if (!newName) return;

      const parent = getParentPath(oldPath);
      const newPath = parent ? parent + "/" + newName : newName;

      if (newPath !== oldPath) {
        handleMove(fileId, newPath);
      }
    },
    [handleMove]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingFileId(null);
  }, []);

  // ─── Create file / folder ────────────────────────

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim() || !creating) return;

      try {
        const res = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: newName.trim(),
            content: creating === "file" ? "" : undefined,
            isDirectory: creating === "folder",
          }),
        });

        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      } finally {
        setCreating(null);
        setNewName("");
      }
    },
    [creating, newName, projectId, onFilesChanged]
  );

  // ─── Delete file ─────────────────────────────────

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      const confirmed = window.confirm(
        "Are you sure you want to delete this file?"
      );
      if (!confirmed) return;

      try {
        const res = await fetch(
          `/api/projects/${projectId}/files/${fileId}`,
          { method: "DELETE" }
        );

        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      }
    },
    [projectId, onFilesChanged]
  );

  // ─── Context menu handlers ───────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, fileId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, fileId });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-bg-secondary transition-colors",
        isDraggingOver && "ring-2 ring-inset ring-accent/50 bg-accent/5"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setCreating("file");
              setNewName("");
            }}
            title="New File"
            className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating("folder");
              setNewName("");
            }}
            title="New Folder"
            className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* New file/folder input */}
      {creating && (
        <form onSubmit={handleCreate} className="border-b border-border px-2 py-2">
          <div className="flex items-center gap-1.5">
            {creating === "folder" ? (
              <Folder className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <File className="h-4 w-4 shrink-0 text-text-muted" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) setCreating(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(null);
                  setNewName("");
                }
              }}
              placeholder={
                creating === "folder" ? "folder-name" : "filename.tex"
              }
              className="w-full rounded border border-accent bg-bg-tertiary px-1.5 py-0.5 text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        </form>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-accent">
          <Upload className="h-3.5 w-3.5 animate-pulse" />
          Uploading...
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* Drop overlay */}
        {isDraggingOver && (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-accent/40 px-4 py-6 text-center mb-1">
            <Upload className="h-6 w-6 text-accent mb-1.5" />
            <p className="text-xs font-medium text-accent">
              Drop files here to upload
            </p>
          </div>
        )}

        {tree.length === 0 && !creating && !isDraggingOver && (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <File className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No files yet</p>
            <p className="text-xs text-text-muted mt-1">
              Drag files here or use the buttons above
            </p>
          </div>
        )}

        {tree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            activeFileId={activeFileId}
            renamingFileId={renamingFileId}
            onFileSelect={onFileSelect}
            onDeleteFile={handleDeleteFile}
            onContextMenu={handleContextMenu}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => {
            handleDeleteFile(contextMenu.fileId);
            closeContextMenu();
          }}
          onRename={() => {
            setRenamingFileId(contextMenu.fileId);
            closeContextMenu();
          }}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
