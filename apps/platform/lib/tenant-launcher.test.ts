import { describe, expect, it, vi } from "vitest";
import type { IdentityGateway, IdentitySession, TenantMembership } from "@opentenant/auth";
import type { Pool } from "pg";
import { tenantLauncherData } from "./tenant-launcher";

const session = {
  userId: "user_example",
  email: "member@example.test",
  displayName: "Example Member",
  activeTenantId: null,
  activeRole: null,
  permissions: [],
  isPlatformAdmin: false,
  expiresAt: new Date("2030-01-01T00:00:00Z"),
} as unknown as IdentitySession;

function membership(tenantId: string, overrides: Partial<TenantMembership> = {}): TenantMembership {
  return {
    membershipId: `membership_${tenantId}`,
    userId: session.userId,
    tenantId,
    role: "tenant_member",
    status: "active",
    ...overrides,
  } as TenantMembership;
}

function row(
  tenantId: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    tenantId,
    displayName,
    tenantStatus: "active",
    host: null,
    domainKind: null,
    domainVerification: null,
    domainActive: null,
    ...overrides,
  };
}

function harness(memberships: TenantMembership[], rows: unknown[]) {
  const listMemberships = vi.fn().mockResolvedValue(memberships);
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    gateway: { listMemberships } as unknown as IdentityGateway,
    database: { query } as unknown as Pool,
    listMemberships,
    query,
  };
}

describe("tenantLauncherData", () => {
  it("returns no cards and makes no database query when the gateway returns no memberships", async () => {
    const h = harness([], []);
    await expect(tenantLauncherData(session, h.gateway, h.database)).resolves.toEqual([]);
    expect(h.listMemberships).toHaveBeenCalledWith(session.userId);
    expect(h.query).not.toHaveBeenCalled();
  });

  it("keeps only active memberships and never includes tenants absent from the gateway", async () => {
    const h = harness([
      membership("tenant_active"),
      membership("tenant_removed", { status: "removed" }),
    ], [
      row("tenant_active", "Active Tenant", {
        host: "active.example.test",
        domainKind: "opentenant_subdomain",
        domainVerification: "verified",
        domainActive: true,
      }),
      row("tenant_absent", "Absent Tenant", {
        host: "absent.example.test",
        domainKind: "opentenant_subdomain",
        domainVerification: "verified",
        domainActive: true,
      }),
    ]);

    await expect(tenantLauncherData(session, h.gateway, h.database)).resolves.toEqual([{
      tenantId: "tenant_active",
      displayName: "Active Tenant",
      role: "tenant_member",
      availability: "available",
      launchUrl: "https://active.example.test",
    }]);
    expect(h.query.mock.calls[0]?.[1]).toEqual([["tenant_active"]]);
  });

  it("deduplicates identical memberships, rejects conflicting roles, and orders cards stably", async () => {
    const h = harness([
      membership("tenant_z", { role: "tenant_member" }),
      membership("tenant_a", { role: "tenant_admin" }),
      membership("tenant_z", { role: "tenant_member", membershipId: "membership_duplicate" as never }),
      membership("tenant_conflict", { role: "tenant_member" }),
      membership("tenant_conflict", { role: "tenant_owner", membershipId: "membership_conflict" as never }),
    ], [
      row("tenant_z", "Zulu"),
      row("tenant_a", "Alpha"),
      row("tenant_conflict", "Conflict"),
    ]);

    const result = await tenantLauncherData(session, h.gateway, h.database);
    expect(result.map(({ tenantId, role }) => ({ tenantId, role }))).toEqual([
      { tenantId: "tenant_a", role: "tenant_admin" },
      { tenantId: "tenant_z", role: "tenant_member" },
    ]);
    expect(h.query.mock.calls[0]?.[1]).toEqual([["tenant_a", "tenant_z"]]);
  });

  it("selects the first eligible subdomain and rejects custom, pending, inactive, and malformed hosts", async () => {
    const h = harness([
      membership("tenant_host"),
      membership("tenant_none"),
      membership("tenant_pending"),
      membership("tenant_unverified"),
      membership("tenant_inactive"),
      membership("tenant_malformed"),
    ], [
      row("tenant_host", "Hosted", { host: "z.example.test", domainKind: "opentenant_subdomain", domainVerification: "verified", domainActive: true }),
      row("tenant_host", "Hosted", { host: "a.example.test", domainKind: "opentenant_subdomain", domainVerification: "verified", domainActive: true }),
      row("tenant_host", "Hosted", { host: "custom.example.test", domainKind: "custom", domainVerification: "verified", domainActive: true }),
      row("tenant_none", "Custom only", { host: "custom-only.example.test", domainKind: "custom", domainVerification: "verified", domainActive: true }),
      row("tenant_pending", "Pending", { host: "pending.example.test", domainKind: "opentenant_subdomain", domainVerification: "pending", domainActive: true }),
      row("tenant_unverified", "Unverified", { host: "unverified.example.test", domainKind: "opentenant_subdomain", domainVerification: "failed", domainActive: true }),
      row("tenant_inactive", "Inactive", { host: "inactive.example.test", domainKind: "opentenant_subdomain", domainVerification: "verified", domainActive: false }),
      row("tenant_malformed", "Malformed", { host: "safe.example.test/path", domainKind: "opentenant_subdomain", domainVerification: "verified", domainActive: true }),
    ]);
    const result = await tenantLauncherData(session, h.gateway, h.database);

    expect(result).toContainEqual({
      tenantId: "tenant_host",
      displayName: "Hosted",
      role: "tenant_member",
      availability: "available",
      launchUrl: "https://a.example.test",
    });
    expect(result).toContainEqual({
      tenantId: "tenant_none",
      displayName: "Custom only",
      role: "tenant_member",
      availability: "unavailable",
    });
    for (const tenantId of ["tenant_pending", "tenant_unverified", "tenant_inactive", "tenant_malformed"]) {
      expect(result.find((card) => card.tenantId === tenantId)?.availability).toBe("unavailable");
    }
  });

  it("ignores hostile selector-like session and provider values and exposes only the closed projection", async () => {
    const h = harness([membership("tenant_safe", {
      membershipId: "membership_hostile" as never,
      externalOrganizationId: "org_hostile",
    } as never)], [row("tenant_safe", "Safe Tenant", {
      host: "safe.example.test",
      domainKind: "opentenant_subdomain",
      domainVerification: "verified",
      domainActive: true,
      externalOrganizationId: "org_hostile",
      connectionLocator: "postgresql://credential@example.test/db",
    })]);
    const hostileSession = {
      ...session,
      activeTenantId: "tenant_hostile",
      query: { tenantId: "tenant_hostile" },
      headers: { "x-tenant": "tenant_hostile" },
      cookies: { activeTenant: "tenant_hostile" },
      externalOrganizationId: "org_hostile",
    } as unknown as IdentitySession;

    const baseline = await tenantLauncherData(session, h.gateway, h.database);
    const withHostileValues = await tenantLauncherData(hostileSession, h.gateway, h.database);
    expect(withHostileValues).toEqual(baseline);
    expect(h.listMemberships).toHaveBeenNthCalledWith(2, session.userId);
    expect(h.query.mock.calls[1]?.[1]).toEqual([["tenant_safe"]]);
    expect(Object.keys(withHostileValues[0] ?? {})).toEqual([
      "tenantId", "displayName", "role", "availability", "launchUrl",
    ]);
    expect(JSON.stringify(withHostileValues)).not.toMatch(/hostile|credential|organization|membership/i);
  });

  it("omits a suspended tenant excluded by the active-tenant query", async () => {
    const h = harness([membership("tenant_suspended")], [row("tenant_suspended", "Suspended", {
      tenantStatus: "suspended",
      host: "suspended.example.test",
      domainKind: "opentenant_subdomain",
      domainVerification: "verified",
      domainActive: true,
    })]);
    await expect(tenantLauncherData(session, h.gateway, h.database)).resolves.toEqual([]);
  });

  it("rejects memberships returned for a different user", async () => {
    const h = harness([membership("tenant_other_user", { userId: "user_other" as never })], [
      row("tenant_other_user", "Other user"),
    ]);
    await expect(tenantLauncherData(session, h.gateway, h.database)).resolves.toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });
});
