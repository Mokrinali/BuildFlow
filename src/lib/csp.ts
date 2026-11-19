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
