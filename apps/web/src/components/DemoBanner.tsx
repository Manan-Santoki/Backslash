"use client";

import { useDemo } from "@/hooks/useDemo";

/**
 * Strip shown on demo instances only. Renders nothing until the demo status is
 * known, so self-hosted deployments never flash it.
 */
export function DemoBanner({ className }: { className?: string }) {
  const info = useDemo();

  if (!info?.demo) return null;

  const ttlHours = info.ttlHours ?? 2;

  return (
    <div
      className={
        "flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 border-b border-accent/20 bg-accent/5 px-4 py-1.5 text-center text-xs text-text-secondary" +
        (className ? " " + className : "")
      }
    >
      <span className="font-medium text-accent">Live demo</span>
      <span aria-hidden="true">·</span>
      <span>
        Full product, but accounts and projects are deleted after {ttlHours}{" "}
        hours of inactivity.
      </span>
      <a
        href="https://github.com/Manan-Santoki/Backslash"
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline-offset-2 transition-colors hover:underline"
      >
        Self-host it →
      </a>
    </div>
  );
}
