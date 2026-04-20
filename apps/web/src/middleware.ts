import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/forgot"]);
const AUTH_PATHS = new Set(["/login", "/register", "/forgot"]);

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/reset/")
  );
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.has(pathname) || pathname.startsWith("/reset/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes and static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get("session")?.value;

  if (!sessionToken && !isPublic(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (sessionToken && isAuthPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
