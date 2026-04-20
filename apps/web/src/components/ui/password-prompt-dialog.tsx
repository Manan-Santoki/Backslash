"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

interface PasswordPromptDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  errorMessage?: string | null;
  submitting?: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  errorMessage,
  submitting = false,
  onConfirm,
  onCancel,
}: PasswordPromptDialogProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) return;
    onConfirm(password);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-text-secondary">{message}</p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
          />

          {errorMessage && (
            <p className="mt-2 text-sm text-error">{errorMessage}</p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={submitting || !password}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Verifying..." : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
