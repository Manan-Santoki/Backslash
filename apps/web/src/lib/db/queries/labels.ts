import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// Find label by id
export async function findLabelById(labelId: string) {
  const [label] = await db
    .select()
    .from(schema.labels)
    .where(eq(schema.labels.id, labelId))
    .limit(1);

  return label || null;
}

// Find labels for file
export async function findLabelsForFile(fileId: string) {
  const rows = await db
    .select({
      id: schema.labels.id,
      name: schema.labels.name,
      userId: schema.labels.userId,
      createdAt: schema.labels.createdAt,
    })
    .from(schema.projectLabels)
    .innerJoin(schema.labels, eq(schema.projectLabels.labelId, schema.labels.id))
    .where(eq(schema.projectLabels.fileId, fileId));

  return rows;
}

// Find labels for user
export async function findLabelsForUser(userId: string) {
  const rows = await db
    .select()
    .from(schema.labels)
    .where(eq(schema.labels.userId, userId));

  return rows;
}

// Create label
export async function createLabel(userId: string, name: string) {
  const [label] = await db
    .insert(schema.labels)
    .values({
      name,
      userId: userId,
    })
    .returning();

  return label;
}

// Delete label
export async function deleteLabel(labelId: string) {
  const [deleted] = await db
    .delete(schema.labels)
    .where(
      eq(schema.labels.id, labelId)
    )
    .returning();

  return deleted || null;
}

// Attach label to project
export async function attachLabelToProject(fileId: string, labelId: string) {
  const [row] = await db
    .insert(schema.projectLabels)
    .values({
      fileId,
      labelId,
    })
    .returning();

  return row;
}

// Detach label from project
export async function detachLabelFromProject(fileId: string, labelId: string) {
  const [deleted] = await db
    .delete(schema.projectLabels)
    .where(
      and(eq(schema.projectLabels.fileId, fileId), eq(schema.projectLabels.labelId, labelId))
    )
    .returning();

  return deleted || null;
}
