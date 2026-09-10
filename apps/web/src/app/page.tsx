import Link from "next/link";
import { Eye, Infinity, Server, Code2, Cpu, Clock } from "lucide-react";
import { getSessionToken, validateSession } from "@/lib/auth/session";
import { DemoBanner } from "@/components/DemoBanner";
import { demoConfig } from "@/lib/demo/config";

const features = [
  {
    icon: Eye,
    title: "Live Preview",
    description:
      "See your PDF update in real-time as you type. No manual compilation needed.",
  },
  {
    icon: Infinity,
    title: "No Limits",
    description:
      "No file size caps, no compile timeouts, no project restrictions. Your server, your rules.",
  },
  {
    icon: Server,
    title: "Self-Hostable",
    description:
      "Deploy on your own infrastructure with Docker. Full control over your data and privacy.",
  },
  {
    icon: Code2,
    title: "Open Source",
    description:
      "Fully open-source under MIT license. Inspect, modify, and contribute to the codebase.",
  },
];

/**
 * The marketing copy above promises "no limits" on your own server, which is
 * not true of a hosted demo — so the demo instance describes itself honestly.
 */
const demoFeatures = [
  features[0],
  {
    icon: Cpu,
    title: "Real Compiles",
    description:
      "Every build runs a real TeX Live container against your project. Nothing about the editor is mocked.",
  },
  {
    icon: Clock,
    title: "Temporary by Design",
    description:
      "This is a shared demo. Accounts and projects are deleted automatically a few hours after you stop using them.",
  },
  features[3],
];

export default async function HomePage() {
  let isLoggedIn = false;
  try {
    const token = await getSessionToken();
    if (token) {
      const session = await validateSession(token);
      isLoggedIn = !!session;
    }
  } catch {
    // Not logged in
  }

  const isDemo = demoConfig.enabled;
  const shownFeatures = isDemo ? demoFeatures : features;

  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      {/* Navigation */}
      <nav className="border-b border-border bg-bg-secondary/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-accent font-mono">
              \Backslash
            </span>
          </Link>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <DemoBanner />

      {/* Hero Section */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-text-primary sm:text-6xl">
          LaTeX editing,{" "}
          <span className="text-accent">simplified.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
          {isDemo
            ? "A live, fully-working demo of an open-source LaTeX editor with real compiles and instant PDF preview. Try it without installing anything."
            : "Self-hostable, open-source LaTeX editor with live PDF preview. Write beautiful documents with a modern editing experience."}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href={isLoggedIn ? "/dashboard" : "/register"}
            className="rounded-lg bg-accent px-6 py-3 text-base font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            {isLoggedIn
              ? "Open Dashboard"
              : isDemo
                ? "Try the demo"
                : "Get Started"}
          </Link>
          <a
            href="https://github.com/Manan-Santoki/Backslash"
            className="rounded-lg border border-border bg-bg-elevated px-6 py-3 text-base font-medium text-text-primary transition-colors hover:bg-border"
          >
            {isDemo ? "Self-host it" : "View on GitHub"}
          </a>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2">
          {shownFeatures.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-bg-secondary p-6 transition-colors hover:bg-bg-elevated/50"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <feature.icon className="h-5 w-5 text-accent" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-bg-secondary/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="text-sm text-text-muted font-mono">
            \Backslash
          </span>
          <span className="text-sm text-text-muted">
            Open-source LaTeX editor
          </span>
        </div>
      </footer>
    </div>
  );
}
