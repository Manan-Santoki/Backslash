import { withAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  return withAuth(request, async (_req, user) => {
    const body = await request.json();
    const { name, email } = body;

    const updates: { name?: string; email?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 255) {
        return NextResponse.json(
          { error: "Name must be between 1 and 255 characters" },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }

    if (email !== undefined) {
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 }
        );
      }

      if (email.toLowerCase() !== user.email.toLowerCase()) {
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email.toLowerCase()), ne(users.id, user.id)))
          .limit(1);

        if (existing.length > 0) {
          return NextResponse.json(
            { error: "Email is already in use" },
            { status: 409 }
          );
        }
      }
      updates.email = email.toLowerCase();
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    return NextResponse.json({ user: updated });
  });
}
