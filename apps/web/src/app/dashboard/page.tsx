"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import {
  Plus,
  FileText,
  Clock,
  Trash2,
  MoreVertical,
  X,
  Loader2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  lastBuildStatus: string | null;
  sharedWithCount: number;
  anyoneShared: boolean;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SharedProject {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
  ownerName: string;
  ownerEmail: string;
  role: "viewer" | "editor";
  lastBuildStatus: string | null;
}

type Template = "blank" | "article" | "thesis" | "beamer" | "letter";

// ─── Helpers ────────────────────────────────────────

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function buildStatusColor(status: string | null): string {
  switch (status) {
    case "success":
      return "bg-success";
    case "error":
      return "bg-error";
    case "canceled":
      return "bg-text-muted";
    case "compiling":
    case "queued":
      return "bg-warning";
    default:
      return "bg-text-muted";
  }
}

function buildStatusLabel(status: string | null): string {
  switch (status) {
    case "success":
      return "Built successfully";
    case "error":
      return "Build failed";
    case "canceled":
      return "Build canceled";
    case "compiling":
      return "Compiling";
    case "queued":
      return "Queued";
    default:
      return "No builds";
  }
}

// ─── Skeleton Card ──────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="h-5 w-40 rounded bg-bg-elevated" />
        <div className="h-5 w-5 rounded bg-bg-elevated" />
      </div>
      <div className="mt-3 h-4 w-full rounded bg-bg-elevated" />
      <div className="mt-1 h-4 w-3/4 rounded bg-bg-elevated" />
      <div className="mt-4 flex items-center gap-4">
        <div className="h-5 w-16 rounded-full bg-bg-elevated" />
        <div className="h-4 w-20 rounded bg-bg-elevated" />
        <div className="h-4 w-24 rounded bg-bg-elevated" />
      </div>
    </div>
  );
}

// ─── New Project Dialog ─────────────────────────────

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function NewProjectDialog({ open, onClose, onCreated }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<Template>("blank");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setName("");
    setDescription("");
    setTemplate("blank");
    setError("");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setCreating(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, template }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project");
        return;
      }

      resetForm();
      onCreated();
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">
            New Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="project-name"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="My LaTeX Document"
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="project-description"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Description
              <span className="ml-1 text-text-muted font-normal">
                (optional)
              </span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your project"
              rows={3}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {/* Template */}
          <div>
            <label
              htmlFor="project-template"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Template
            </label>
            <select
              id="project-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value as Template)}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <option value="blank">Blank</option>
              <option value="article">Article</option>
              <option value="thesis">Thesis</option>
              <option value="beamer">Beamer (Presentation)</option>
              <option value="letter">Letter</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create Project"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ─────────────────────

interface DeleteDialogProps {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

function DeleteDialog({
  open,
  projectName,
  onClose,
  onConfirm,
  deleting,
}: DeleteDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-text-primary">
          Delete Project
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Are you sure you want to delete{" "}
          <span className="font-medium text-text-primary">{projectName}</span>?
          This action cannot be undone.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </span>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Project Card Menu ──────────────────────────────

interface CardMenuProps {
  onDelete: () => void;
}

function CardMenu({ onDelete }: CardMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border bg-bg-secondary py-1 shadow-lg">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-error transition-colors hover:bg-bg-elevated"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Dashboard Page ─────────────────────────────────

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setSharedProjects(data.sharedProjects ?? []);
      }
    } catch {
      // Silently fail -- user sees empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      fetchProjects();
    }, 10_000);

    return () => clearInterval(interval);
  }, [fetchProjects]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      }
    } catch {
      // Silently fail
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">My Projects</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage your LaTeX documents
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewDialog(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-secondary/50 px-6 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated">
            <FileText className="h-7 w-7 text-text-muted" />
          </div>
          <h3 className="mt-4 text-lg font-medium text-text-primary">
            No projects yet
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Create your first project to get started.
          </p>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>
      )}

      {/* Project Grid */}
      {!loading && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}`}
              className="group rounded-lg border border-border bg-bg-secondary p-5 transition-colors hover:bg-bg-elevated/50 hover:border-accent/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-accent">
                    {project.name}
                  </h3>
                </div>
                <CardMenu onDelete={() => setDeleteTarget(project)} />
              </div>

              {project.description && (
                <p className="mt-2 line-clamp-2 text-sm text-text-secondary">
                  {project.description}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {/* Engine badge */}
                <span className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                  {project.engine}
                </span>

                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                    project.isShared
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-border bg-bg-elevated text-text-muted"
                  )}
                >
                  {project.anyoneShared
                    ? "Shared: Anyone"
                    : project.sharedWithCount > 0
                      ? `Shared: ${project.sharedWithCount}`
                      : "Private"}
                </span>

                {/* Build status */}
                <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      buildStatusColor(project.lastBuildStatus)
                    )}
                    title={buildStatusLabel(project.lastBuildStatus)}
                  />
                  {buildStatusLabel(project.lastBuildStatus)}
                </span>

                {/* Updated date */}
                <span className="inline-flex items-center gap-1 text-xs text-text-muted ml-auto">
                  <Clock className="h-3 w-3" />
                  {formatRelativeDate(project.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Shared with me section */}
      {!loading && sharedProjects.length > 0 && (
        <div className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-text-primary">
              Shared with me
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Projects others have shared with you
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/editor/${project.id}`}
                className="group rounded-lg border border-border bg-bg-secondary p-5 transition-colors hover:bg-bg-elevated/50 hover:border-accent/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-accent" />
                    <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-accent">
                      {project.name}
                    </h3>
                  </div>
                  <span className="shrink-0 inline-flex items-center rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border">
                    {project.role === "editor" ? "Editor" : "Viewer"}
                  </span>
                </div>

                {project.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-text-secondary">
                    {project.description}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {/* Engine badge */}
                  <span className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                    {project.engine}
                  </span>

                  {/* Owner info */}
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    by {project.ownerName}
                  </span>

                  {/* Build status */}
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        buildStatusColor(project.lastBuildStatus)
                      )}
                      title={buildStatusLabel(project.lastBuildStatus)}
                    />
                    {buildStatusLabel(project.lastBuildStatus)}
                  </span>

                  {/* Updated date */}
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted ml-auto">
                    <Clock className="h-3 w-3" />
                    {formatRelativeDate(project.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <NewProjectDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={fetchProjects}
      />

      <DeleteDialog
        open={deleteTarget !== null}
        projectName={deleteTarget?.name ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </>
  );
}
