import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { createFileSchema, validateFilePath } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { MIME_TYPES } from "@backslash/shared";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── GET /api/v1/projects/[projectId]/files ─────────
// List all files in a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
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

      return NextResponse.json({ files });
    } catch (error) {
      console.error("[API v1] Error listing files:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── POST /api/v1/projects/[projectId]/files ────────
// Create a new file in a project.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (req, user) => {
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

      const pathValidation = validateFilePath(filePath);
      if (!pathValidation.valid) {
        return NextResponse.json(
          { error: pathValidation.error },
          { status: 400 }
        );
      }

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

      const projectDir = storage.getProjectDir(user.id, projectId);
      const fullPath = path.join(projectDir, filePath);
      let sizeBytes = 0;

      if (isDirectory) {
        await storage.createDirectory(fullPath);
      } else {
        const fileContent = content ?? "";
        await storage.writeFile(fullPath, fileContent);
        sizeBytes = Buffer.byteLength(fileContent, "utf-8");
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = isDirectory
        ? "inode/directory"
        : MIME_TYPES[ext] || "text/plain";

      const [file] = await db
        .insert(projectFiles)
        .values({
          id: uuidv4(),
          projectId,
          path: filePath,
          mimeType,
          sizeBytes,
          isDirectory: isDirectory ?? false,
        })
        .returning();

      return NextResponse.json({ file }, { status: 201 });
    } catch (error) {
      console.error("[API v1] Error creating file:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
