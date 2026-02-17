import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import {
  updateFileSchema,
  renameFileSchema,
  validateFilePath,
} from "@/lib/utils/validation";
import { broadcastBuildUpdate, broadcastFileEvent } from "@/lib/websocket/server";
import * as storage from "@/lib/storage";
import { eq, and, like, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { enqueueCompileJob } from "@/lib/compiler/compileQueue";
import { v4 as uuidv4 } from "uuid";

// ─── GET /api/projects/[projectId]/files/[fileId] ──
// Get file metadata and content.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  try {
    const { projectId, fileId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const project = access.project;

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

    const projectDir = storage.getProjectDir(project.userId, projectId);
    const fullPath = path.join(projectDir, file.path);

    // Serve raw binary file (e.g. images) when ?raw is present
    const isRaw = request.nextUrl.searchParams.has("raw");
    if (isRaw && !file.isDirectory && file.mimeType?.startsWith("image/")) {
      try {
        const buffer = await storage.readFileBinary(fullPath);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            "Content-Type": file.mimeType,
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch {
        return NextResponse.json(
          { error: "File not found on disk" },
          { status: 404 }
        );
      }
    }

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
}

// ─── PUT /api/projects/[projectId]/files/[fileId] ──
// Update file content. Optionally triggers auto-compilation.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  try {
    const { projectId, fileId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role === "viewer") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    const project = access.project;

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

    const body = await request.json();

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
    const projectDir = storage.getProjectDir(project.userId, projectId);
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

    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    let buildQueued = false;

    const storageUserId = project.userId;
    const actorUserId = access.user?.id ?? null;
    const buildUserId = access.user?.id ?? storageUserId;

    // If autoCompile is true, create a build record and enqueue compile job
    if (autoCompile) {
      const buildId = uuidv4();

      await db.insert(builds).values({
        id: buildId,
        projectId,
        userId: buildUserId,
        status: "queued",
        engine: project.engine,
      });

      await enqueueCompileJob({
        buildId,
        projectId,
        userId: buildUserId,
        storageUserId,
        triggeredByUserId: actorUserId,
        engine: project.engine,
        mainFile: project.mainFile,
      });

      broadcastBuildUpdate(buildUserId, {
        projectId,
        buildId,
        status: "queued",
        triggeredByUserId: actorUserId,
      });

      buildQueued = true;
    }

    // Broadcast file save to collaborators
    broadcastFileEvent({
      type: "file:saved",
      projectId,
      userId: actorUserId ?? "anonymous",
      fileId,
      path: file.path,
    });

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
}

// ─── PATCH /api/projects/[projectId]/files/[fileId] ──
// Rename or move a file/folder.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  try {
    const { projectId, fileId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role === "viewer") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    const project = access.project;

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

    const body = await request.json();
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

    const projectDir = storage.getProjectDir(project.userId, projectId);
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
}

// ─── DELETE /api/projects/[projectId]/files/[fileId]
// Delete a file from disk and database.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileId: string }> }
) {
  try {
    const { projectId, fileId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role === "viewer") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    const project = access.project;

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
    const projectDir = storage.getProjectDir(project.userId, projectId);
    const fullPath = path.join(projectDir, file.path);

    if (file.isDirectory) {
      await storage.deleteDirectory(fullPath);
    } else {
      await storage.deleteFile(fullPath);
    }

    // Delete from database.
    // For directories, also delete all descendant rows.
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

    // Broadcast file deletion to collaborators
    broadcastFileEvent({
      type: "file:deleted",
      projectId,
      userId: access.user?.id ?? "anonymous",
      fileId,
      path: file.path,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
