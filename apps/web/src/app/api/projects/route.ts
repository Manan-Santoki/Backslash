import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { withAuth, AuthenticatedUser } from "@/lib/auth/middleware";
import { createProjectSchema } from "@/lib/utils/validation";
import { findSharedProjectsByUser } from "@/lib/db/queries/projects";
import * as storage from "@/lib/storage";
import { MIME_TYPES } from "@backslash/shared";
import { eq, and, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── GET /api/projects ─────────────────────────────
// List all projects for the authenticated user, including shared projects.

export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, user) => {
    try {
      const userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.updatedAt));

      // For each project, fetch the latest build to get its status
      const projectsWithBuildStatus = await Promise.all(
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

      // Also fetch projects shared with this user
      const sharedProjects = await findSharedProjectsByUser(user.id);
      const sharedWithBuildStatus = await Promise.all(
        sharedProjects.map(async (sp) => {
          const [lastBuild] = await db
            .select({ status: builds.status })
            .from(builds)
            .where(eq(builds.projectId, sp.id))
            .orderBy(desc(builds.createdAt))
            .limit(1);

          return {
            ...sp,
            lastBuildStatus: lastBuild?.status ?? null,
          };
        })
      );

      return NextResponse.json({
        projects: projectsWithBuildStatus,
        sharedProjects: sharedWithBuildStatus,
      });
    } catch (error) {
      console.error("Error listing projects:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── POST /api/projects ────────────────────────────
// Create a new project from a template.

export async function POST(request: NextRequest) {
  return withAuth(request, async (req, user) => {
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

      // Create project row in database
      const [project] = await db
        .insert(projects)
        .values({
          id: projectId,
          userId: user.id,
          name,
          description: description ?? "",
          engine: engine ?? "pdflatex",
          mainFile: "main.tex",
        })
        .returning();

      // Create project directory and copy template files
      const projectDir = storage.getProjectDir(user.id, projectId);
      const copiedFiles = await storage.copyTemplate(templateName, projectDir);

      // Create projectFiles rows for each file copied from the template
      if (copiedFiles.length > 0) {
        const fileRows = await Promise.all(
          copiedFiles.map(async (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = MIME_TYPES[ext] || "text/plain";
            const fullPath = path.join(projectDir, filePath);
            let sizeBytes = 0;
            try {
              sizeBytes = await storage.getFileSize(fullPath);
            } catch {
              // File size check is best-effort
            }

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
      console.error("Error creating project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
