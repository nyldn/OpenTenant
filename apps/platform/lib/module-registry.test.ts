vi.mock("../opentenant-modules", () => ({ installedModules: { get: () => ({ manifest: { runtime: "native" }, catalog: { enabledByDefault: true } }) } }));
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("pg", () => ({
  Pool: class {
    query = harness.query;
  },
}));

import { enabledRemoteModule, nativeModuleEnabled } from "./module-registry";

describe("enabledRemoteModule", () => {
  beforeEach(() => {
    harness.query.mockReset();
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://control.example.test/opentenant");
    vi.stubEnv("MODULE_REMOTE_HOST_ALLOWLIST", "module.example.test");
  });

  it("resolves the tenant's explicit immutable artifact version", async () => {
    harness.query.mockResolvedValueOnce({ rows: [{
      module_key: "shared-insights",
      version: "2.0.0",
      remote_url: "https://module.example.test",
    }] });

    await expect(enabledRemoteModule("ten_alpha", "shared-insights")).resolves.toEqual({
      moduleKey: "shared-insights",
      version: "2.0.0",
      remoteUrl: "https://module.example.test",
    });
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining("mv.version = tm.module_version"),
      ["ten_alpha", "shared-insights"],
    );
    const sql = harness.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("mv.remote_url is not null");
    expect(sql).not.toContain("mc.remote_url is not null");
  });

  it("fails closed when no entitled version matches", async () => {
    harness.query.mockResolvedValueOnce({ rows: [] });
    await expect(enabledRemoteModule("ten_alpha", "shared-insights")).resolves.toBeNull();
  });

  it("fails closed before proxying unlisted or local destinations", async () => {
    harness.query.mockResolvedValueOnce({ rows: [{
      module_key: "shared-insights",
      version: "2.0.0",
      remote_url: "https://localhost/internal",
    }] });
    await expect(enabledRemoteModule("ten_alpha", "shared-insights")).resolves.toBeNull();

    harness.query.mockResolvedValueOnce({ rows: [{
      module_key: "shared-insights",
      version: "2.0.0",
      remote_url: "https://unlisted.example.test",
    }] });
    await expect(enabledRemoteModule("ten_alpha", "shared-insights")).resolves.toBeNull();
  });
});

describe("nativeModuleEnabled", () => {
  beforeEach(() => {
    harness.query.mockReset();
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://control.example.test/opentenant");
  });

  it("never applies a catalog default outside platform ownership", async () => {
    harness.query.mockResolvedValueOnce({ rows: [{
      enabled: null,
      enabled_by_default: true,
      ownership_scope: "tenant",
    }] });
    await expect(nativeModuleEnabled("ten_beta", "tenant-insights")).resolves.toBe(false);
    expect(harness.query.mock.calls[0]?.[0]).toContain("mc.ownership_scope");
  });

  it("preserves platform defaults and explicit tenant entitlement decisions", async () => {
    harness.query.mockResolvedValueOnce({ rows: [{
      enabled: null,
      enabled_by_default: true,
      ownership_scope: "platform",
    }] });
    await expect(nativeModuleEnabled("ten_beta", "sample")).resolves.toBe(true);

    harness.query.mockResolvedValueOnce({ rows: [{
      enabled: false,
      enabled_by_default: true,
      ownership_scope: "platform",
    }] });
    await expect(nativeModuleEnabled("ten_beta", "sample")).resolves.toBe(false);
  });
});
