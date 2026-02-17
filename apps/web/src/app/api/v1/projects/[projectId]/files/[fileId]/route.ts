import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { updateFileSchema } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { eq, and, like, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

// ─── GET /api/v1/projects/[projectId]/files/[fileId] ─
// Get file metadata and content.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { projectId, fileId } = await params;

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

      const [file] = await db
        .select()
        .from(projectFiles)
        .where(
          and(
            eq(projectFiles.id, fileId),
            eq(projectFiles.projectId, projectId)
          )
        )
        .limit(1);

      if (!file) {
        return NextResponse.json(
          { error: "File not found" },
          { status: 404 }
        );
      }

      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, file.path);

      let content = "";
      if (!file.isDirectory) {
        try {
          content = await storage.readFile(fullPath);
        } catch {
          content = "";
        }
      }

      return NextResponse.json({ file, content });
    } catch (error) {
      console.error("[API v1] Error reading file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── PUT /api/v1/projects/[projectId]/files/[fileId] ─
// Update file content.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withApiKey(request, async (req, user) => {
    try {
      const { projectId, fileId } = await params;

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

      const [file] = await db
        .select()
        .from(projectFiles)
        .where(
          and(
            eq(projectFiles.id, fileId),
            eq(projectFiles.projectId, projectId)
          )
        )
        .limit(1);

      if (!file) {
        return NextResponse.json(
          { error: "File not found" },
          { status: 404 }
        );
      }

      const body = await req.json();
      const parsed = updateFileSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { content } = parsed.data;
      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, file.path);
      await storage.writeFile(fullPath, content);

      const sizeBytes = Buffer.byteLength(content, "utf-8");

      const [updatedFile] = await db
        .update(projectFiles)
        .set({ sizeBytes, updatedAt: new Date() })
        .where(eq(projectFiles.id, fileId))
        .returning();

      return NextResponse.json({ file: updatedFile });
    } catch (error) {
      console.error("[API v1] Error updating file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── DELETE /api/v1/projects/[projectId]/files/[fileId] ─
// Delete a file.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { projectId, fileId } = await params;

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

      const [file] = await db
        .select()
        .from(projectFiles)
        .where(
          and(
            eq(projectFiles.id, fileId),
            eq(projectFiles.projectId, projectId)
          )
        )
        .limit(1);

      if (!file) {
        return NextResponse.json(
          { error: "File not found" },
          { status: 404 }
        );
      }

      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, file.path);

      if (file.isDirectory) {
        await storage.deleteDirectory(fullPath);
      } else {
        await storage.deleteFile(fullPath);
      }

      if (file.isDirectory) {
        const prefix = `${file.path}/%`;
        await db
          .delete(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              or(
                eq(projectFiles.path, file.path),
                like(projectFiles.path, prefix)
              )
            )
          );
      } else {
        await db
          .delete(projectFiles)
          .where(eq(projectFiles.id, fileId));
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("[API v1] Error deleting file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
