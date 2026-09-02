import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import * as storage from "@/lib/storage";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function buildDownloadPdfName(projectName: string): string {
  const safeProjectName =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const unixEpoch = Math.floor(Date.now() / 1000);
  return `${safeProjectName}-${unixEpoch}.pdf`;
}

// ─── GET /api/v1/projects/[projectId]/pdf ───────────
// Download the compiled PDF for a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const pdfPath = storage.getPdfPath(user.id, projectId, project.mainFile);
      const exists = await storage.fileExists(pdfPath);

      if (!exists) {
        return NextResponse.json(
          { error: "PDF not found. Please compile the project first." },
          {
            status: 404,
            headers: { "Cache-Control": "private, no-store, max-age=0" },
          }
        );
      }

      const pdfBuffer = await storage.readFileBinary(pdfPath);
      const pdfName = buildDownloadPdfName(project.name);

      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfName}"`,
          "Content-Length": pdfBuffer.length.toString(),
          "Cache-Control": "private, no-store, max-age=0",
        },
      });
    } catch (error) {
      console.error("[API v1] Error serving PDF:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
