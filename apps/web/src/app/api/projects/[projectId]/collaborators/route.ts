import { db } from "@/lib/db";
import { projectShares, users } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import {
  checkProjectAccess,
  findProjectCollaborators,
} from "@/lib/db/queries/projects";
import { findUserByEmail } from "@/lib/db/queries/users";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const shareSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["viewer", "editor"]),
});

// ─── GET /api/projects/[projectId]/collaborators ───
// List all collaborators on a project. Owner and shared users can view.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const collaborators = await findProjectCollaborators(projectId);

      // Also return the owner info
      const project = access.project;
      const [owner] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, project.userId))
        .limit(1);

      return NextResponse.json({
        owner: owner
          ? { userId: owner.id, email: owner.email, name: owner.name }
          : null,
        collaborators: collaborators.map((c) => ({
          id: c.id,
          userId: c.userId,
          email: c.email,
          name: c.name,
          role: c.role,
          createdAt: c.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error listing collaborators:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── POST /api/projects/[projectId]/collaborators ──
// Invite a collaborator by email. Only the project owner can invite.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access || access.role !== "owner") {
        return NextResponse.json(
          { error: "Only the project owner can invite collaborators" },
          { status: 403 }
        );
      }

      const body = await req.json();
      const parsed = shareSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { email, role } = parsed.data;

      // Can't share with yourself
      if (email.toLowerCase() === user.email.toLowerCase()) {
        return NextResponse.json(
          { error: "You cannot share a project with yourself" },
          { status: 400 }
        );
      }

      // Find the target user
      const targetUser = await findUserByEmail(email);
      if (!targetUser) {
        return NextResponse.json(
          { error: "No user found with that email address" },
          { status: 404 }
        );
      }

      // Check if already shared
      const [existing] = await db
        .select()
        .from(projectShares)
        .where(
          and(
            eq(projectShares.projectId, projectId),
            eq(projectShares.userId, targetUser.id)
          )
        )
        .limit(1);

      if (existing) {
        // Update role if already shared
        const [updated] = await db
          .update(projectShares)
          .set({ role })
          .where(eq(projectShares.id, existing.id))
          .returning();

        return NextResponse.json({
          collaborator: {
            id: updated.id,
            userId: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
            role: updated.role,
            createdAt: updated.createdAt,
          },
          updated: true,
        });
      }

      // Create new share
      const [share] = await db
        .insert(projectShares)
        .values({
          projectId,
          userId: targetUser.id,
          role,
          invitedBy: user.id,
        })
        .returning();

      return NextResponse.json(
        {
          collaborator: {
            id: share.id,
            userId: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
            role: share.role,
            createdAt: share.createdAt,
          },
          updated: false,
        },
        { status: 201 }
      );
    } catch (error) {
      console.error("Error inviting collaborator:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
