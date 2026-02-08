import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { updateProjectSchema } from "@/lib/utils/validation";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import * as storage from "@/lib/storage";
import { eq, and, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId] ─────────────────
// Get project details with file list and last build.
// Accessible by owner AND shared collaborators.

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

      const project = access.project;

      const files = await db
        .select()
        .from(projectFiles)
        .where(eq(projectFiles.projectId, projectId));

      const [lastBuild] = await db
        .select()
        .from(builds)
        .where(eq(builds.projectId, projectId))
        .orderBy(desc(builds.createdAt))
        .limit(1);

      return NextResponse.json({
        project,
        files,
        lastBuild: lastBuild ?? null,
        role: access.role,
      });
    } catch (error) {
      console.error("Error fetching project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── PUT /api/projects/[projectId] ─────────────────
// Update project settings. Owner only.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access || access.role !== "owner") {
        return NextResponse.json(
          { error: "Only the project owner can update settings" },
          { status: 403 }
        );
      }

      const body = await req.json();

      const parsed = updateProjectSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const updates = parsed.data;

      const [updatedProject] = await db
        .update(projects)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId))
        .returning();

      return NextResponse.json({ project: updatedProject });
    } catch (error) {
      console.error("Error updating project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── DELETE /api/projects/[projectId] ──────────────
// Delete project, its DB rows, and project directory from disk. Owner only.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access || access.role !== "owner") {
        return NextResponse.json(
          { error: "Only the project owner can delete it" },
          { status: 403 }
        );
      }

      const project = access.project;

      // Delete DB rows (cascades handle files and builds)
      await db.delete(projects).where(eq(projects.id, projectId));

      // Delete project directory from disk
      const projectDir = storage.getProjectDir(project.userId, projectId);
      await storage.deleteDirectory(projectDir);

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
