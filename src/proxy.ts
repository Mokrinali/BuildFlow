import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Fast redirect for visitors without a session cookie.
// This is only a UX shortcut: every page and action still verifies the session on the server.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon|icons|brand|apple-touch-icon|manifest.webmanifest).*)",
  ],
};
