import {db} from "@/lib/db";
import {labels, projectLabels, projects} from "@/lib/db/schema";
import {withAuth} from "@/lib/auth/middleware";
import {eq, and} from "drizzle-orm";
import {NextRequest, NextResponse} from "next/server";
import { Label } from "@radix-ui/react-dropdown-menu";

// ─── PUT /api/labels/detach ────────────────────────────
// Detach an existing label to a project.

export async function PUT(request: NextRequest) {
    return withAuth(request, async (req, user) => {
        try {
            const body = await req.json();

            const projectId: string =
                typeof body?.projectId === "string" ? body.projectId.trim() : "";

            const labelId: string =
                typeof body?.labelId === "string" ? body.projectId.trim() : "";

            // Check if label is already attached to the project
            const [existing] = await db
                .select()
                .from(projectLabels)
                .where(
                    and(
                        eq(projectLabels.labelId, labelId),
                        eq(projectLabels.projectId, projectId)
                    )
                )
                .limit(1);

            if (!existing) {
                return NextResponse.json(
                    {error: "This label is not attached to this project."},
                    {status: 404}
                );
            }

            // Detach the label from the project
            const [projectLabel] = await db
                .delete(projectLabels)
                .where(eq(projectLabels.id, existing.id))
                .returning();
            
            // If that was the last project using this label, delete the label as well
            const [remaining] = await db
                .select()
                .from(projectLabels)
                .where(eq(projectLabels.labelId, labelId))
                .limit(1);
            
            if(!remaining) {
                await db
                    .delete(labels)
                    .where(
                        and(
                            eq(labels.id, labelId),
                            eq(labels.userId, user.id)
                        )
                    );
                }

            return NextResponse.json({...projectLabel, deletedLabel: !remaining}, {status: 200});
        } catch (error) {
            console.error("Error detaching label:", error);
            return NextResponse.json(
                {error: "Internal server error"},
                {status: 500}
            );
        }
    });
}
