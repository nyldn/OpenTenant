import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import { moduleOwnershipStore, seedInstalledModuleCatalog } from "./module-registry";

const state = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("./control-plane", () => ({
  controlPlanePool: () => ({ connect: async () => state }),
  withControlPlaneTransaction: async (work: (client: PoolClient) => Promise<unknown>) => work(state as unknown as PoolClient),
}));
const manifest = vi.hoisted(() => ({ key: "example", version: "1.0.0", runtime: "native" as const, navigation: [], permissions: ["example.use"], rolePermissions: { tenant_member: ["example.use"] } }));
vi.mock("../opentenant-modules", () => ({ installedModules: {
  modules: [{ manifest, catalog: { enabledByDefault: false } }], get: () => undefined,
} }));
const assigned = { moduleKey: "example", version: "1.0.0", tenantId: "ten_a" as TenantId, enabled: true, settings: {}, actor: { kind: "user" as const, userId: "user_a" } };
function configured(enabled: boolean) {
  vi.stubEnv("AUTHZ_PROVIDER", enabled ? "openfga" : "in-process");
  vi.stubEnv("OPENFGA_API_URL", "http://127.0.0.1:1");
  vi.stubEnv("OPENFGA_STORE_ID", "synthetic"); vi.stubEnv("OPENFGA_MODEL_ID", "synthetic");
}
beforeEach(() => {
  state.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("insert into tenant_modules")) return { rows: [{ assigned: true, ownership_scope: "platform" }] };
    if (sql.includes("select tm.enabled")) return { rows: [{ enabled: true, authorization_manifest: manifest }] };
    if (sql.includes("select tenant_id from tenant_modules")) return { rows: [{ tenant_id: "ten_a" }] };
    if (sql.includes("insert into authorization_sync_streams")) return { rows: [{ next_sequence: "1" }] };
    if (sql.includes("insert into module_catalog")) return { rows: [{ authorization_manifest: manifest }] };
    if (sql.includes("select installation_id")) return { rows: [{ installation_id: "ins_example" }] };
    return { rows: [] };
  });
});
afterEach(() => vi.unstubAllEnvs());
const outbox = () => state.query.mock.calls.filter(([sql]) => /authorization_(sync|outbox)/.test(sql));

describe.each([false, true])("host authorization composition enabled=%s", enabled => {
  beforeEach(() => configured(enabled));
  it("queues successful assignments on the committing transaction, with no outbox access by default", async () => {
    await expect(moduleOwnershipStore().assignToTenant(assigned)).resolves.toBe(true);
    expect(outbox().length > 0).toBe(enabled);
    if (enabled) {
      const statements = state.query.mock.calls.map(([sql]) => sql);
      expect(statements.findIndex(sql => sql.includes("insert into authorization_outbox"))).toBeLessThan(statements.indexOf("commit"));
    }
  });
  it("composes installed catalog snapshots with manifest publication", async () => {
    await seedInstalledModuleCatalog();
    expect(outbox().length > 0).toBe(enabled);
  });
  it("publishes reviewed private catalog creation", async () => {
    await moduleOwnershipStore().createTenantPrivate({ moduleKey: "example", version: "1.0.0", runtime: "native", tenantId: assigned.tenantId, artifactDigest: "a".repeat(64), remoteUrl: null, createdByUserId: "user_a", authorizationManifest: manifest });
    expect(outbox().length > 0).toBe(enabled);
  });
  it("publishes reviewed promotion without borrowing permissions from the source", async () => {
    state.query.mockImplementationOnce(async () => ({ rows: [] })).mockImplementationOnce(async () => ({ rows: [{ module_key: "source", version: "0.9.0", runtime: "native", artifact_digest: "a".repeat(64), digest_kind: "sha256_artifact", installation_id: "ins_example", owner_tenant_id: "ten_a", created_by_user_id: "user_a" }] }));
    await moduleOwnershipStore().promoteTenantModule({ sourceModuleKey: "source", sourceVersion: "0.9.0", sourceArtifactDigest: "a".repeat(64), targetModuleKey: "example", targetVersion: "1.0.0", targetArtifactDigest: "b".repeat(64), targetRemoteUrl: null, reviewedByUserId: "user_review", reviewedAt: new Date(), authority: { kind: "installation_owner", userId: "user_publish" as never, permissions: ["owner.module.publish_installation"], source: "legacy_platform_admin" }, authorizationManifest: manifest });
    expect(outbox().length > 0).toBe(enabled);
  });
});
it("rolls back publication with no reviewed snapshot when OpenFGA is enabled", async () => {
  configured(true);
  await expect(moduleOwnershipStore().createTenantPrivate({ moduleKey: "example", version: "1.0.0", runtime: "native", tenantId: assigned.tenantId, artifactDigest: "a".repeat(64), remoteUrl: null, createdByUserId: "user_a" })).rejects.toThrow("Reviewed authorization manifest required");
  expect(state.query).toHaveBeenLastCalledWith("rollback");
  expect(outbox()).toHaveLength(0);
});
