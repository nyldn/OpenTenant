import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { InstallationAuthority, TenantId, UserId } from "@opentenant/auth";
import { PgModuleCapabilityStore } from "./index";

const tenantId = "ten_alpha" as TenantId;
const ownerAuthority: InstallationAuthority = {
  kind: "installation_owner",
  userId: "user_owner" as UserId,
  permissions: ["owner.support.module_grant.manage"],
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

describe("PgModuleCapabilityStore", () => {
  it("persists the server-owned creator ceiling with installation-owner attribution", async () => {
    const harness = clientHarness((sql) => {
      if (sql.includes("insert into module_creator_capability_authorities")) {
        return [{ authority_id: "authority_1" }];
      }
      if (sql.includes("select exists(select 1 from tenants")) return [{ tenant_exists: true }];
      return [];
    });
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.grantModuleCreatorCapability({
      tenantId,
      creatorUserId: "user_creator",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });

    const expirationCleanup = harness.query.mock.calls.find(([sql]) => sql.includes(
      "update module_creator_capability_authorities",
    ));
    expect(expirationCleanup?.[0]).toContain("expires_at <= clock_timestamp()");

    const auditParams = harness.query.mock.calls.find(([sql]) => sql.includes("insert into audit_events"))?.[1];
    expect(auditParams).toEqual(expect.arrayContaining([
      JSON.stringify({ kind: "installation_owner", userId: "user_owner" }),
      "module.creator_capability.granted",
      "user_creator",
    ]));
  });

  it("does not grant an undeclared capability and audits denial", async () => {
    const harness = clientHarness();
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.grantTenantCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: false, reason: "manifest_not_requested" });

    expect(harness.query.mock.calls.some(([sql]) => sql.includes("insert into tenant_module_capability_grants")))
      .toBe(false);
    expect(harness.query.mock.calls.some(([sql]) => sql.includes("insert into audit_events"))).toBe(true);
  });

  it("retires an expired tenant grant before appending a replacement", async () => {
    const harness = clientHarness((sql) => {
      if (sql.includes("select capability") && sql.includes("module_version_capabilities")) {
        return [{ capability: "support.ticket.read" }];
      }
      if (sql.includes("insert into tenant_module_capability_grants")) return [{ granted: true }];
      return [];
    });
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.grantTenantCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });

    const cleanup = harness.query.mock.calls.find(([sql]) => sql.includes(
      "update tenant_module_capability_grants",
    ));
    expect(cleanup?.[0]).toContain("expires_at <= clock_timestamp()");
    const cleanupCallIndex = harness.query.mock.calls.indexOf(cleanup!);
    const insertCallIndex = harness.query.mock.calls.findIndex(([sql]) => sql.includes(
      "insert into tenant_module_capability_grants",
    ));
    expect(cleanupCallIndex).toBeLessThan(insertCallIndex);
  });

  it("executes one bounded operation only for the complete fresh intersection", async () => {
    const harness = clientHarness((sql) => sql.includes("module_version_capabilities capability")
      ? [{
          module_version: "1.0.0",
          ownership_scope: "tenant",
          tenant_bound: true,
          active_version_bound: true,
          manifest_requested: true,
          creator_authorized: true,
          tenant_granted: true,
          grant_active: true,
          runtime_permission: "tenant-portal.support-ticket-read",
        }]
      : []);
    const store = new PgModuleCapabilityStore(harness.pool);
    const operation = vi.fn(async () => ({
      value: [{ ticketNumber: "SUP-000001", status: "open" }],
      resultCount: 1,
      resultSize: "small" as const,
    }));

    await expect(store.withAuthorizedCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: ["tenant-portal.use", "tenant-portal.support-ticket-read"],
      identityBacked: true,
      actor: { kind: "user", userId: "user_runtime" },
      correlationId: "00000000-0000-4000-8000-000000000001",
    }, operation)).resolves.toEqual({
      allowed: true,
      value: [{ ticketNumber: "SUP-000001", status: "open" }],
    });

    expect(operation).toHaveBeenCalledOnce();
    expect(harness.query.mock.calls.some(([sql]) => sql.includes("for share"))).toBe(true);
    const auditParams = harness.query.mock.calls.find(([sql]) => sql.includes("insert into audit_events"))?.[1];
    expect(JSON.stringify(auditParams)).not.toContain("SUP-000001");
    expect(auditParams).toEqual(expect.arrayContaining([
      "module.capability.used",
      "tenant-portal@1.0.0",
    ]));
  });

  it("audits runtime permission denial without executing the broker operation", async () => {
    const harness = clientHarness((sql) => sql.includes("module_version_capabilities capability")
      ? [{
          module_version: "1.0.0",
          ownership_scope: "tenant",
          tenant_bound: true,
          active_version_bound: true,
          manifest_requested: true,
          creator_authorized: true,
          tenant_granted: true,
          grant_active: true,
          runtime_permission: "tenant-portal.support-ticket-read",
        }]
      : []);
    const store = new PgModuleCapabilityStore(harness.pool);
    const operation = vi.fn();

    await expect(store.withAuthorizedCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: ["tenant-portal.use"],
      identityBacked: true,
      actor: { kind: "user", userId: "user_runtime" },
      correlationId: "00000000-0000-4000-8000-000000000002",
    }, operation)).resolves.toEqual({ allowed: false, reason: "runtime_permission_denied" });

    expect(operation).not.toHaveBeenCalled();
    expect(harness.query.mock.calls.some(([sql]) => sql.includes("insert into audit_events"))).toBe(true);
  });

  it.each([
    ["unknown.read", "tenant", "unknown_capability"],
    ["support.ticket.read", "shared", "unknown_ownership_scope"],
  ])("fails closed and audits capability %s with ownership %s", async (
    capability,
    ownershipScope,
    reason,
  ) => {
    const harness = clientHarness((sql) => sql.includes("module_version_capabilities capability")
      ? [{
          module_version: "1.0.0",
          ownership_scope: ownershipScope,
          tenant_bound: true,
          active_version_bound: true,
          manifest_requested: true,
          creator_authorized: true,
          tenant_granted: true,
          grant_active: true,
          runtime_permission: "tenant-portal.support-ticket-read",
        }]
      : []);
    const operation = vi.fn();
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.withAuthorizedCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability,
      runtimePermissions: ["tenant-portal.support-ticket-read"],
      identityBacked: true,
      actor: { kind: "user", userId: "user_runtime" },
      correlationId: "00000000-0000-4000-8000-000000000004",
    }, operation)).resolves.toEqual({ allowed: false, reason });

    expect(operation).not.toHaveBeenCalled();
    expect(harness.query.mock.calls.some(([sql]) => sql.includes("insert into audit_events"))).toBe(true);
  });

  it("revokes a grant one way without content-bearing audit evidence", async () => {
    const harness = clientHarness((sql) => sql.includes("update tenant_module_capability_grants")
      ? [{ revoked: true }]
      : []);
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.revokeTenantCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });

    const revocationSql = harness.query.mock.calls.find(([sql]) => sql.includes(
      "update tenant_module_capability_grants",
    ))?.[0];
    expect(revocationSql).toContain("revoked_at is null");
    expect(revocationSql).not.toContain("revoked_at = null");
    const auditParams = harness.query.mock.calls.find(([sql]) => sql.includes("insert into audit_events"))?.[1];
    expect(auditParams).toEqual(expect.arrayContaining([
      "module.capability.revoked",
      "tenant-portal@1.0.0",
    ]));
  });

  it("rejects broker results above the fixed 25-item ceiling and audits a generic error", async () => {
    const harness = clientHarness((sql) => sql.includes("module_version_capabilities capability")
      ? [{
          module_version: "1.0.0",
          ownership_scope: "tenant",
          tenant_bound: true,
          active_version_bound: true,
          manifest_requested: true,
          creator_authorized: true,
          tenant_granted: true,
          grant_active: true,
          runtime_permission: "tenant-portal.support-ticket-read",
        }]
      : []);
    const store = new PgModuleCapabilityStore(harness.pool);

    await expect(store.withAuthorizedCapability({
      tenantId,
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: ["tenant-portal.support-ticket-read"],
      identityBacked: true,
      actor: { kind: "user", userId: "user_runtime" },
      correlationId: "00000000-0000-4000-8000-000000000003",
    }, async () => ({ value: [], resultCount: 26, resultSize: "bounded" })))
      .rejects.toThrow("Module capability broker operation failed");

    const auditParams = harness.query.mock.calls.find(([sql]) => sql.includes("insert into audit_events"))?.[1];
    expect(auditParams).toEqual(expect.arrayContaining(["module.capability.error"]));
  });

  it("bounds a stalled tenant operation, records a generic error, and releases the transaction", async () => {
    vi.useFakeTimers();
    try {
      const harness = clientHarness((sql) => sql.includes("module_version_capabilities capability")
        ? [{
            tenant_exists: true,
            module_version: "1.0.0",
            ownership_scope: "tenant",
            tenant_bound: true,
            active_version_bound: true,
            manifest_requested: true,
            creator_authorized: true,
            tenant_granted: true,
            grant_active: true,
            runtime_permission: "tenant-portal.support-ticket-read",
          }]
        : sql.includes("select exists(select 1 from tenants") ? [{ tenant_exists: true }] : []);
      const store = new PgModuleCapabilityStore(harness.pool);
      const stalled = store.withAuthorizedCapability({
        tenantId,
        moduleKey: "tenant-portal",
        moduleVersion: "1.0.0",
        capability: "support.ticket.read",
        runtimePermissions: ["tenant-portal.support-ticket-read"],
        identityBacked: true,
        actor: { kind: "user", userId: "user_runtime" },
        correlationId: "00000000-0000-4000-8000-000000000005",
      }, () => new Promise<never>(() => undefined));

      const rejection = expect(stalled).rejects.toThrow("Module capability broker operation failed");
      await vi.advanceTimersByTimeAsync(5_001);
      await rejection;
      expect(harness.query.mock.calls.some(([sql]) => sql === "commit")).toBe(true);
      const auditParams = harness.query.mock.calls.find(([sql]) => sql.includes("insert into audit_events"))?.[1];
      expect(auditParams).toEqual(expect.arrayContaining(["module.capability.error"]));
    } finally {
      vi.useRealTimers();
    }
  });
});
