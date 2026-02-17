import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { createFileSchema, validateFilePath } from "@/lib/utils/validation";
import { broadcastFileEvent } from "@/lib/websocket/server";
import * as storage from "@/lib/storage";
import { MIME_TYPES } from "@backslash/shared";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── GET /api/projects/[projectId]/files ───────────
// List all files in a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const files = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error listing files:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── POST /api/projects/[projectId]/files ──────────
// Create a new file or directory in a project.

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
    const body = await request.json();

      const parsed = createFileSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { path: filePath, content, isDirectory } = parsed.data;

      // Validate the file path for security
      const pathValidation = validateFilePath(filePath);
      if (!pathValidation.valid) {
        return NextResponse.json(
          { error: pathValidation.error },
          { status: 400 }
        );
      }

      // Check if a file with this path already exists in the project
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
        return NextResponse.json(
          { error: "A file with this path already exists" },
          { status: 409 }
        );
      }

      const projectDir = storage.getProjectDir(project.userId, projectId);
      const fullPath = path.join(projectDir, filePath);

      let sizeBytes = 0;

      if (isDirectory) {
        // Create directory on disk
        await storage.createDirectory(fullPath);
      } else {
        // Write file content to disk
        const fileContent = content ?? "";
        await storage.writeFile(fullPath, fileContent);
        sizeBytes = Buffer.byteLength(fileContent, "utf-8");
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = isDirectory
        ? "inode/directory"
        : MIME_TYPES[ext] || "text/plain";

      const fileId = uuidv4();

      const [file] = await db
        .insert(projectFiles)
        .values({
          id: fileId,
          projectId,
          path: filePath,
          mimeType,
          sizeBytes,
          isDirectory: isDirectory ?? false,
        })
        .returning();

    // Broadcast file creation to other collaborators
    broadcastFileEvent({
      type: "file:created",
      projectId,
      userId: access.user?.id ?? "anonymous",
      fileId,
      path: filePath,
      isDirectory: isDirectory ?? false,
    });

    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    console.error("Error creating file:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
