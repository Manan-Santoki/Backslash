"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // The endpoint is deliberately tolerant; we always show the same message.
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">
        Forgot your password?
      </h1>

      {submitted ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            If an account exists for that email, a reset link has been sent.
            The link expires in 30 minutes.
          </div>
          <p className="text-sm text-text-muted">
            Didn&apos;t get anything? Double-check the address you entered and try again.
          </p>
          <Link
            href="/login"
            className="inline-block text-sm text-accent transition-colors hover:text-accent-hover"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-text-secondary">
            Enter the email on your account and we&apos;ll send you a link to choose a new password.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-text-secondary"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-text-muted">
            Remembered it?{" "}
            <Link
              href="/login"
              className="text-accent transition-colors hover:text-accent-hover"
            >
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
