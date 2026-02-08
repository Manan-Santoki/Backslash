import { withAuth } from "@/lib/auth/middleware";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import * as storage from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";

// ─── GET /api/projects/[projectId]/download ────────
// Download the entire project as a ZIP archive.
// Accessible by owner and shared collaborators (any role).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const access = await checkProjectAccess(user.id, projectId);
      if (!access.access) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const project = access.project;

      const projectDir = storage.getProjectDir(project.userId, projectId);
      const dirExists = await storage.fileExists(projectDir);

      if (!dirExists) {
        return NextResponse.json(
          { error: "Project directory not found" },
          { status: 404 }
        );
      }

      // Sanitize the project name for use in the filename
      const safeName = project.name
        .replace(/[^a-zA-Z0-9_\-. ]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100);
      const zipFileName = `${safeName}.zip`;

      // Create the archive and pipe it through a PassThrough stream
      const archive = archiver("zip", { zlib: { level: 6 } });
      const passThrough = new PassThrough();

      archive.pipe(passThrough);
      archive.directory(projectDir, false);

      // Collect the archive into a buffer using the web-compatible approach
      const chunks: Buffer[] = [];

      const archivePromise = new Promise<Buffer>((resolve, reject) => {
        passThrough.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        passThrough.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
        passThrough.on("error", reject);
        archive.on("error", reject);
      });

      await archive.finalize();
      const zipBuffer = await archivePromise;

      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipFileName}"`,
          "Content-Length": zipBuffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Error downloading project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
