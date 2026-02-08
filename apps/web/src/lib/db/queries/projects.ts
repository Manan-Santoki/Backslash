import { db } from "@/lib/db";
import { projects, projectFiles, builds, projectShares, users } from "@/lib/db/schema";
import { eq, and, desc, or } from "drizzle-orm";

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

// ─── Collaboration Queries ──────────────────────────

/**
 * Returns the user's share record for a project, or null if not shared.
 */
export async function findShareByUserAndProject(
  userId: string,
  projectId: string
) {
  const result = await db
    .select()
    .from(projectShares)
    .where(
      and(
        eq(projectShares.projectId, projectId),
        eq(projectShares.userId, userId)
      )
    )
    .limit(1);
  return result[0] || null;
}

/**
 * Check if a user has access to a project (owner or shared).
 * Returns { access: true, role: 'owner' | 'viewer' | 'editor', project } or { access: false }.
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string
): Promise<
  | { access: true; role: "owner" | "viewer" | "editor"; project: typeof projects.$inferSelect }
  | { access: false }
> {
  const project = await findProjectById(projectId);
  if (!project) return { access: false };

  if (project.userId === userId) {
    return { access: true, role: "owner", project };
  }

  const share = await findShareByUserAndProject(userId, projectId);
  if (share) {
    return { access: true, role: share.role, project };
  }

  return { access: false };
}

/**
 * List all collaborators on a project (with user info).
 */
export async function findProjectCollaborators(projectId: string) {
  return db
    .select({
      id: projectShares.id,
      userId: projectShares.userId,
      email: users.email,
      name: users.name,
      role: projectShares.role,
      createdAt: projectShares.createdAt,
    })
    .from(projectShares)
    .innerJoin(users, eq(projectShares.userId, users.id))
    .where(eq(projectShares.projectId, projectId))
    .orderBy(projectShares.createdAt);
}

/**
 * Find all projects shared with a user (not owned by them).
 */
export async function findSharedProjectsByUser(userId: string) {
  return db
    .select({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      description: projects.description,
      engine: projects.engine,
      mainFile: projects.mainFile,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerName: users.name,
      ownerEmail: users.email,
      role: projectShares.role,
    })
    .from(projectShares)
    .innerJoin(projects, eq(projectShares.projectId, projects.id))
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projectShares.userId, userId))
    .orderBy(desc(projects.updatedAt));
}
