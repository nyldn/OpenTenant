import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { InstallationAuthority, TenantId, UserId } from "@opentenant/auth";
import { PgModuleOwnershipStore } from "./index";

const tenantId = "ten_alpha" as TenantId;
const sourceDigest = "a".repeat(64);
const promotedDigest = "b".repeat(64);
const ownerAuthority: InstallationAuthority = {
  kind: "installation_owner",
  userId: "user_publisher" as UserId,
  permissions: ["owner.module.publish_installation"],
  source: "legacy_platform_admin",
};

function clientHarness(rowsFor: (sql: string) => unknown[] = () => []) {
  const query = vi.fn(async (sql: string, _params?: readonly unknown[]) => ({
    rows: rowsFor(sql),
    rowCount: rowsFor(sql).length,
  }) as QueryResult);
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, query, release };
}

describe("PgModuleOwnershipStore", () => {
  it("rejects capability expansion beyond the creator ceiling before publication", async () => {
    const harness = clientHarness((sql) => sql.includes("select installation_id")
      ? [{ installation_id: "ins_example" }]
      : []);
    const store = new PgModuleOwnershipStore(harness.pool);

    await expect(store.createTenantPrivate({
      moduleKey: "tenant-insights",
      version: "1.0.0",
      runtime: "native",
      tenantId,
      artifactDigest: sourceDigest,
      remoteUrl: null,
      createdByUserId: "user_creator",
      capabilityRequests: [{
        capability: "support.ticket.read",
        runtimePermission: "tenant-insights.support-ticket-read",
      }],
    })).rejects.toThrow("Persisted module creator authority does not allow");
    expect(harness.pool.connect).toHaveBeenCalledOnce();
    expect(harness.query.mock.calls.every(([sql]) => !sql.includes("insert into module_catalog"))).toBe(true);
  });

  it("denies unlisted and local remote-module destinations before opening a transaction", async () => {
    const harness = clientHarness();
    const store = new PgModuleOwnershipStore(harness.pool, {
      allowedRemoteHosts: ["module.example.test"],
    });
    const input = {
      moduleKey: "tenant-remote",
      version: "1.0.0",
      runtime: "remote" as const,
      tenantId,
      artifactDigest: sourceDigest,
      createdByUserId: "user_creator",
    };

    await expect(store.createTenantPrivate({ ...input, remoteUrl: "https://localhost/app" }))
      .rejects.toThrow("not an allowlisted HTTPS deployment host");
    await expect(store.createTenantPrivate({ ...input, remoteUrl: "https://unlisted.example.test/app" }))
      .rejects.toThrow("not an allowlisted HTTPS deployment host");
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });

  it("creates tenant modules as private using the control plane installation identity", async () => {
    const harness = clientHarness((sql) => {
      if (sql.includes("select installation_id")) return [{ installation_id: "ins_example" }];
      if (sql.includes("from module_creator_capability_authorities")) {
        return [{ authority_id: "authority_1", capability: "support.ticket.read" }];
      }
      return [];
    });
    const store = new PgModuleOwnershipStore(harness.pool);

    const created = await store.createTenantPrivate({
      moduleKey: "tenant-insights",
      version: "1.0.0",
      runtime: "native",
      tenantId,
      artifactDigest: sourceDigest,
      remoteUrl: null,
      createdByUserId: "user_creator",
      capabilityRequests: [{
        capability: "support.ticket.read",
        runtimePermission: "tenant-insights.support-ticket-read",
      }],
    });

    expect(created.ownership).toEqual({
      scope: "tenant",
      installationId: "ins_example",
      tenantId,
    });
    expect(harness.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("insert into module_catalog"),
      expect.stringContaining("insert into module_version_capabilities"),
      expect.stringContaining("insert into module_versions"),
    ]));
    const statements = harness.query.mock.calls.map(([sql]) => sql);
    expect(statements.findIndex((sql) => sql.includes("insert into module_version_capabilities")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("insert into module_versions")));
    expect(harness.query.mock.calls.find(([sql]) =>
      sql.includes("insert into module_version_capabilities"))?.[1]).toEqual([
      "tenant-insights",
      "1.0.0",
      "support.ticket.read",
      "tenant-insights.support-ticket-read",
      "user_creator",
      "authority_1",
    ]);
    expect(harness.query.mock.calls.every(([sql]) => !/^\s*(update|delete)\b/iu.test(sql))).toBe(true);
  });

  it("assigns only through the database ownership predicate and reports denial without fallback", async () => {
    const allowed = clientHarness((sql) => sql.includes("insert into tenant_modules")
      ? [{ assigned: true, ownership_scope: "tenant" }]
      : []);
    await expect(new PgModuleOwnershipStore(allowed.pool).assignToTenant({
      moduleKey: "tenant-insights",
      version: "1.0.0",
      tenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: "user_creator" },
    })).resolves.toBe(true);
    const assignmentSql = allowed.query.mock.calls.find(([sql]) => sql.includes("insert into tenant_modules"))?.[0];
    expect(assignmentSql).toContain("ownership_scope = 'tenant'");
    expect(assignmentSql).toContain("owner_tenant_id = $3");
    expect(assignmentSql).toContain("installation_metadata");

    const denied = clientHarness();
    await expect(new PgModuleOwnershipStore(denied.pool).assignToTenant({
      moduleKey: "tenant-insights",
      version: "1.0.0",
      tenantId: "ten_other" as TenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: "user_creator" },
    })).resolves.toBe(false);
    expect(denied.query.mock.calls.every(([sql]) => !sql.includes("insert into audit_events"))).toBe(true);
  });

  it("promotes with insert-only reviewed provenance and never rewrites the source", async () => {
    const harness = clientHarness((sql) => {
      if (sql.includes("from module_catalog catalog") && sql.includes("module_versions version")) {
        return [{
          module_key: "tenant-insights",
          version: "1.0.0",
          runtime: "native",
          artifact_digest: sourceDigest,
          digest_kind: "sha256_artifact",
          installation_id: "ins_example",
          owner_tenant_id: tenantId,
          created_by_user_id: "user_creator",
        }];
      }
      return [];
    });
    const store = new PgModuleOwnershipStore(harness.pool);

    const promoted = await store.promoteTenantModule({
      sourceModuleKey: "tenant-insights",
      sourceVersion: "1.0.0",
      sourceArtifactDigest: sourceDigest,
      targetModuleKey: "shared-insights",
      targetVersion: "1.1.0",
      targetArtifactDigest: promotedDigest,
      targetRemoteUrl: null,
      reviewedByUserId: "user_reviewer",
      reviewedAt: new Date("2026-07-22T09:00:00.000Z"),
      authority: ownerAuthority,
    });

    expect(promoted.ownership).toEqual({ scope: "installation", installationId: "ins_example" });
    expect(promoted.promotion).toMatchObject({
      sourceModuleKey: "tenant-insights",
      sourceVersion: "1.0.0",
      sourceArtifactDigest: sourceDigest,
      sourceTenantId: tenantId,
      reviewedByUserId: "user_reviewer",
      publishedByUserId: "user_publisher",
    });
    const sql = harness.query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("insert into module_catalog");
    expect(sql).toContain("insert into module_versions");
    expect(sql).not.toMatch(/\bupdate\s+module_(catalog|versions)\b/iu);
    expect(sql).not.toMatch(/\bdelete\s+from\s+module_(catalog|versions)\b/iu);
  });

  it("rolls back before inserts when the reviewed source digest is stale", async () => {
    const harness = clientHarness((sql) => {
      if (sql.includes("from module_catalog catalog") && sql.includes("module_versions version")) {
        return [{
          module_key: "tenant-insights",
          version: "1.0.0",
          runtime: "native",
          artifact_digest: sourceDigest,
          digest_kind: "sha256_artifact",
          installation_id: "ins_example",
          owner_tenant_id: tenantId,
          created_by_user_id: "user_creator",
        }];
      }
      return [];
    });
    const store = new PgModuleOwnershipStore(harness.pool);

    await expect(store.promoteTenantModule({
      sourceModuleKey: "tenant-insights",
      sourceVersion: "1.0.0",
      sourceArtifactDigest: "c".repeat(64),
      targetModuleKey: "shared-insights",
      targetVersion: "1.1.0",
      targetArtifactDigest: promotedDigest,
      targetRemoteUrl: null,
      reviewedByUserId: "user_reviewer",
      reviewedAt: new Date("2026-07-22T09:00:00.000Z"),
      authority: ownerAuthority,
    })).rejects.toThrow("review does not match");

    expect(harness.query.mock.calls.map(([sql]) => sql)).toContain("rollback");
    expect(harness.query.mock.calls.every(([sql]) => !sql.includes("insert into module_catalog"))).toBe(true);
  });
});

describe("transactional authorization hooks", () => {
  const manifest = { key: "tenant-insights", version: "1.0.0", runtime: "native" as const, navigation: [], permissions: [], rolePermissions: {} };
  const privateInput = { moduleKey: manifest.key, version: manifest.version, runtime: manifest.runtime, tenantId, artifactDigest: sourceDigest, remoteUrl: null, createdByUserId: "user_creator", authorizationManifest: manifest };
  it("publishes a private module's reviewed snapshot before commit and rolls back a failed hook", async () => {
    const harness = clientHarness(sql => sql.includes("select installation_id") ? [{ installation_id: "ins_example" }] : []);
    const publish = vi.fn(async (client, snapshot) => {
      expect(client.query).toBe(harness.query);
      expect(snapshot).toEqual(manifest);
      expect(harness.query).not.toHaveBeenCalledWith("commit");
    });
    await new PgModuleOwnershipStore(harness.pool, { queueManifestPublication: publish }).createTenantPrivate(privateInput);
    expect(publish).toHaveBeenCalledOnce();
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining("authorization_manifest"), expect.arrayContaining([JSON.stringify(manifest)]));
    publish.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(new PgModuleOwnershipStore(harness.pool, { queueManifestPublication: publish }).createTenantPrivate(privateInput)).rejects.toThrow("queue unavailable");
    expect(harness.query).toHaveBeenLastCalledWith("rollback");
  });
  it("queues only a successful entitlement assignment, before commit", async () => {
    const harness = clientHarness(sql => sql.includes("insert into tenant_modules") ? [{ assigned: true, ownership_scope: "tenant" }] : []);
    const queue = vi.fn(async (client, input) => {
      expect(client.query).toBe(harness.query);
      expect(input).toEqual({ tenantId, moduleKey: manifest.key });
      expect(harness.query).not.toHaveBeenCalledWith("commit");
    });
    const input = { moduleKey: manifest.key, version: manifest.version, tenantId, enabled: true, settings: {}, actor: { kind: "user" as const, userId: "user_creator" } };
    await expect(new PgModuleOwnershipStore(harness.pool, { queueEntitlementSync: queue }).assignToTenant(input)).resolves.toBe(true);
    expect(queue).toHaveBeenCalledOnce();
    queue.mockClear();
    await expect(new PgModuleOwnershipStore(clientHarness().pool, { queueEntitlementSync: queue }).assignToTenant(input)).resolves.toBe(false);
    expect(queue).not.toHaveBeenCalled();
  });
  it("does not accept a snapshot for another artifact identity", async () => {
    const harness = clientHarness();
    await expect(new PgModuleOwnershipStore(harness.pool).createTenantPrivate({ ...privateInput, authorizationManifest: { ...manifest, key: "other" } })).rejects.toThrow("identity mismatch");
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });
});
