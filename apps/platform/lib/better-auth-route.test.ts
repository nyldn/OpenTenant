import { beforeEach, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ mode: "production", provider: "better-auth" }));
vi.mock("./server-config", () => ({ routingConfig: () => ({ NODE_ENV: config.mode }) }));
import { NextRequest } from "next/server";
vi.mock("./identity-provider", () => ({ identityProviderFromEnv: () => config.provider }));
import { betterAuthBrowserRoute, hostBoundRequest } from "./better-auth-route";
beforeEach(() => { vi.restoreAllMocks(); config.mode = "production"; config.provider = "better-auth"; });
it("adds nonce CSP only to browser GET login documents with a fresh nonce and sanitized host headers", () => {
  const request = new NextRequest("https://tenant.example.test/auth/better-auth/login?return=/settings/branding&invitation=synthetic");
  const trusted = new Headers({ "x-opentenant-host": "tenant.example.test" });
  const first = betterAuthBrowserRoute(request, trusted)!;
  const second = betterAuthBrowserRoute(request, trusted)!;
  expect(first.headers.get("x-middleware-rewrite")).toBeNull();
  const csp = first.headers.get("content-security-policy")!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+'/);
  expect(csp).toContain("form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  expect(first.headers.get("referrer-policy")).toBe("same-origin");
  expect(csp).not.toBe(second.headers.get("content-security-policy"));
  expect(first.headers.get("x-middleware-request-x-opentenant-host")).toBe("tenant.example.test");
  expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
});
it("leaves POST and JSON/provider API endpoints in their route handlers", () => {
  for (const request of [new NextRequest("https://tenant.example.test/auth/better-auth/login", { method: "POST" }), new NextRequest("https://tenant.example.test/auth/better-auth/login", { headers: { accept: "application/json" } }), new NextRequest("https://tenant.example.test/api/auth/better-auth/sign-in/email")]) expect(betterAuthBrowserRoute(request, new Headers())).toBeNull();
});

it("does not rewrite other providers or other browser paths", () => {
  const request = new NextRequest("https://tenant.example.test/auth/better-auth/login");
  for (const provider of ["local", "workos", "clerk"]) {
    config.provider = provider;
    expect(betterAuthBrowserRoute(request, new Headers())).toBeNull();
  }
  config.provider = "better-auth";
  for (const path of ["/settings/branding", "/api/auth/better-auth/sign-up/email", "/api/auth/better-auth/verify-email"]) {
    expect(betterAuthBrowserRoute(new NextRequest(`https://tenant.example.test${path}`), new Headers())).toBeNull();
  }
});

it("keeps nonce protection in development while allowing the webpack runtime", () => {
  config.mode = "development";
  const response = betterAuthBrowserRoute(new NextRequest("http://tenant.example.test/auth/better-auth/login"), new Headers())!;
  expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  const policy = response.headers.get("content-security-policy")!;
  expect(policy).toContain("'unsafe-eval'");
  expect(policy).toMatch(/'nonce-[A-Za-z0-9+/]+'/);
  expect(policy).not.toContain("unsafe-inline");
});

it("preserves protocol and port while binding to the middleware-validated Host", async () => {
  const request = new Request("https://localhost:4000/api/auth/better-auth/login?return=/settings", { method: "POST", headers: { host: "alpha.example.test:4000", "x-opentenant-host": "alpha.example.test", origin: "https://evil.example.test", "x-forwarded-host": "evil.example.test" }, body: "safe-form" });
  const bound = hostBoundRequest(request);
  expect(new URL(bound.url).origin).toBe("https://alpha.example.test:4000");
  expect(new URL(bound.url).search).toBe("?return=/settings");
  expect(await bound.text()).toBe("safe-form");
  expect(bound.headers.get("origin")).toBe("https://evil.example.test");
  const forged = new Request("https://localhost/api", { headers: { host: "evil.example.test", "x-opentenant-host": "alpha.example.test" } });
  expect(hostBoundRequest(forged)).toBe(forged);
});
