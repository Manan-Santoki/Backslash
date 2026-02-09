"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  X,
  UserPlus,
  Loader2,
  Trash2,
  Crown,
  Eye,
  Pencil,
  Users,
  Globe,
  Clock3,
} from "lucide-react";

type ShareRole = "viewer" | "editor";
type ExpiryOption = "30m" | "7d" | "never";

interface Collaborator {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: ShareRole;
  createdAt: string;
  expiresAt: string | null;
}

interface Owner {
  userId: string;
  email: string;
  name: string;
}

interface PublicShare {
  enabled: boolean;
  role: ShareRole;
  expiresAt: string | null;
  token: string | null;
  url: string | null;
}

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
  onChanged?: () => void;
}

function mapExpiryToOption(expiresAt: string | null): ExpiryOption {
  if (!expiresAt) return "never";
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "never";
  if (diffMs <= 35 * 60 * 1000) return "30m";
  if (diffMs <= 8 * 24 * 60 * 60 * 1000) return "7d";
  return "never";
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  return `Expires ${new Date(expiresAt).toLocaleString()}`;
}

export function ShareDialog({
  projectId,
  projectName,
  open,
  onClose,
  isOwner,
  onChanged,
}: ShareDialogProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [inviteExpiry, setInviteExpiry] = useState<ExpiryOption>("never");
  const [inviting, setInviting] = useState(false);

  const [publicEnabled, setPublicEnabled] = useState(false);
  const [publicRole, setPublicRole] = useState<ShareRole>("viewer");
  const [publicExpiry, setPublicExpiry] = useState<ExpiryOption>("never");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [updatingPublic, setUpdatingPublic] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    try {
      const [collabRes, publicRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/collaborators`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/share-link`, { cache: "no-store" }),
      ]);

      if (collabRes.ok) {
        const data = await collabRes.json();
        setCollaborators(data.collaborators ?? []);
        setOwner(data.owner ?? null);
      }

      if (publicRes.ok) {
        const data = await publicRes.json();
        const share = (data.share ?? {
          enabled: false,
          role: "viewer",
          expiresAt: null,
          token: null,
          url: null,
        }) as PublicShare;
        setPublicEnabled(share.enabled);
        setPublicRole(share.role);
        setPublicExpiry(mapExpiryToOption(share.expiresAt));
        setPublicUrl(share.url ?? null);
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
        body: JSON.stringify({
          email: email.trim(),
          role,
          expiresIn: inviteExpiry,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to invite collaborator");
        return;
      }

      setSuccess(
        data.updated
          ? `Updated ${data.collaborator.name}'s access`
          : `Shared with ${data.collaborator.email}`
      );
      setEmail("");
      await fetchCollaborators();
      onChanged?.();
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
        onChanged?.();
      }
    } catch {
      // Silently fail
    }
  }

  async function handleRoleChange(shareId: string, newRole: ShareRole) {
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
        onChanged?.();
      }
    } catch {
      // Silently fail
    }
  }

  async function handlePublicShareSave() {
    setError("");
    setSuccess("");
    setUpdatingPublic(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/share-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: publicEnabled,
          role: publicRole,
          expiresIn: publicExpiry,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to update link sharing");
        return;
      }

      setSuccess(
        publicEnabled
          ? "Anyone-share settings updated"
          : "Anyone-share disabled"
      );
      if (data.share?.url) {
        setPublicUrl(data.share.url);
      } else if (!publicEnabled) {
        setPublicUrl(null);
      }
      await fetchCollaborators();
      onChanged?.();
    } catch {
      setError("Failed to update link sharing");
    } finally {
      setUpdatingPublic(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-2xl rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">Share Project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-text-secondary">
          Manage access for{" "}
          <span className="font-medium text-text-primary">{projectName}</span>
        </p>

        {isOwner && (
          <>
            <form onSubmit={handleInvite} className="mb-4 rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Share by email
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email address"
                  required
                  className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as ShareRole)}
                  className="rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <select
                  value={inviteExpiry}
                  onChange={(e) => setInviteExpiry(e.target.value as ExpiryOption)}
                  className="rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                >
                  <option value="30m">30 min</option>
                  <option value="7d">7 days</option>
                  <option value="never">No expiry</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting || !email.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  <span>Share</span>
                </button>
              </div>
            </form>

            <div className="mb-5 rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Globe className="h-4 w-4 text-accent" />
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Anyone access
                </p>
              </div>

              <label className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={publicEnabled}
                  onChange={(e) => setPublicEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-bg-secondary text-accent focus:ring-accent"
                />
                Anyone with the public link can access (no sign-in required)
              </label>

              {publicEnabled && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <select
                    value={publicRole}
                    onChange={(e) => setPublicRole(e.target.value as ShareRole)}
                    className="rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <select
                    value={publicExpiry}
                    onChange={(e) => setPublicExpiry(e.target.value as ExpiryOption)}
                    className="rounded-lg border border-border bg-bg-secondary px-2 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                  >
                    <option value="30m">30 min</option>
                    <option value="7d">7 days</option>
                    <option value="never">No expiry</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={handlePublicShareSave}
                disabled={updatingPublic}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary transition-colors hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingPublic ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Clock3 className="h-4 w-4" />
                )}
                Save link sharing
              </button>

              {publicEnabled && publicUrl && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] text-text-muted">Public link</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={publicUrl}
                      readOnly
                      className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-secondary"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(publicUrl);
                          setSuccess("Public link copied");
                        } catch {
                          setError("Could not copy link");
                        }
                      }}
                      className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary transition-colors hover:bg-bg-elevated"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {error && <p className="mb-2 text-xs text-error">{error}</p>}
        {success && <p className="mb-2 text-xs text-success">{success}</p>}

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {owner && (
            <div className="flex items-center gap-3 rounded-lg bg-bg-secondary/50 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
                {owner.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{owner.name}</p>
                <p className="truncate text-xs text-text-muted">{owner.email}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
                <Crown className="h-3.5 w-3.5" />
                Owner
              </div>
            </div>
          )}

          {loading && collaborators.length === 0 && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          )}

          {collaborators.map((collab) => (
            <div
              key={collab.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-elevated/50"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-sm font-semibold text-text-secondary">
                {collab.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{collab.name}</p>
                <p className="truncate text-xs text-text-muted">{collab.email}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {formatExpiry(collab.expiresAt)}
                </p>
              </div>

              {isOwner ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={collab.role}
                    onChange={(e) =>
                      handleRoleChange(collab.id, e.target.value as ShareRole)
                    }
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary outline-none focus:border-accent"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemove(collab.id)}
                    className="rounded-md p-1 text-text-muted transition-colors hover:bg-error/10 hover:text-error"
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

          {!loading && collaborators.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-sm text-text-muted">
                No email collaborators yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
