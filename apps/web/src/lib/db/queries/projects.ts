import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function findProjectsByUser(userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function findProjectById(projectId: string) {
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return result[0] || null;
}

export async function findProjectFiles(projectId: string) {
  return db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(projectFiles.path);
}

export async function findLatestBuild(projectId: string) {
  const result = await db
    .select()
    .from(builds)
    .where(eq(builds.projectId, projectId))
    .orderBy(desc(builds.createdAt))
    .limit(1);
  return result[0] || null;
}
