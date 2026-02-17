import {db} from "@/lib/db";
import {labels, projectLabels, projects} from "@/lib/db/schema";
import {withAuth} from "@/lib/auth/middleware";
import {eq, and} from "drizzle-orm";
import {NextRequest, NextResponse} from "next/server";

// ─── PUT /api/labels/attach ────────────────────────────
// Attach a label to a project by name. Creates the label if it doesn't exist.

export async function PUT(request: NextRequest) {
    return withAuth(request, async (req, user) => {
        try {
            const body = await req.json();

            const projectId: string =
                typeof body?.projectId === "string" ? body.projectId.trim() : "";

            const labelName: string =
                typeof body?.labelName === "string" ? body.labelName.trim() : "";

            if (!labelName) {
                return NextResponse.json(
                    {error: "Label name is required"},
                    {status: 400}
                );
            }

            // Verify the project exists and user has access
            const [project] = await db
                .select()
                .from(projects)
                .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
                .limit(1);

            if (!project) {
                return NextResponse.json(
                    {error: "Project not found or access denied"},
                    {status: 404}
                );
            }

            // Find or create the label
            let [label] = await db
                .select()
                .from(labels)
                .where(and(eq(labels.name, labelName), eq(labels.userId, user.id)))
                .limit(1);

            if (!label) {
                // Create new label if it doesn't exist
                [label] = await db
                    .insert(labels)
                    .values({
                        name: labelName,
                        userId: user.id,
                    })
                    .returning();
            }

            // Check if label is already attached to the project
            const [existing] = await db
                .select()
                .from(projectLabels)
                .where(
                    and(
                        eq(projectLabels.labelId, label.id),
                        eq(projectLabels.projectId, projectId)
                    )
                )
                .limit(1);

            if (existing) {
                return NextResponse.json(
                    {error: "Label is already attached to this project"},
                    {status: 409}
                );
            }

            // Attach the label to the project
            const [projectLabel] = await db
                .insert(projectLabels)
                .values({
                    labelId: label.id,
                    projectId,
                })
                .returning();

            return NextResponse.json({projectLabel, label}, {status: 200});
        } catch (error) {
            console.error("Error attaching label:", error);
            return NextResponse.json(
                {error: "Internal server error"},
                {status: 500}
            );
        }
    });
}