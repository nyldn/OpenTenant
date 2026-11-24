import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("./tenant", () => ({ knownRequestHost: vi.fn(async () => true), TENANT_OVERRIDE_COOKIE: "opentenant_dev_tenant" }));
vi.mock("./identity-provider", () => ({ usesClerkIdentity: () => false }));
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: vi.fn() }));
import { middleware } from "../middleware";
afterEach(() => vi.unstubAllEnvs());
it.each(["/auth/login?return=%2Fsupport", "/auth/callback?code=synthetic", "/settings/domains", "/api/settings/connections/google/callback?code=synthetic", "/sign-in"])("routes custom identity surface %s through ownership validation", async (path) => {
  vi.stubEnv("OPENTENANT_TENANT_BASE_DOMAIN", "platform.test");
  const response = await middleware(new NextRequest(`https://app.customer.test${path}`, { headers: { host: "app.customer.test", "x-opentenant-host": "alpha.platform.test" } }));
  const target = new URL(response!.headers.get("x-middleware-rewrite")!);
  expect(target.hostname).toBe("app.customer.test");
  expect(target.pathname).toBe("/api/settings/domains/auth");
  expect(target.searchParams.get("path")).toBe(path);
});
it("leaves platform identity and public custom pages on their origin", async () => {
  vi.stubEnv("OPENTENANT_TENANT_BASE_DOMAIN", "platform.test");
  for (const url of ["https://alpha.platform.test/auth/login", "https://app.customer.test/support"]) {
    const parsed = new URL(url);
    const response = await middleware(new NextRequest(url, { headers: { host: parsed.host } }));
    expect(response!.headers.get("x-middleware-rewrite")).toBeNull();
  }
});

it("normalizes the platform base before classifying identity routes", async () => {
  vi.stubEnv("OPENTENANT_TENANT_BASE_DOMAIN", "PLATFORM.TEST");
  const response = await middleware(new NextRequest("https://alpha.platform.test/auth/login", { headers: { host: "alpha.platform.test" } }));
  expect(response!.headers.get("x-middleware-rewrite")).toBeNull();
});
