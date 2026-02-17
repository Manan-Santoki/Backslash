import { resolveProjectAccess } from "@/lib/auth/project-access";
import * as storage from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/projects/[projectId]/pdf ─────────────
// Serve the compiled PDF for a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
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
    const download = request.nextUrl.searchParams.get("download") === "true";

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
}
