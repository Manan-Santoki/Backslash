import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { createProjectSchema } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { MIME_TYPES } from "@backslash/shared";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { projectFiles } from "@/lib/db/schema";

// ─── GET /api/v1/projects ───────────────────────────
// List all projects for the API key owner.

export async function GET(request: NextRequest) {
  return withApiKey(request, async (_req, user) => {
    try {
      const userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.updatedAt));

      const result = await Promise.all(
        userProjects.map(async (project) => {
          const [lastBuild] = await db
            .select({ status: builds.status })
            .from(builds)
            .where(eq(builds.projectId, project.id))
            .orderBy(desc(builds.createdAt))
            .limit(1);

          return {
            ...project,
            lastBuildStatus: lastBuild?.status ?? null,
          };
        })
      );

      return NextResponse.json({ projects: result });
    } catch (error) {
      console.error("[API v1] Error listing projects:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── POST /api/v1/projects ──────────────────────────
// Create a new project.

export async function POST(request: NextRequest) {
  return withApiKey(request, async (req, user) => {
    try {
      const body = await req.json();
      const parsed = createProjectSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { name, description, engine, template } = parsed.data;
      const templateName = template ?? "blank";
      const projectId = uuidv4();

      const [project] = await db
        .insert(projects)
        .values({
          id: projectId,
          userId: user.id,
          name,
          description: description ?? "",
          engine: engine ?? "auto",
          mainFile: "main.tex",
        })
        .returning();

      const projectDir = storage.getProjectDir(user.id, projectId);
      const copiedFiles = await storage.copyTemplate(templateName, projectDir);

      if (copiedFiles.length > 0) {
        const fileRows = await Promise.all(
          copiedFiles.map(async (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = MIME_TYPES[ext] || "text/plain";
            const fullPath = path.join(projectDir, filePath);
            let sizeBytes = 0;
            try {
              sizeBytes = await storage.getFileSize(fullPath);
            } catch {}
            return {
              id: uuidv4(),
              projectId,
              path: filePath,
              mimeType,
              sizeBytes,
              isDirectory: false,
            };
          })
        );
        await db.insert(projectFiles).values(fileRows);
      }

      return NextResponse.json({ project }, { status: 201 });
    } catch (error) {
      console.error("[API v1] Error creating project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
