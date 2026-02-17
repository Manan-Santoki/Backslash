import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { validateFilePath } from "@/lib/utils/validation";
import { broadcastFileEvent } from "@/lib/websocket/server";
import * as storage from "@/lib/storage";
import { MIME_TYPES, LIMITS } from "@backslash/shared";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/projects/[projectId]/files/upload ────
// Upload one or more files via FormData (for drag-and-drop from OS).
// Editors and owners can upload; viewers cannot.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

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

    const formData = await request.formData();
      const entries = formData.getAll("files") as File[];
      const paths = formData.getAll("paths") as string[];

      if (entries.length === 0) {
        return NextResponse.json(
          { error: "No files provided" },
          { status: 400 }
        );
      }

      // Auto-create parent directory entries for nested paths (e.g. "chapters/intro.tex" → create "chapters")
      const dirPaths = new Set<string>();
      for (let i = 0; i < entries.length; i++) {
        const filePath = paths[i] || entries[i].name;
        const parts = filePath.split("/");
        for (let j = 1; j < parts.length; j++) {
          dirPaths.add(parts.slice(0, j).join("/"));
        }
      }

      for (const dirPath of Array.from(dirPaths).sort()) {
        const [existingDir] = await db
          .select({ id: projectFiles.id })
          .from(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              eq(projectFiles.path, dirPath)
            )
          )
          .limit(1);

        if (!existingDir) {
          // Create the directory on disk
          const projectDir = storage.getProjectDir(project.userId, projectId);
          const fullDirPath = path.join(projectDir, dirPath);
          await storage.createDirectory(fullDirPath);

          // Create the directory entry in DB
          await db.insert(projectFiles).values({
            id: uuidv4(),
            projectId,
            path: dirPath,
            mimeType: null,
            sizeBytes: 0,
            isDirectory: true,
          });
        }
      }

    const created = [];
    const actorUserId = access.user?.id ?? "anonymous";

      for (let i = 0; i < entries.length; i++) {
        const file = entries[i];
        const filePath = paths[i] || file.name;

        // Validate path
        const pathValidation = validateFilePath(filePath);
        if (!pathValidation.valid) {
          continue;
        }

        // Size check
        if (file.size > LIMITS.MAX_FILE_SIZE) {
          continue;
        }

        // Check for duplicates — skip if exists
        const [existing] = await db
          .select({ id: projectFiles.id })
          .from(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              eq(projectFiles.path, filePath)
            )
          )
          .limit(1);

        if (existing) {
          // Overwrite: update the existing file on disk and in DB
          const projectDir = storage.getProjectDir(project.userId, projectId);
          const fullPath = path.join(projectDir, filePath);
          const buffer = Buffer.from(await file.arrayBuffer());
          await storage.writeFileBinary(fullPath, buffer);

          const [updatedFile] = await db
            .update(projectFiles)
            .set({
              sizeBytes: file.size,
              updatedAt: new Date(),
            })
            .where(eq(projectFiles.id, existing.id))
            .returning();

          created.push(updatedFile);
          continue;
        }

        // Write to disk
        const projectDir = storage.getProjectDir(project.userId, projectId);
        const fullPath = path.join(projectDir, filePath);
        const buffer = Buffer.from(await file.arrayBuffer());
        await storage.writeFileBinary(fullPath, buffer);

        // Determine mime type
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || file.type || "application/octet-stream";

        const fileId = uuidv4();

        const [dbFile] = await db
          .insert(projectFiles)
          .values({
            id: fileId,
            projectId,
            path: filePath,
            mimeType,
            sizeBytes: file.size,
            isDirectory: false,
          })
          .returning();

        created.push(dbFile);

        // Broadcast file creation to collaborators
      broadcastFileEvent({
        type: "file:created",
        projectId,
        userId: actorUserId,
        fileId,
        path: filePath,
        isDirectory: false,
      });
      }

      return NextResponse.json({ files: created }, { status: 201 });
  } catch (error) {
    console.error("Error uploading files:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
