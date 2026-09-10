import { NextResponse } from "next/server";
import { DEMO_DISABLED_FEATURES, demoConfig } from "@/lib/demo";

/**
 * Public, unauthenticated demo metadata.
 *
 * The client uses this to render the demo banner and hide surfaces that are
 * switched off, so there is a single source of truth (DEMO_MODE) instead of a
 * second NEXT_PUBLIC_* flag that could drift out of sync.
 */
export async function GET() {
  if (!demoConfig.enabled) {
    return NextResponse.json({ demo: false });
  }

  return NextResponse.json({
    demo: true,
    ttlHours: demoConfig.ttlHours,
    compilesPerHour: demoConfig.compilesPerHour,
    disabled: DEMO_DISABLED_FEATURES,
  });
}
