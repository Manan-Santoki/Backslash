import {
  getSessionToken,
  deleteSession,
  clearSessionCookie,
} from "@/lib/auth/session";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const token = await getSessionToken();

    if (token) {
      await deleteSession(token);
    }

    await clearSessionCookie();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
