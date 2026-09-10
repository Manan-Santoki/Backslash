export type DemoFeature = "api" | "ai" | "sharing";

export const DEMO_DISABLED_FEATURES: DemoFeature[] = ["api", "ai", "sharing"];

function int(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hosted demo mode.
 *
 * When `DEMO_MODE=true` the whole instance becomes a public demo: every account is
 * ephemeral (reaped after an idle TTL), expensive features are switched off, and
 * resource-hungry actions are rate limited.
 *
 * When disabled (the default) the app behaves exactly like a normal self-hosted
 * deployment — none of the limits below are applied.
 */
export const demoConfig = {
  enabled: process.env.DEMO_MODE === "true",

  /** Hours of inactivity before a demo account is deleted. */
  ttlHours: int(process.env.DEMO_TTL_HOURS, 2),
  /** Lifetime of a demo session. Short so idle data becomes reapable quickly. */
  sessionHours: int(process.env.DEMO_SESSION_HOURS, 2),
  /** How often the reaper sweeps. */
  sweepIntervalMinutes: int(process.env.DEMO_SWEEP_INTERVAL_MINUTES, 15),

  /** Compiles allowed per visitor per hour. */
  compilesPerHour: int(process.env.DEMO_COMPILES_PER_HOUR, 10),
  /** Compiles allowed across the whole instance per day. */
  globalCompilesPerDay: int(process.env.DEMO_GLOBAL_COMPILES_PER_DAY, 500),
  /** Reject builds when the compile queue is longer than this. */
  maxQueueDepth: int(process.env.DEMO_MAX_QUEUE_DEPTH, 3),
  /** Concurrent queued/compiling builds a single visitor may have. */
  maxConcurrentPerUser: int(process.env.DEMO_MAX_CONCURRENT_PER_USER, 2),
  /** Upper bound on a single compile, regardless of COMPILE_TIMEOUT. */
  maxCompileTimeoutSeconds: int(process.env.DEMO_MAX_COMPILE_TIMEOUT, 60),

  /** Total accounts allowed on the instance. */
  maxUsers: int(process.env.DEMO_MAX_USERS, 2000),
  /** Signup attempts allowed per IP per hour. */
  signupsPerIpHour: int(process.env.DEMO_SIGNUPS_PER_IP_HOUR, 5),
  /** Login attempts allowed per IP per 15 minutes. */
  loginsPerIpQuarterHour: int(process.env.DEMO_LOGINS_PER_IP_15MIN, 20),

  /** Accounts never touched by the reaper (operator's own account). */
  exemptEmails: emailList(process.env.DEMO_EXEMPT_EMAILS),
};

export function isFeatureDisabled(feature: DemoFeature): boolean {
  return demoConfig.enabled && DEMO_DISABLED_FEATURES.includes(feature);
}

export function isDemoExemptEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return demoConfig.exemptEmails.includes(email.trim().toLowerCase());
}

/**
 * A public demo with the default session secret lets anyone forge a session for
 * any other visitor. Not fatal, but worth shouting about.
 */
const INSECURE_SECRETS = ["", "change-me-to-a-random-64-char-string"];

if (demoConfig.enabled && INSECURE_SECRETS.includes(process.env.SESSION_SECRET ?? "")) {
  console.warn(
    "[demo] WARNING: DEMO_MODE is enabled but SESSION_SECRET is unset or left at the " +
      "default value. Set a unique SESSION_SECRET before exposing this instance publicly."
  );
}
