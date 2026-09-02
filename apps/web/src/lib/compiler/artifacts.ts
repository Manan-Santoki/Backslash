import fs from "fs/promises";
import path from "path";

function getLoggedPdfPaths(logs: string): string[] {
  const matches: string[] = [];
  const patterns = [
    /Log file says output to\s+['"]([^'"]+\.pdf)['"]/gi,
    /Output written on\s+['"]?([^\r\n]+?\.pdf)['"]?(?=\s*\()/gi,
  ];

  for (const pattern of patterns) {
    for (const match of logs.matchAll(pattern)) {
      matches.push(match[1].trim());
    }
  }

  // Later LaTeX passes are more authoritative than earlier ones.
  return matches.reverse();
}

function resolveBuildPath(buildDir: string, candidate: string): string | null {
  const normalizedCandidate = candidate.replace(/\\/g, path.sep);
  const resolved = path.resolve(buildDir, normalizedCandidate);
  const resolvedBuildDir = path.resolve(buildDir);

  if (
    resolved !== resolvedBuildDir &&
    !resolved.startsWith(`${resolvedBuildDir}${path.sep}`)
  ) {
    return null;
  }

  return resolved;
}

async function isPdfFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

async function findPdfByName(
  directory: string,
  pdfName: string
): Promise<string[]> {
  const matches: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findPdfByName(entryPath, pdfName)));
    } else if (entry.isFile() && entry.name === pdfName) {
      matches.push(entryPath);
    }
  }

  return matches;
}

/**
 * Locate the PDF latexmk actually emitted. Logs are checked first because they
 * describe the compiler's real output, followed by the configured nested path,
 * latexmk's historical root-level path, and finally a recursive basename scan.
 */
export async function findGeneratedPdf(
  buildDir: string,
  mainFile: string,
  logs: string
): Promise<string | null> {
  const pdfRelativePath = mainFile.replace(/\.tex$/i, ".pdf");
  const pdfName = path.basename(pdfRelativePath);
  const candidatePaths = [
    ...getLoggedPdfPaths(logs),
    pdfRelativePath,
    pdfName,
  ];
  const checked = new Set<string>();

  for (const candidate of candidatePaths) {
    const resolved = resolveBuildPath(buildDir, candidate);
    if (!resolved || checked.has(resolved)) continue;
    checked.add(resolved);

    if (await isPdfFile(resolved)) {
      return resolved;
    }
  }

  try {
    const matchingPdfs = await findPdfByName(buildDir, pdfName);
    const withStats = await Promise.all(
      matchingPdfs.map(async (filePath) => ({
        filePath,
        modifiedAt: (await fs.stat(filePath)).mtimeMs,
      }))
    );
    withStats.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return withStats[0]?.filePath ?? null;
  } catch {
    return null;
  }
}
