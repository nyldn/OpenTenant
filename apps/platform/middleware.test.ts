import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const clerkRequest = vi.fn();
  return {
    knownRequestHost: vi.fn(async () => true),
    usesClerkIdentity: vi.fn(),
    clerkRequest,
    clerkMiddleware: vi.fn((callback: (auth: unknown, request: unknown) => unknown) => (
      request: unknown,
    ) => {
      clerkRequest(request);
      return callback({}, request);
    }),
  };
});

vi.mock("./lib/tenant", () => ({ knownRequestHost: mocks.knownRequestHost, TENANT_OVERRIDE_COOKIE: "opentenant_dev_tenant" }));
vi.mock("./lib/identity-provider", () => ({ usesClerkIdentity: mocks.usesClerkIdentity }));
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: mocks.clerkMiddleware }));

import { config, hostSecurityMiddleware, middleware } from "./middleware";

describe("platform middleware", () => {
  it.each(["/api/health", "/api/ready"])("keeps host validation on %s", (path) => {
    const good = new NextRequest(`https://alpha.tenants.example.org${path}`, { headers: { host: "alpha.tenants.example.org" } });
    const bad = new NextRequest(`https://alpha.tenants.example.org${path}`, { headers: { host: "bad host" } });
    expect(hostSecurityMiddleware(good).status).toBe(200);
    expect(hostSecurityMiddleware(bad).status).toBe(404);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usesClerkIdentity.mockReturnValue(false);
    mocks.knownRequestHost.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves malformed-host denial", () => {
    const request = new NextRequest("https://tenant.example.test/", {
      headers: { host: "bad host" },
    });

    expect(hostSecurityMiddleware(request).status).toBe(404);
  });

  it("accepts bare localhost only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new NextRequest("http://localhost:3000/", {
      headers: { host: "localhost:3000" },
    });

    expect(hostSecurityMiddleware(request).status).toBe(200);
  });

  it("rejects bare localhost in production despite retained development settings", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "localhost");
    vi.stubEnv("PLATFORM_DEFAULT_TENANT_ID", "tenant_local");
    const request = new NextRequest("http://localhost:3000/", {
      headers: { host: "localhost:3000" },
    });

    expect(hostSecurityMiddleware(request).status).toBe(404);
  });

  it("strips the reserved header namespace", () => {
    const request = new NextRequest("https://tenant.example.test/", {
      headers: {
        host: "tenant.example.test",
        authorization: "Bearer signed-module-context",
        "x-opentenant-host": "spoofed.example.test",
        "x-opentenant-evil": "spoofed",
      },
    });

    const response = hostSecurityMiddleware(request);
    const overrides = response.headers.get("x-middleware-override-headers") ?? "";
    expect(overrides).not.toContain("x-opentenant-evil");
    expect(response.headers.get("x-middleware-request-x-opentenant-host")).toBe(
      "tenant.example.test",
    );
    expect(response.headers.get("x-middleware-request-authorization")).toBe(
      "Bearer signed-module-context",
    );
  });

  it("keeps Developer MCP proof headers that live outside the reserved namespace", async () => {
    const { DEVELOPER_MCP_CONFIRMATION_HEADER, DEVELOPER_MCP_PREVIEW_HEADER } = await import("@opentenant/developer-mcp");
    for (const name of [DEVELOPER_MCP_CONFIRMATION_HEADER, DEVELOPER_MCP_PREVIEW_HEADER]) {
      expect(name.startsWith("x-opentenant-")).toBe(false);
    }
    const request = new NextRequest("https://tenant.example.test/api/mcp/developer", {
      headers: {
        host: "tenant.example.test",
        [DEVELOPER_MCP_CONFIRMATION_HEADER]: "confirmation-proof",
        [DEVELOPER_MCP_PREVIEW_HEADER]: "preview-handle",
        "x-opentenant-confirmation": "spoofed",
      },
    });

    const response = hostSecurityMiddleware(request);
    expect(response.headers.get(`x-middleware-request-${DEVELOPER_MCP_CONFIRMATION_HEADER}`)).toBe("confirmation-proof");
    expect(response.headers.get(`x-middleware-request-${DEVELOPER_MCP_PREVIEW_HEADER}`)).toBe("preview-handle");
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-opentenant-confirmation");
  });

  it("uses Clerk middleware only for Clerk deployments", async () => {
    const request = new NextRequest("https://tenant.example.test/", {
      headers: { host: "tenant.example.test" },
    });
    mocks.usesClerkIdentity.mockReturnValue(true);

    await middleware(request);

    expect(mocks.clerkMiddleware).toHaveBeenCalledOnce();
  });

  it("denies malformed Clerk requests before authentication", async () => {
    const request = new NextRequest("https://tenant.example.test/", {
      headers: { host: "bad host" },
    });
    mocks.usesClerkIdentity.mockReturnValue(true);

    const response = await middleware(request);

    expect(response?.status).toBe(404);
    expect(mocks.clerkRequest).not.toHaveBeenCalled();
  });

  it("strips reserved headers before Clerk authentication", async () => {
    const request = new NextRequest("https://tenant.example.test/", {
      headers: {
        host: "tenant.example.test",
        authorization: "Bearer signed-module-context",
        "x-opentenant-evil": "spoofed",
      },
    });
    mocks.usesClerkIdentity.mockReturnValue(true);

    await middleware(request);

    const seen = mocks.clerkRequest.mock.calls.at(-1)?.[0] as NextRequest;
    expect(seen.headers.get("x-opentenant-evil")).toBeNull();
    expect(seen.headers.get("x-opentenant-host")).toBe("tenant.example.test");
    expect(seen.headers.get("authorization")).toBe("Bearer signed-module-context");
  });

  it("includes the Clerk auto-proxy matcher once after API/TRPC", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|opentenant-logo[.]svg$).*)",
      "/(api|trpc)(.*)",
      "/__clerk/:path*",
    ]);
  });
});

it("rejects an unknown host before authentication and strips trusted path spoofing", async () => {
  mocks.knownRequestHost.mockResolvedValueOnce(false);
  const response = await middleware(new NextRequest("https://unknown.example.test/", { headers: { host: "unknown.example.test" } }));
  expect(response?.status).toBe(404);
  expect(await response?.text()).toContain("<!doctype html>");
  expect(mocks.clerkRequest).not.toHaveBeenCalled();
});

it("fails closed with generic HTML when host resolution fails", async () => {
  mocks.knownRequestHost.mockRejectedValueOnce(new Error("private driver failure"));
  const response = await middleware(new NextRequest("https://unknown.example.test/", { headers: { host: "unknown.example.test" } }));
  expect(response?.status).toBe(404);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response?.text()).not.toContain("private driver failure");
});

it("lets health and readiness probes through with any host, still stripping trusted headers", async () => {
  mocks.knownRequestHost.mockClear().mockResolvedValue(false);
  for (const path of ["/api/health", "/api/ready"]) {
    const response = await middleware(new NextRequest(`http://health.localhost${path}`, { headers: { host: "health.localhost", "x-opentenant-tenant": "spoofed" } }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-middleware-request-x-opentenant-tenant")).toBeNull();
  }
  expect(mocks.knownRequestHost).not.toHaveBeenCalled();
  const other = await middleware(new NextRequest("http://health.localhost/api/healthz", { headers: { host: "health.localhost" } }));
  expect(other?.status).toBe(404);
  mocks.knownRequestHost.mockResolvedValue(true);
});
