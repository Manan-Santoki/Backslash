import fs from "fs/promises";
import path from "path";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";
const TEMPLATES_PATH =
  process.env.TEMPLATES_PATH || path.join(process.cwd(), "templates");

export function getProjectDir(userId: string, projectId: string): string {
  return path.join(STORAGE_PATH, "projects", userId, projectId);
}

export function getPdfPath(
  userId: string,
  projectId: string,
  mainFile: string
): string {
  const pdfName = mainFile.replace(/\.tex$/, ".pdf");
  return path.join(getProjectDir(userId, projectId), pdfName);
}

export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

export async function readFileBinary(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

export async function writeFile(
  filePath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function writeFileBinary(
  filePath: string,
  content: Buffer
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

export async function renameFile(
  oldPath: string,
  newPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.rename(oldPath, newPath);
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

export async function createDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function deleteDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function listFiles(dirPath: string): Promise<string[]> {
  const entries: string[] = [];

  async function walk(dir: string, prefix: string) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push(relativePath + "/");
        await walk(path.join(dir, item.name), relativePath);
      } else {
        entries.push(relativePath);
      }
    }
  }

  await walk(dirPath, "");
  return entries;
}

export async function copyTemplate(
  templateName: string,
  destDir: string
): Promise<string[]> {
  const templateDir = path.join(TEMPLATES_PATH, templateName);
  const copiedFiles: string[] = [];

  if (!(await fileExists(templateDir))) {
    throw new Error(`Template '${templateName}' not found`);
  }

  await createDirectory(destDir);

  async function copyDir(src: string, dest: string, prefix: string) {
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await copyDir(srcPath, destPath, relativePath);
      } else {
        await fs.copyFile(srcPath, destPath);
        copiedFiles.push(relativePath);
      }
    }
  }

  await copyDir(templateDir, destDir, "");
  return copiedFiles;
}
