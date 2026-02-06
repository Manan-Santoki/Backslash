import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function findFileById(fileId: string) {
  const result = await db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.id, fileId))
    .limit(1);
  return result[0] || null;
}

export async function findFileByPath(projectId: string, filePath: string) {
  const result = await db
    .select()
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.projectId, projectId),
        eq(projectFiles.path, filePath)
      )
    )
    .limit(1);
  return result[0] || null;
}

export async function findProjectFilesByProjectId(projectId: string) {
  return db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(projectFiles.path);
}
