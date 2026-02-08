import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { withAuth } from "@/lib/auth/middleware";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import * as storage from "@/lib/storage";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId]/pdf ─────────────
// Serve the compiled PDF for a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withAuth(request, async (req, user) => {
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

      // Resolve the PDF path on disk (use project owner's directory)
      const pdfPath = storage.getPdfPath(project.userId, projectId, project.mainFile);
      const exists = await storage.fileExists(pdfPath);

      if (!exists) {
        return NextResponse.json(
          { error: "PDF not found. Please compile the project first." },
          { status: 404 }
        );
      }

      const pdfBuffer = await storage.readFileBinary(pdfPath);
      const pdfName = project.mainFile.replace(/\.tex$/, ".pdf");

      // Support ?download=true for Content-Disposition: attachment
      const download = req.nextUrl.searchParams.get("download") === "true";

      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Content-Length": pdfBuffer.length.toString(),
      };

      if (download) {
        headers["Content-Disposition"] =
          `attachment; filename="${pdfName}"`;
      } else {
        headers["Content-Disposition"] =
          `inline; filename="${pdfName}"`;
      }

      return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
      console.error("Error serving PDF:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
