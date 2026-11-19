import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { buildCsp, proxy } from "./proxy";

describe("content security policy", () => {
  it("allows only nonce-carrying scripts in production", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds unsafe-eval only in development", () => {
    expect(buildCsp("x", true)).toContain("'unsafe-eval'");
    expect(buildCsp("x", true)).not.toContain("upgrade-insecure-requests");
  });

  it("uses a fresh nonce per request and passes it to the render", () => {
    const a = proxy(new NextRequest("http://localhost/login"));
    const b = proxy(new NextRequest("http://localhost/login"));
    const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
    expect(nonceOf(a.headers.get("content-security-policy"))).toBeTruthy();
    expect(nonceOf(a.headers.get("content-security-policy"))).not.toBe(
      nonceOf(b.headers.get("content-security-policy")),
    );
    // NextResponse.next({ request: { headers } }) forwards overridden request headers this way.
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(
      nonceOf(a.headers.get("content-security-policy")),
    );
  });

  it("redirects visitors without a session to the login page", () => {
    const res = proxy(new NextRequest("http://localhost/orders"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
    expect(proxy(new NextRequest("http://localhost/api/auth/sign-in/email")).status).toBe(200);
  });
});
