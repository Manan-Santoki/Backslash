"use client";

import { useEffect, useState } from "react";

export interface DemoInfo {
  demo: boolean;
  ttlHours?: number;
  compilesPerHour?: number;
  disabled?: string[];
}

const NOT_DEMO: DemoInfo = { demo: false };

let cached: DemoInfo | null = null;
let inflight: Promise<DemoInfo> | null = null;

/**
 * One request per page load, shared by every consumer. A self-hosted instance
 * simply resolves to { demo: false }, so nothing demo-related ever renders.
 */
function loadDemoInfo(): Promise<DemoInfo> {
  if (cached) return Promise.resolve(cached);

  if (!inflight) {
    inflight = fetch("/api/demo")
      .then((res) => (res.ok ? (res.json() as Promise<DemoInfo>) : NOT_DEMO))
      .then((data) => {
        cached = data;
        return data;
      })
      .catch(() => NOT_DEMO)
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

/**
 * Returns null until the demo status is known, then the demo metadata.
 */
export function useDemo(): DemoInfo | null {
  const [info, setInfo] = useState<DemoInfo | null>(cached);

  useEffect(() => {
    if (cached) return;

    let active = true;
    void loadDemoInfo().then((data) => {
      if (active) setInfo(data);
    });

    return () => {
      active = false;
    };
  }, []);

  return info;
}

/**
 * True when the given feature is switched off on this instance.
 */
export function useDemoDisabled(feature: string): boolean {
  const info = useDemo();
  return Boolean(info?.demo && info.disabled?.includes(feature));
}
