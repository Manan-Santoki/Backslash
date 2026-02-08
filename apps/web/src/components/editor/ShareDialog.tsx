"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import {
  X,
  UserPlus,
  Loader2,
  Trash2,
  Crown,
  Eye,
  Pencil,
  Link2,
  Users,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface Collaborator {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "viewer" | "editor";
  createdAt: string;
}

interface Owner {
  userId: string;
  email: string;
  name: string;
}

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
}

// ─── ShareDialog ────────────────────────────────────

export function ShareDialog({
  projectId,
  projectName,
  open,
  onClose,
  isOwner,
}: ShareDialogProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/collaborators`);
      if (res.ok) {
        const data = await res.json();
        setCollaborators(data.collaborators);
        setOwner(data.owner);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      fetchCollaborators();
      setError("");
      setSuccess("");
      setEmail("");
    }
  }, [open, fetchCollaborators]);

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setInviting(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to invite collaborator");
        return;
      }

      setSuccess(
        data.updated
          ? `Updated ${data.collaborator.name}'s role to ${role}`
          : `Invited ${data.collaborator.name} as ${role}`
      );
      setEmail("");
      fetchCollaborators();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(shareId: string) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/collaborators/${shareId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setCollaborators((prev) => prev.filter((c) => c.id !== shareId));
      }
    } catch {
      // Silently fail
    }
  }

  async function handleRoleChange(shareId: string, newRole: "viewer" | "editor") {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/collaborators/${shareId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );
      if (res.ok) {
        setCollaborators((prev) =>
          prev.map((c) => (c.id === shareId ? { ...c, role: newRole } : c))
        );
      }
    } catch {
      // Silently fail
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
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              Share Project
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          Manage who has access to{" "}
          <span className="font-medium text-text-primary">{projectName}</span>
        </p>

        {/* Invite form (owner only) */}
        {isOwner && (
          <form onSubmit={handleInvite} className="mb-5">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                required
                className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
                className="rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !email.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {inviting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Invite</span>
              </button>
            </div>

            {error && (
              <p className="mt-2 text-xs text-error">{error}</p>
            )}
            {success && (
              <p className="mt-2 text-xs text-success">{success}</p>
            )}
          </form>
        )}

        {/* Collaborators list */}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {/* Owner */}
          {owner && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-bg-secondary/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent text-sm font-semibold shrink-0">
                {owner.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {owner.name}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {owner.email}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-accent font-medium">
                <Crown className="h-3.5 w-3.5" />
                Owner
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && collaborators.length === 0 && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          )}

          {/* Collaborators */}
          {collaborators.map((collab) => (
            <div
              key={collab.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-bg-elevated/50 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-elevated text-text-secondary text-sm font-semibold shrink-0">
                {collab.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {collab.name}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {collab.email}
                </p>
              </div>

              {isOwner ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={collab.role}
                    onChange={(e) =>
                      handleRoleChange(
                        collab.id,
                        e.target.value as "viewer" | "editor"
                      )
                    }
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary outline-none focus:border-accent"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemove(collab.id)}
                    className="rounded-md p-1 text-text-muted transition-colors hover:text-error hover:bg-error/10"
                    title="Remove collaborator"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  {collab.role === "editor" ? (
                    <>
                      <Pencil className="h-3 w-3" />
                      Editor
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      Viewer
                    </>
                  )}
                </span>
              )}
            </div>
          ))}

          {/* Empty state */}
          {!loading && collaborators.length === 0 && (
            <div className="text-center py-6">
              <p className="text-sm text-text-muted">
                No collaborators yet.{" "}
                {isOwner && "Invite someone by email above."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
