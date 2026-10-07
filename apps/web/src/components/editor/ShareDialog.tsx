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
  Link2,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [copiedPublicUrl, setCopiedPublicUrl] = useState(false);

  const [shareAi, setShareAi] = useState(false);
  const [updatingShareAi, setUpdatingShareAi] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    try {
      const [collabRes, publicRes, projectRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/collaborators`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/share-link`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
      ]);

      if (projectRes.ok) {
        const data = await projectRes.json();
        setShareAi(Boolean(data.project?.shareAi));
      }

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
      setCopiedPublicUrl(false);
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

  async function handleShareAiToggle() {
    const next = !shareAi;
    setError("");
    setSuccess("");
    setUpdatingShareAi(true);
    setShareAi(next);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareAi: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setShareAi(!next);
        setError(data.error || "Failed to update AI sharing");
        return;
      }
      setSuccess(
        next
          ? "Editors can now use your AI on this project"
          : "Editors now need their own AI settings"
      );
    } catch {
      setShareAi(!next);
      setError("Failed to update AI sharing");
    } finally {
      setUpdatingShareAi(false);
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
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as ShareRole)}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={inviteExpiry}
                  onValueChange={(value) => setInviteExpiry(value as ExpiryOption)}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Expiry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30m">30 min</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="never">No expiry</SelectItem>
                  </SelectContent>
                </Select>
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

            <div className="mb-5 rounded-xl border border-border bg-bg-secondary/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-accent" />
                    <p className="text-sm font-semibold text-text-primary">
                      Public link sharing
                    </p>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        publicEnabled
                          ? "border-accent/35 bg-accent/15 text-accent"
                          : "border-border bg-bg-elevated text-text-muted"
                      )}
                    >
                      {publicEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Anyone with this link can open your project without signing in.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={publicEnabled}
                  aria-label="Toggle public link sharing"
                  onClick={() => setPublicEnabled((prev) => !prev)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-md border transition-colors",
                    publicEnabled
                      ? "border-accent/70 bg-accent/25"
                      : "border-border bg-bg-tertiary"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 rounded-sm transition-all",
                      publicEnabled
                        ? "translate-x-5 bg-accent shadow-sm shadow-accent/30"
                        : "translate-x-0.5 bg-bg-primary"
                    )}
                  />
                </button>
              </div>

              {publicEnabled && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Select
                    value={publicRole}
                    onValueChange={(value) => setPublicRole(value as ShareRole)}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={publicExpiry}
                    onValueChange={(value) => setPublicExpiry(value as ExpiryOption)}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Expiry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30m">30 min</SelectItem>
                      <SelectItem value="7d">7 days</SelectItem>
                      <SelectItem value="never">No expiry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  Update public link
                </button>

                {publicEnabled && publicUrl && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(publicUrl);
                        setCopiedPublicUrl(true);
                        setSuccess("Public link copied");
                        setTimeout(() => setCopiedPublicUrl(false), 1500);
                      } catch {
                        setError("Could not copy link");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary transition-colors hover:bg-bg-elevated"
                  >
                    {copiedPublicUrl ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedPublicUrl ? "Copied" : "Copy link"}
                  </button>
                )}
              </div>

              {publicEnabled && publicUrl && (
                <div className="mt-3 rounded-lg border border-border bg-bg-secondary p-2.5">
                  <p className="mb-1 text-[11px] text-text-muted">Public URL</p>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-text-muted" />
                    <input
                      type="text"
                      value={publicUrl}
                      readOnly
                      className="min-w-0 flex-1 bg-transparent text-xs text-text-secondary outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mb-5 rounded-xl border border-border bg-bg-secondary/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    <p className="text-sm font-semibold text-text-primary">
                      Share my AI with editors
                    </p>
                    {updatingShareAi && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Editors without their own AI key use your AI settings on this
                    project. Their usage is billed to your key.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={shareAi}
                  aria-label="Toggle sharing AI with editors"
                  onClick={handleShareAiToggle}
                  disabled={updatingShareAi}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-md border transition-colors disabled:opacity-60",
                    shareAi
                      ? "border-accent/70 bg-accent/25"
                      : "border-border bg-bg-tertiary"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 rounded-sm transition-all",
                      shareAi
                        ? "translate-x-5 bg-accent shadow-sm shadow-accent/30"
                        : "translate-x-0.5 bg-bg-primary"
                    )}
                  />
                </button>
              </div>
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
                  <Select
                    value={collab.role}
                    onValueChange={(value) =>
                      handleRoleChange(collab.id, value as ShareRole)
                    }
                  >
                    <SelectTrigger className="h-8 w-[105px] rounded-md px-2 py-1 text-xs">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
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
