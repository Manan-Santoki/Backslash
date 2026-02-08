"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { EditorLayout } from "@/components/editor/EditorLayout";

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

interface ProjectData {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
  role?: "owner" | "viewer" | "editor";
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

// ─── Editor Page ────────────────────────────────────

export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [data, setData] = useState<ProjectData | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [projectRes, userRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`),
          fetch("/api/auth/me"),
        ]);

        if (!projectRes.ok) {
          setError(true);
          return;
        }

        const json = await projectRes.json();
        setData(json);

        if (userRes.ok) {
          const userData = await userRes.json();
          setCurrentUser(userData.user);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <span className="text-sm text-text-muted">Loading project...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl font-bold text-text-muted">404</div>
          <h2 className="text-lg font-semibold text-text-primary">
            Project not found
          </h2>
          <p className="text-sm text-text-secondary">
            The project you are looking for does not exist or you do not have
            access.
          </p>
          <Link
            href="/dashboard"
            className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <EditorLayout
      project={data.project}
      files={data.files}
      lastBuild={data.lastBuild}
      role={data.role ?? "owner"}
      currentUser={currentUser ?? { id: "", email: "", name: "" }}
    />
  );
}
