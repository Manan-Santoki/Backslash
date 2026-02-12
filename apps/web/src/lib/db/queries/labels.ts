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
    .from(schema.fileLabels)
    .innerJoin(schema.labels, eq(schema.fileLabels.labelId, schema.labels.id))
    .where(eq(schema.fileLabels.fileId, fileId));

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

// Attach label to file
export async function attachLabelToFile(fileId: string, labelId: string) {
  const [row] = await db
    .insert(schema.fileLabels)
    .values({
      fileId,
      labelId,
    })
    .returning();

  return row;
}

// Detach label from file
export async function detachLabelFromFile(fileId: string, labelId: string) {
  const [deleted] = await db
    .delete(schema.fileLabels)
    .where(
      and(eq(schema.fileLabels.fileId, fileId), eq(schema.fileLabels.labelId, labelId))
    )
    .returning();

  return deleted || null;
}
