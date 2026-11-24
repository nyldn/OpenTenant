import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizationSyncEnabled, queueEntitlementSync, queueManifestPublication, queueMembershipSync, runConfiguredAuthorizationOutbox } from "./authz-lifecycle";
import { runAuthorizationOutbox } from "./authz-outbox";
vi.mock("../opentenant-modules", () => ({ installedModules: { get: () => undefined } }));
afterEach(() => vi.unstubAllEnvs());
describe("optional authorization lifecycle composition", () => {
  it("is a verified no-op by default without any database or port calls", async () => {
    vi.stubEnv("AUTHZ_PROVIDER", "in-process");
    const client = { query: vi.fn().mockRejectedValue(new Error("must not read outbox")) };
    const pool = { connect: vi.fn().mockRejectedValue(new Error("must not connect")) };
    await queueMembershipSync(client, { tenantId: "ten_a", userId: "user_a", role: "tenant_owner", active: true });
    await queueEntitlementSync(client, { tenantId: "ten_a", moduleKey: "example" });
    await queueManifestPublication(client, { key: "example", version: "1", runtime: "native", permissions: [], navigation: [] });
    expect(await runAuthorizationOutbox({ pool, tenantId: "ten_a" })).toEqual({ delivered: 0, failed: 0, noop: true });
    expect(await runConfiguredAuthorizationOutbox("ten_a")).toEqual({ delivered: 0, failed: 0, noop: true });
    expect(client.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
    expect(authorizationSyncEnabled({})).toBe(false);
  });
  it("rejects unknown or incomplete provider configuration", () => {
    expect(() => authorizationSyncEnabled({ AUTHZ_PROVIDER: "typo" })).toThrow("configuration");
    expect(() => authorizationSyncEnabled({ AUTHZ_PROVIDER: "openfga" })).toThrow("configuration");
    expect(authorizationSyncEnabled({ AUTHZ_PROVIDER: "openfga", OPENFGA_API_URL: "http://127.0.0.1:1", OPENFGA_STORE_ID: "synthetic", OPENFGA_MODEL_ID: "synthetic" })).toBe(true);
  });
});
