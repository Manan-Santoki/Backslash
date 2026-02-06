"use client";

import { create } from "zustand";
import type { BuildStatus, ParsedLogEntry } from "@leafedit/shared";

interface BuildState {
  isCompiling: boolean;
  lastStatus: BuildStatus | "idle";
  lastLogs: string;
  lastErrors: ParsedLogEntry[];
  lastDurationMs: number | null;
  lastPdfUrl: string | null;
  buildHistory: Array<{
    buildId: string;
    status: BuildStatus;
    durationMs: number | null;
    createdAt: string;
  }>;

  setCompiling: (compiling: boolean) => void;
  setLastBuild: (data: {
    status: BuildStatus;
    logs: string;
    errors: ParsedLogEntry[];
    durationMs: number | null;
    pdfUrl: string | null;
  }) => void;
  addToHistory: (entry: {
    buildId: string;
    status: BuildStatus;
    durationMs: number | null;
    createdAt: string;
  }) => void;
  reset: () => void;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  isCompiling: false,
  lastStatus: "idle",
  lastLogs: "",
  lastErrors: [],
  lastDurationMs: null,
  lastPdfUrl: null,
  buildHistory: [],

  setCompiling: (compiling) => set({ isCompiling: compiling }),

  setLastBuild: (data) =>
    set({
      lastStatus: data.status,
      lastLogs: data.logs,
      lastErrors: data.errors,
      lastDurationMs: data.durationMs,
      lastPdfUrl: data.pdfUrl,
      isCompiling: false,
    }),

  addToHistory: (entry) => {
    const { buildHistory } = get();
    set({ buildHistory: [entry, ...buildHistory].slice(0, 50) });
  },

  reset: () =>
    set({
      isCompiling: false,
      lastStatus: "idle",
      lastLogs: "",
      lastErrors: [],
      lastDurationMs: null,
      lastPdfUrl: null,
      buildHistory: [],
    }),
}));
