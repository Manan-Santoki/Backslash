"use client";

import { useState, useCallback } from "react";

interface TabInfo {
  id: string;
  path: string;
}

export function useEditorTabs() {
  const [openTabs, setOpenTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const openTab = useCallback(
    (file: TabInfo) => {
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === file.id)) return prev;
        return [...prev, file];
      });
      setActiveTabId(file.id);
    },
    []
  );

  const closeTab = useCallback(
    (fileId: string) => {
      setOpenTabs((prev) => {
        const newTabs = prev.filter((t) => t.id !== fileId);

        if (activeTabId === fileId) {
          const oldIndex = prev.findIndex((t) => t.id === fileId);
          const newActiveIndex = Math.min(oldIndex, newTabs.length - 1);
          setActiveTabId(newTabs[newActiveIndex]?.id || null);
        }

        return newTabs;
      });
    },
    [activeTabId]
  );

  const selectTab = useCallback((fileId: string) => {
    setActiveTabId(fileId);
  }, []);

  return { openTabs, activeTabId, openTab, closeTab, selectTab };
}
