"use client";

import { useState, useEffect, useCallback } from "react";
import type { Project, ProjectFile, Build } from "@leafedit/shared";

interface ProjectData {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
}

export function useProject(projectId: string | null) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Project not found" : "Failed to fetch project");
      }
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  return { data, loading, error, refetch: fetchProject };
}
