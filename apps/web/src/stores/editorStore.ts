"use client";

import { create } from "zustand";
import type {
  Project,
  ProjectFile,
  Build,
  BuildStatus,
  Engine,
  ParsedLogEntry,
} from "@leafedit/shared";

interface EditorState {
  // Project
  projectId: string | null;
  projectName: string;
  engine: Engine;
  mainFile: string;

  // Files
  files: ProjectFile[];
  openTabs: string[];
  activeFileId: string | null;
  fileContents: Record<string, string>;
  dirtyFiles: Set<string>;

  // Build
  buildStatus: BuildStatus | "idle";
  buildLogs: string;
  parsedErrors: ParsedLogEntry[];
  pdfUrl: string | null;
  lastBuildDuration: number | null;

  // Actions
  setProject: (
    project: Project,
    files: ProjectFile[],
    lastBuild: Build | null
  ) => void;
  openFile: (fileId: string) => void;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
  updateFileContent: (fileId: string, content: string) => void;
  setFileContent: (fileId: string, content: string) => void;
  markFileSaved: (fileId: string) => void;
  setBuildStatus: (status: BuildStatus | "idle") => void;
  setBuildResult: (result: {
    status: BuildStatus;
    pdfUrl: string | null;
    logs: string;
    durationMs: number;
    errors: ParsedLogEntry[];
  }) => void;
  setFiles: (files: ProjectFile[]) => void;
  setEngine: (engine: Engine) => void;
  addFile: (file: ProjectFile) => void;
  removeFile: (fileId: string) => void;
  reset: () => void;
}

const initialState = {
  projectId: null,
  projectName: "",
  engine: "pdflatex" as Engine,
  mainFile: "main.tex",
  files: [],
  openTabs: [],
  activeFileId: null,
  fileContents: {},
  dirtyFiles: new Set<string>(),
  buildStatus: "idle" as const,
  buildLogs: "",
  parsedErrors: [],
  pdfUrl: null,
  lastBuildDuration: null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initialState,

  setProject: (project, files, lastBuild) =>
    set({
      projectId: project.id,
      projectName: project.name,
      engine: project.engine as Engine,
      mainFile: project.mainFile,
      files,
      buildStatus: lastBuild?.status || "idle",
      buildLogs: lastBuild?.logs || "",
      pdfUrl: lastBuild?.status === "success"
        ? `/api/projects/${project.id}/pdf?t=${Date.now()}`
        : null,
      lastBuildDuration: lastBuild?.durationMs || null,
    }),

  openFile: (fileId) => {
    const { openTabs } = get();
    if (!openTabs.includes(fileId)) {
      set({ openTabs: [...openTabs, fileId], activeFileId: fileId });
    } else {
      set({ activeFileId: fileId });
    }
  },

  closeTab: (fileId) => {
    const { openTabs, activeFileId, fileContents, dirtyFiles } = get();
    const newTabs = openTabs.filter((id) => id !== fileId);
    const newContents = { ...fileContents };
    delete newContents[fileId];
    const newDirty = new Set(dirtyFiles);
    newDirty.delete(fileId);

    let newActiveId = activeFileId;
    if (activeFileId === fileId) {
      const idx = openTabs.indexOf(fileId);
      newActiveId = newTabs[Math.min(idx, newTabs.length - 1)] || null;
    }

    set({
      openTabs: newTabs,
      activeFileId: newActiveId,
      fileContents: newContents,
      dirtyFiles: newDirty,
    });
  },

  setActiveFile: (fileId) => set({ activeFileId: fileId }),

  updateFileContent: (fileId, content) => {
    const { fileContents, dirtyFiles } = get();
    const newDirty = new Set(dirtyFiles);
    newDirty.add(fileId);
    set({
      fileContents: { ...fileContents, [fileId]: content },
      dirtyFiles: newDirty,
    });
  },

  setFileContent: (fileId, content) => {
    const { fileContents } = get();
    set({ fileContents: { ...fileContents, [fileId]: content } });
  },

  markFileSaved: (fileId) => {
    const { dirtyFiles } = get();
    const newDirty = new Set(dirtyFiles);
    newDirty.delete(fileId);
    set({ dirtyFiles: newDirty });
  },

  setBuildStatus: (status) => set({ buildStatus: status }),

  setBuildResult: (result) =>
    set({
      buildStatus: result.status,
      pdfUrl: result.pdfUrl,
      buildLogs: result.logs,
      lastBuildDuration: result.durationMs,
      parsedErrors: result.errors,
    }),

  setFiles: (files) => set({ files }),

  setEngine: (engine) => set({ engine }),

  addFile: (file) => {
    const { files } = get();
    set({ files: [...files, file] });
  },

  removeFile: (fileId) => {
    const { files, openTabs, activeFileId } = get();
    set({
      files: files.filter((f) => f.id !== fileId),
      openTabs: openTabs.filter((id) => id !== fileId),
      activeFileId: activeFileId === fileId ? null : activeFileId,
    });
  },

  reset: () => set(initialState),
}));
