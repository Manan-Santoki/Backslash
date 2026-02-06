"use client";

import { useState, useCallback } from "react";
import type { ProjectFile } from "@leafedit/shared";

export function useFileTree(
  projectId: string | null,
  initialFiles: ProjectFile[]
) {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);

  const refreshFiles = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
      }
    } catch {
      // Silently fail
    }
  }, [projectId]);

  const createFile = useCallback(
    async (filePath: string, isDirectory = false) => {
      if (!projectId) return null;
      try {
        const res = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: filePath,
            content: isDirectory ? undefined : "",
            isDirectory,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setFiles((prev) => [...prev, data.file]);
          return data.file as ProjectFile;
        }
      } catch {
        // Silently fail
      }
      return null;
    },
    [projectId]
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      if (!projectId) return false;
      try {
        const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setFiles((prev) => prev.filter((f) => f.id !== fileId));
          return true;
        }
      } catch {
        // Silently fail
      }
      return false;
    },
    [projectId]
  );

  return { files, setFiles, refreshFiles, createFile, deleteFile };
}
