import { enforceRateLimit } from "../../../../lib/rate-limit";
vi.mock("../../../../lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  brandForTenant: vi.fn(),
  currentSession: vi.fn(),
  currentTenant: vi.fn(),
  enabledRemoteModule: vi.fn(),
  fetch: vi.fn(),
  moduleAccessPolicy: vi.fn(),
  resolvePermissions: vi.fn(),
  signModuleContext: vi.fn(),
}));

vi.mock("@opentenant/security", () => ({ signModuleContext: harness.signModuleContext }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock("../../../../lib/brand", () => ({ brandForTenant: harness.brandForTenant }));
vi.mock("../../../../lib/session", () => ({ currentSession: harness.currentSession }));
vi.mock("../../../../lib/tenant", () => ({ currentTenant: harness.currentTenant }));
vi.mock("../../../../lib/module-registry", () => ({
  enabledRemoteModule: harness.enabledRemoteModule,
}));
vi.mock("../../../../lib/module-access", () => ({
  accessCookieName: vi.fn(),
  hasValidAccessGrant: vi.fn(),
  moduleAccessPolicy: harness.moduleAccessPolicy,
  resolvePermissions: harness.resolvePermissions,
}));

import { GET, POST } from "./route";

describe("remote module route key contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MODULE_SIGNING_PRIVATE_KEY", "synthetic-private-key");
    vi.stubGlobal("fetch", harness.fetch);
    harness.currentTenant.mockResolvedValue({ tenantId: "ten_example" });
    harness.enabledRemoteModule.mockResolvedValue(null);
    harness.moduleAccessPolicy.mockResolvedValue({ mode: "identity", passcodeHash: null });
    harness.currentSession.mockResolvedValue({
      activeTenantId: "ten_example",
      isPlatformAdmin: false,
      userId: "user_example",
    });
    harness.resolvePermissions.mockResolvedValue(["shared-insights.use"]);
    harness.brandForTenant.mockResolvedValue({
      displayName: "Example",
      logoUrl: null,
      cssBrandKey: "example",
    });
    harness.signModuleContext.mockReturnValue("trusted-signed-context");
    harness.fetch.mockResolvedValue(new Response("upstream", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves a valid 64-character key through the registry", async () => {
    const moduleKey = `m${"a".repeat(63)}`;
    const response = await GET(
      new Request(`https://tenant.example.test/m/${moduleKey}`),
      { params: Promise.resolve({ module: moduleKey }) },
    );

    expect(response.status).toBe(404);
    expect(harness.enabledRemoteModule).toHaveBeenCalledWith("ten_example", moduleKey);
  });

  it("rejects a 65-character key before registry resolution", async () => {
    const moduleKey = `m${"a".repeat(64)}`;
    const response = await GET(
      new Request(`https://tenant.example.test/m/${moduleKey}`),
      { params: Promise.resolve({ module: moduleKey }) },
    );

    expect(response.status).toBe(404);
    expect(harness.enabledRemoteModule).not.toHaveBeenCalled();
  });

  it.each(["//evil.example", "https://evil.example"])(
    "rejects decoded catch-all segment %s before signing or fetching",
    async (segment) => {
      harness.enabledRemoteModule.mockResolvedValue({
        moduleKey: "shared-insights",
        version: "1.1.0",
        remoteUrl: "https://module.example.test/base",
      });

      const response = await GET(
        new Request("https://tenant.example.test/m/shared-insights"),
        { params: Promise.resolve({ module: "shared-insights", path: [segment] }) },
      );

      expect(response.status).toBe(404);
      expect(harness.signModuleContext).not.toHaveBeenCalled();
      expect(harness.fetch).not.toHaveBeenCalled();
    },
  );

  it("forwards only safe content headers plus a newly signed module context", async () => {
    harness.enabledRemoteModule.mockResolvedValue({
      moduleKey: "shared-insights",
      version: "1.1.0",
      remoteUrl: "https://module.example.test/base",
    });
    const inbound = new Headers({
      accept: "application/json",
      authorization: "Bearer must-not-leak",
      cookie: "platform_session=must-not-leak",
      "content-type": "application/json",
      "proxy-authorization": "Basic must-not-leak",
      "x-custom-secret": "must-not-leak",
      "x-opentenant-module-context": "spoofed-context",
    });

    const response = await GET(
      new Request("https://tenant.example.test/m/shared-insights/view?tab=one", { headers: inbound }),
      { params: Promise.resolve({ module: "shared-insights", path: ["view"] }) },
    );

    expect(response.status).toBe(200);
    expect(harness.signModuleContext).toHaveBeenCalledWith(
      expect.objectContaining({ moduleKey: "shared-insights", moduleVersion: "1.1.0" }),
      "synthetic-private-key",
    );
    expect(harness.fetch).toHaveBeenCalledOnce();
    const [target, init] = harness.fetch.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe("https://module.example.test/base/view?tab=one");
    const outbound = init.headers as Headers;
    expect(outbound.get("accept")).toBe("application/json");
    expect(outbound.get("content-type")).toBe("application/json");
    expect(outbound.get("x-opentenant-module-context")).toBe("trusted-signed-context");
    expect(outbound.get("authorization")).toBeNull();
    expect(outbound.get("proxy-authorization")).toBeNull();
    expect(outbound.get("cookie")).toBeNull();
    expect(outbound.get("x-custom-secret")).toBeNull();
  });

  it("serves module output in an opaque sandbox without upstream encoding or worker scope", async () => {
    harness.enabledRemoteModule.mockResolvedValue({
      moduleKey: "shared-insights",
      version: "1.1.0",
      remoteUrl: "https://module.example.test/base",
    });
    harness.fetch.mockResolvedValue(new Response("decoded body", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-encoding": "gzip",
        "content-length": "12",
        "service-worker-allowed": "/",
        "content-security-policy": "default-src *",
        "set-cookie": "opentenant_session=forged",
      },
    }));

    const response = await GET(
      new Request("https://tenant.example.test/m/shared-insights"),
      { params: Promise.resolve({ module: "shared-insights" }) },
    );

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts/u);
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    for (const name of ["content-encoding", "content-length", "service-worker-allowed", "set-cookie"]) {
      expect(response.headers.get(name)).toBeNull();
    }
    expect(await response.text()).toBe("decoded body");
  });
});


describe("untrusted module response boundary", () => {
  const ctx = { params: Promise.resolve({ module: "shared-insights" }) };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", harness.fetch);
    vi.stubEnv("MODULE_SIGNING_PRIVATE_KEY", "synthetic-private-key");
    harness.currentTenant.mockResolvedValue({ tenantId: "ten_example" });
    harness.enabledRemoteModule.mockResolvedValue({ remoteUrl: "https://module.example.test/", version: "1" });
    harness.moduleAccessPolicy.mockResolvedValue({ mode: "identity" });
    harness.currentSession.mockResolvedValue({ activeTenantId: "ten_example", userId: "user_example" });
    harness.resolvePermissions.mockResolvedValue([]);
    harness.brandForTenant.mockResolvedValue({ displayName: "Example" });
    harness.fetch.mockResolvedValue(new Response("ok"));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("allows only content metadata and forces private caching", async () => {
    const unsafe = ["nel", "report-to", "reporting-endpoints", "strict-transport-security", "alt-svc",
      "accept-ch", "critical-ch", "origin-agent-cluster", "cdn-cache-control", "vercel-cdn-cache-control",
      "surrogate-control", "refresh", "link", "access-control-allow-origin", "x-unknown"];
    const headers = new Headers(Object.fromEntries(unsafe.map((name) => [name, "untrusted"])));
    for (const name of ["content-type", "content-language", "etag", "last-modified", "vary"]) headers.set(name, "metadata");
    headers.set("cache-control", "public, max-age=86400");
    harness.fetch.mockResolvedValue(new Response("ok", { headers }));
    const response = await GET(new Request("https://tenant.example.test/m/shared-insights/"), ctx);
    for (const name of unsafe) expect(response.headers.get(name), name).toBeNull();
    for (const name of ["content-type", "content-language", "etag", "last-modified", "vary"]) expect(response.headers.get(name)).toBe("metadata");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it.each(["https://evil.example.test", "http://tenant.example.test", "null"])("rejects mutating requests from %s before signing", async (origin) => {
    const response = await POST(new Request("https://tenant.example.test/m/shared-insights/", { method: "POST", headers: { origin } }), ctx);
    expect(response.status).toBe(403);
    expect(harness.signModuleContext).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("retains same-origin form posts", async () => {
    const response = await POST(new Request("https://tenant.example.test/m/shared-insights/", {
      method: "POST", headers: { origin: "https://tenant.example.test" }, body: "example",
    }), ctx);
    expect(response.status).toBe(200);
    expect(harness.fetch).toHaveBeenCalledOnce();
  });

  it.each(["https://evil.example.test/", "//evil.example.test/", "https://tenant.example.test/m/shared-insights/",
    "/auth/logout", "/m/other/", "/m/shared-insights-evil/", "/m/shared-insights/../../auth/logout",
    "/m/shared-insights/%2e%2e/other", "/m/shared-insights/%252e%252e/other", "/m/shared-insights/%2f..%2f..%2fauth", "/m/shared-insights/\\evil"])("drops unsafe redirect %s", async (location) => {
    harness.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    const response = await GET(new Request("https://tenant.example.test/m/shared-insights/"), ctx);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["/m/shared-insights/next?tab=one#part", "next?tab=one", "?tab=one"])("preserves module-local redirect %s", async (location) => {
    harness.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    const response = await GET(new Request("https://tenant.example.test/m/shared-insights/"), ctx);
    expect(response.headers.get("location")).toBe(new URL(location, "https://tenant.example.test/m/shared-insights/").pathname + new URL(location, "https://tenant.example.test/m/shared-insights/").search + new URL(location, "https://tenant.example.test/m/shared-insights/").hash);
  });

  it("does not cache gate redirects or denials", async () => {
    harness.currentSession.mockResolvedValue(null);
    const response = await GET(new Request("https://tenant.example.test/m/shared-insights/"), ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not spend mutation budget on module pages or assets", async () => {
    expect((await GET(new Request("https://tenant.example.test/m/shared-insights/"), ctx)).status).toBe(200);
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 before signing or proxying a limited module mutation", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "12" } }));
    const response = await POST(new Request("https://tenant.example.test/m/shared-insights/", { method: "POST", headers: { origin: "https://tenant.example.test" } }), ctx);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(harness.signModuleContext).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

});
