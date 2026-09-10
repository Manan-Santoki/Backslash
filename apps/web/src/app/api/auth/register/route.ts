import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  setSessionCookie,
} from "@/lib/auth/session";
import { registerSchema } from "@/lib/utils/validation";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import {
  consumeRateLimit,
  demoBlockResponse,
  demoConfig,
  getClientIp,
} from "@/lib/demo";

export async function POST(request: NextRequest) {
  try {
    if (process.env.DISABLE_SIGNUP === "true") {
      return NextResponse.json(
        { error: "Registration is currently disabled" },
        { status: 403 }
      );
    }

    const body = await request.json();

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, name, password } = parsed.data;

    // Demo mode: keep account creation bounded per IP and in total.
    if (demoConfig.enabled) {
      const signupLimit = await consumeRateLimit(
        "signup",
        getClientIp(request),
        demoConfig.signupsPerIpHour,
        3600
      );

      if (!signupLimit.allowed) {
        const minutes = Math.max(
          Math.ceil(signupLimit.retryAfterSeconds / 60),
          1
        );
        return demoBlockResponse({
          status: 429,
          code: "demo_signup_rate_limited",
          error: `Too many accounts created from this address. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or self-host Backslash.`,
          retryAfterSeconds: signupLimit.retryAfterSeconds,
        });
      }

      const [userCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users);

      if ((userCount?.count ?? 0) >= demoConfig.maxUsers) {
        return demoBlockResponse({
          status: 503,
          code: "demo_full",
          error:
            "This demo has reached its account limit. Try again later, or self-host Backslash.",
        });
      }
    }

    // Check if a user with this email already exists
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const [user] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        name,
        passwordHash,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
      });

    // Create session and set cookie
    const token = await createSession(user.id);
    await setSessionCookie(token);

    return NextResponse.json({ user, token }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
