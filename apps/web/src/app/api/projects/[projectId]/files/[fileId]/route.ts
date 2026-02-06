import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import {
  updateFileSchema,
  renameFileSchema,
  validateFilePath,
} from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { eq, and, like } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { addCompileJob } from "@/lib/compiler/queue";
import { v4 as uuidv4 } from "uuid";

// ─── GET /api/projects/[projectId]/files/[fileId] ──
// Get file metadata and content.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withAuth(request, async (_req, user) => {
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
          // File may have been removed from disk
          content = "";
        }
      }

      return NextResponse.json({ file, content });
    } catch (error) {
      console.error("Error reading file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── PUT /api/projects/[projectId]/files/[fileId] ──
// Update file content. Optionally triggers auto-compilation.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withAuth(request, async (req, user) => {
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

      const { content, autoCompile } = parsed.data;

      // Write updated content to disk
      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, file.path);
      await storage.writeFile(fullPath, content);

      const sizeBytes = Buffer.byteLength(content, "utf-8");

      // Update DB row
      const [updatedFile] = await db
        .update(projectFiles)
        .set({
          sizeBytes,
          updatedAt: new Date(),
        })
        .where(eq(projectFiles.id, fileId))
        .returning();

      let buildQueued = false;

      // If autoCompile is true, create a build record and enqueue compile job
      if (autoCompile) {
        const buildId = uuidv4();

        await db.insert(builds).values({
          id: buildId,
          projectId,
          userId: user.id,
          status: "queued",
          engine: project.engine,
        });

        await addCompileJob({
          buildId,
          projectId,
          userId: user.id,
          engine: project.engine,
          mainFile: project.mainFile,
        });

        buildQueued = true;
      }

      return NextResponse.json({
        file: updatedFile,
        buildQueued,
      });
    } catch (error) {
      console.error("Error updating file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── PATCH /api/projects/[projectId]/files/[fileId] ──
// Rename or move a file/folder.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withAuth(request, async (req, user) => {
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
      const parsed = renameFileSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { newPath } = parsed.data;

      // Validate the new path
      const validation = validateFilePath(newPath);
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 }
        );
      }

      // Check if a file already exists at the new path
      const [existing] = await db
        .select()
        .from(projectFiles)
        .where(
          and(
            eq(projectFiles.projectId, projectId),
            eq(projectFiles.path, newPath)
          )
        )
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: "A file already exists at that path" },
          { status: 409 }
        );
      }

      const projectDir = storage.getProjectDir(user.id, projectId);
      const oldFullPath = path.join(projectDir, file.path);
      const newFullPath = path.join(projectDir, newPath);

      // Rename on disk
      await storage.renameFile(oldFullPath, newFullPath);

      // Update the file's path in DB
      const [updatedFile] = await db
        .update(projectFiles)
        .set({ path: newPath, updatedAt: new Date() })
        .where(eq(projectFiles.id, fileId))
        .returning();

      // For directories, also update all children whose path starts with the old prefix
      if (file.isDirectory) {
        const oldPrefix = file.path + "/";
        const children = await db
          .select()
          .from(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              like(projectFiles.path, oldPrefix + "%")
            )
          );

        for (const child of children) {
          const childNewPath = newPath + "/" + child.path.slice(oldPrefix.length);
          await db
            .update(projectFiles)
            .set({ path: childNewPath, updatedAt: new Date() })
            .where(eq(projectFiles.id, child.id));
        }
      }

      return NextResponse.json({ file: updatedFile });
    } catch (error) {
      console.error("Error renaming file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── DELETE /api/projects/[projectId]/files/[fileId]
// Delete a file from disk and database.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  return withAuth(request, async (_req, user) => {
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

      // Delete from disk
      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, file.path);

      if (file.isDirectory) {
        await storage.deleteDirectory(fullPath);
      } else {
        await storage.deleteFile(fullPath);
      }

      // Delete from database
      await db
        .delete(projectFiles)
        .where(eq(projectFiles.id, fileId));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
