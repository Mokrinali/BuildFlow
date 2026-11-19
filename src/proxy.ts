import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/** Paths reachable without a session cookie. */
const PUBLIC_PATH = /^\/(login|api\/auth)(\/|$)/;

export function proxy(request: NextRequest) {
  // Fast redirect for visitors without a session cookie. This is only a UX shortcut: every page
  // and action still verifies the session on the server.
  if (!PUBLIC_PATH.test(request.nextUrl.pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const isDev = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Static files need neither the session check nor a CSP.
  matcher: [
    "/((?!_next/static|_next/image|favicon|icons|brand|apple-touch-icon|manifest.webmanifest).*)",
  ],
};
