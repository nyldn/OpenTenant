import { afterEach, expect, it, vi } from "vitest";
import config from "./next.config";
import type { NextConfig } from "next";
afterEach(() => { vi.unstubAllEnvs(); });

it("rejects e2e composition before a production build can include it", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPENTENANT_E2E", "1");
  vi.resetModules();
  await expect(import("./next.config")).rejects.toThrow("OPENTENANT_E2E");
});
it("protects platform pages from cross-origin framing", async () => {
  const headers = await (config as unknown as NextConfig).headers?.();
  expect(headers).toContainEqual({ source: "/:path((?!m(?:/|$)|api/mcp/developer(?:/|$)|api/auth/better-auth(?:/|$)).*)", headers: expect.arrayContaining([
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ]) });
});

it("never applies the platform CSP to module proxy paths, which carry their own sandbox", async () => {
  // Next's own compiled matcher; it ships without type declarations.
  // @ts-expect-error untyped internal module
  const { pathToRegexp } = (await import("next/dist/compiled/path-to-regexp")) as {
    pathToRegexp: (source: string, keys: unknown[], options: object) => RegExp;
  };
  const headers = (await (config as unknown as NextConfig).headers?.()) ?? [];
  for (const rule of headers) {
    const matcher = pathToRegexp(rule.source, [], {});
    for (const path of ["/m", "/m/", "/m/support", "/m/support/a/b", "/api/mcp/developer", "/api/mcp/developer/confirm", "/api/auth/better-auth/login"]) expect(matcher.test(path)).toBe(false);
    for (const path of ["/", "/settings", "/admin/audit", "/media"]) expect(matcher.test(path)).toBe(true);
  }
});
