"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { EditorLayout } from "@/components/editor/EditorLayout";

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

interface ShareData {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
  role: "viewer" | "editor";
  shareToken: string;
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export default function SharedEditorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [data, setData] = useState<ShareData | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [shareRes, userRes] = await Promise.all([
          fetch(`/api/share/${token}`, { cache: "no-store" }),
          fetch("/api/auth/me", { cache: "no-store" }),
        ]);

        if (!shareRes.ok) {
          setError(true);
          return;
        }

        const json = await shareRes.json();
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
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <span className="text-sm text-text-muted">Loading shared project...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl font-bold text-text-muted">404</div>
          <h2 className="text-lg font-semibold text-text-primary">
            Share link is invalid or expired
          </h2>
          <p className="text-sm text-text-secondary">
            This public link is no longer available.
          </p>
          <Link
            href="/login"
            className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <EditorLayout
        project={data.project}
        files={data.files}
        lastBuild={data.lastBuild}
        role={data.role}
        currentUser={currentUser ?? { id: "", email: "", name: "" }}
        shareToken={data.shareToken}
        isPublicShare={true}
        onIdentityResolved={(resolved) => {
          if (!currentUser) setCurrentUser(resolved);
        }}
      />
    </div>
  );
}
