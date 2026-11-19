import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/** Paths reachable without a session cookie. */
const PUBLIC_PATH = /^\/(login|api\/auth)(\/|$)/;

/**
 * Content Security Policy with a fresh nonce per request. Next.js reads the nonce from the
 * request's CSP header and puts it on its own scripts, so only those scripts run: an injected
 * <script> or inline handler is blocked. Styles allow 'unsafe-inline' because React style
 * attributes cannot carry a nonce; injected CSS cannot run code.
 * Every page is rendered per request (the root layout awaits connection()), as nonces require.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // React needs eval in development only, for its error overlay and stack reconstruction.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  // Fast redirect for visitors without a session cookie. This is only a UX shortcut: every page
  // and action still verifies the session on the server.
  if (!PUBLIC_PATH.test(request.nextUrl.pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

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
