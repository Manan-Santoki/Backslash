import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { updateProjectSchema } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { eq, and, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId] ─────────────────
// Get project details with file list and last build.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

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
// Update project settings.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
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
// Delete project, its DB rows, and project directory from disk.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      // Delete DB rows (cascades handle files and builds)
      await db.delete(projects).where(eq(projects.id, projectId));

      // Delete project directory from disk
      const projectDir = storage.getProjectDir(user.id, projectId);
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
