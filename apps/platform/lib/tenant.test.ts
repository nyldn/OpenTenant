import { productionConfig } from "../test/production-config";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const mocks = vi.hoisted(() => ({
  span: vi.fn((_name: string, work: () => unknown) => work()),
  query: vi.fn(),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
  cookieGet: vi.fn(() => undefined as { value: string } | undefined),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
  headers: mocks.headers,
}));

vi.mock("pg", () => ({
  Pool: class {
    query = mocks.query;
  },
}));

vi.mock("@opentenant/observability/tracing", () => ({ traceSpan: mocks.span }));

import { currentTenant, knownRequestHost } from "./tenant";

describe("currentTenant", () => {
  it("traces tenant resolution without recording host or identifiers", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await currentTenant();
    expect(mocks.span).toHaveBeenCalledWith("tenant.resolve", expect.any(Function));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.query.mockReset();
    mocks.headers.mockReset().mockResolvedValue(new Headers({ host: "localhost:3000" }));
    mocks.cookieGet.mockReset().mockReturnValue(undefined);
  });

  it("resolves the configured default tenant on plain localhost", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    vi.stubEnv("PLATFORM_DEFAULT_TENANT_ID", "tenant_local");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from domains d")) return { rows: [] };
      return { rows: [{ slug: "local", display_name: "OpenTenant Local", status: "active" }] };
    });


    await expect(currentTenant()).resolves.toEqual({
      tenantId: "tenant_local",
      slug: "local",
      displayName: "OpenTenant Local",
      status: "active",
    });
  });

  it("binds a launched tenant only through the verified request host resolver", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    mocks.headers.mockResolvedValueOnce(new Headers({
      host: "alpha.example.test",
      "x-tenant": "tenant_hostile",
      cookie: "activeTenant=tenant_hostile",
    }));
    mocks.query.mockResolvedValueOnce({
      rows: [{
        tenantId: "tenant_alpha",
        slug: "alpha",
        displayName: "Alpha",
        status: "active",
        active: true,
      }],
    });

    await expect(currentTenant()).resolves.toMatchObject({ tenantId: "tenant_alpha" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("from domains d");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["alpha.example.test"]);
  });

  it("ignores retained development settings in production", async () => {
    for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "preview.example.test");
    vi.stubEnv("PLATFORM_DEFAULT_TENANT_ID", "tenant_local");
    mocks.headers.mockResolvedValueOnce(new Headers({ host: "missing.preview.example.test" }));
    mocks.cookieGet.mockReturnValue({ value: "local" });
    mocks.query.mockResolvedValue({ rows: [] });


    await expect(currentTenant()).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("from domains d");
    expect(mocks.cookieGet).not.toHaveBeenCalled();
  });

  it("keeps verified-domain resolution first in production", async () => {
    for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "preview.example.test");
    vi.stubEnv("PLATFORM_DEFAULT_TENANT_ID", "tenant_local");
    mocks.headers.mockResolvedValueOnce(new Headers({ host: "verified.preview.example.test" }));
    mocks.cookieGet.mockReturnValue({ value: "local" });
    mocks.query.mockResolvedValueOnce({
      rows: [{
        tenantId: "tenant_verified",
        slug: "verified",
        displayName: "Verified Tenant",
        status: "active",
        active: true,
      }],
    });


    await expect(currentTenant()).resolves.toMatchObject({ tenantId: "tenant_verified" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("from domains d");
    expect(mocks.cookieGet).not.toHaveBeenCalled();
  });

  it("uses a configured development suffix only at a hostname-label boundary", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "example.test");
    mocks.headers.mockResolvedValueOnce(new Headers({ host: "tenant.notexample.test" }));
    mocks.cookieGet.mockReturnValue({ value: "local" });
    mocks.query.mockResolvedValue({ rows: [] });


    await expect(currentTenant()).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.cookieGet).not.toHaveBeenCalled();
  });

  it("preserves a configured development suffix on a complete hostname label", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    vi.stubEnv("PLATFORM_DEV_HOST_SUFFIXES", "example.test");
    mocks.headers.mockResolvedValueOnce(new Headers({ host: "tenant.preview.example.test" }));
    mocks.cookieGet.mockReturnValue({ value: "local" });
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          tenantId: "tenant_local",
          slug: "local",
          displayName: "OpenTenant Local",
          status: "active",
        }],
      });


    await expect(currentTenant()).resolves.toEqual({
      tenantId: "tenant_local",
      slug: "local",
      displayName: "OpenTenant Local",
      status: "active",
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("from domains d");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("from tenants where slug");
  });
});

it("does not bootstrap unknown localhost names even with a tenant cookie", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PLATFORM_DEFAULT_TENANT_ID", "tenant_local");
  mocks.headers.mockResolvedValueOnce(new Headers({ host: "unknown.localhost" }));
  mocks.cookieGet.mockReturnValue({ value: "local" });
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(currentTenant()).resolves.toBeNull();
  expect(mocks.cookieGet).not.toHaveBeenCalled();
});

it("admits the configured administration host in production without a tenant domain", async () => {
  for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
  vi.stubEnv("PLATFORM_ADMIN_HOST", "admin.example.test");
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  await expect(knownRequestHost("admin.example.test")).resolves.toBe(true);
  expect(mocks.query).not.toHaveBeenCalled();
  await expect(knownRequestHost("unknown.example.test")).resolves.toBe(false);
  await expect(knownRequestHost("rogue.tenants.example.test", "tenant-a")).resolves.toBe(false);
  vi.unstubAllEnvs();
});
