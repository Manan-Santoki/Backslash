import path from "path";
import { z } from "zod";
import { ALLOWED_EXTENSIONS, LIMITS } from "@backslash/shared";

export function validateFilePath(filePath: string): {
  valid: boolean;
  error?: string;
} {
  const normalized = path.normalize(filePath);

  if (path.isAbsolute(normalized)) {
    return { valid: false, error: "Absolute paths not allowed" };
  }

  if (normalized.includes("..")) {
    return { valid: false, error: "Directory traversal not allowed" };
  }

  if (
    normalized
      .split("/")
      .some((part) => part.startsWith(".") && part !== ".")
  ) {
    return { valid: false, error: "Hidden files not allowed" };
  }

  if (normalized.length > LIMITS.MAX_PATH_LENGTH) {
    return { valid: false, error: "Path too long" };
  }

  const ext = path.extname(normalized).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type '${ext}' not allowed` };
  }

  return { valid: true };
}

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .max(255, "Project name is too long"),
  description: z.string().max(1000).optional(),
  engine: z.enum(["auto", "pdflatex", "xelatex", "lualatex", "latex"]).optional(),
  template: z
    .enum(["blank", "article", "thesis", "beamer", "letter"])
    .optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  engine: z.enum(["auto", "pdflatex", "xelatex", "lualatex", "latex"]).optional(),
  mainFile: z.string().max(500).optional(),
});

export const createFileSchema = z.object({
  path: z.string().min(1, "Path is required").max(1000),
  content: z.string().optional(),
  isDirectory: z.boolean().optional(),
});

export const updateFileSchema = z.object({
  content: z.string(),
  autoCompile: z.boolean().optional().default(true),
});

export const renameFileSchema = z.object({
  newPath: z.string().min(1).max(1000),
});
