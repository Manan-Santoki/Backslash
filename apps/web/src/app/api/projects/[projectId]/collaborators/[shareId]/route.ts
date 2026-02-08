import { db } from "@/lib/db";
import { projectShares } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateShareSchema = z.object({
  role: z.enum(["viewer", "editor"]),
});

// ─── PUT /api/projects/[projectId]/collaborators/[shareId] ──
// Update a collaborator's role. Owner only.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; shareId: string }> }
) {
  return withAuth(request, async (req, user) => {
    try {
      const { projectId, shareId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access || access.role !== "owner") {
        return NextResponse.json(
          { error: "Only the project owner can update collaborators" },
          { status: 403 }
        );
      }

      const body = await req.json();
      const parsed = updateShareSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const [updated] = await db
        .update(projectShares)
        .set({ role: parsed.data.role })
        .where(eq(projectShares.id, shareId))
        .returning();

      if (!updated) {
        return NextResponse.json(
          { error: "Collaborator not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ share: updated });
    } catch (error) {
      console.error("Error updating collaborator:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── DELETE /api/projects/[projectId]/collaborators/[shareId] ──
// Remove a collaborator. Owner can remove anyone, users can remove themselves.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; shareId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId, shareId } = await params;

      // Fetch the share record first
      const [share] = await db
        .select()
        .from(projectShares)
        .where(eq(projectShares.id, shareId))
        .limit(1);

      if (!share || share.projectId !== projectId) {
        return NextResponse.json(
          { error: "Collaborator not found" },
          { status: 404 }
        );
      }

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      // Owner can remove anyone; shared users can only remove themselves
      const isOwner = access.role === "owner";
      const isSelf = share.userId === user.id;
      if (!isOwner && !isSelf) {
        return NextResponse.json(
          { error: "Permission denied" },
          { status: 403 }
        );
      }

      await db.delete(projectShares).where(eq(projectShares.id, shareId));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error removing collaborator:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
