import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const mocks = vi.hoisted(() => ({
  listForTenant: vi.fn(),
  tenantAdminContext: vi.fn(),
  pool: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      mocks.pool(options);
    }
  },
}));
vi.mock("@opentenant/database", () => ({
  PgAuditStore: class {
    listForTenant = mocks.listForTenant;
  },
}));
vi.mock("./tenant-admin", () => ({ tenantAdminContext: mocks.tenantAdminContext }));

import { loadTenantActivity } from "./tenant-activity";

const tenant = {
  tenantId: "ten_verified",
  slug: "verified",
  displayName: "Verified Organisation",
  status: "active",
};

describe("loadTenantActivity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CONTROL_PLANE_DATABASE_URL = "postgres://synthetic.invalid/control-plane";
    mocks.tenantAdminContext.mockResolvedValue({
      ok: true,
      context: {
        tenant,
        session: {
          activeTenantId: tenant.tenantId,
          activeRole: "tenant_owner",
        },
      },
    });
    mocks.listForTenant.mockResolvedValue([]);
  });

  it.each(["tenant_owner", "tenant_admin"])("allows verified %s membership", async (role) => {
    mocks.tenantAdminContext.mockResolvedValueOnce({
      ok: true,
      context: { tenant, session: { activeTenantId: tenant.tenantId, activeRole: role } },
    });

    await expect(loadTenantActivity()).resolves.toEqual({
      status: "ready",
      tenantName: tenant.displayName,
      records: [],
    });
    expect(mocks.listForTenant).toHaveBeenCalledExactlyOnceWith("ten_verified", 100);
  });

  it.each([
    ["anonymous", "anonymous"],
    ["ordinary member", "forbidden"],
    ["null tenant", "no_tenant"],
  ])("refuses %s without reading audit events", async (_label, reason) => {
    mocks.tenantAdminContext.mockResolvedValueOnce({ ok: false, reason });

    await expect(loadTenantActivity()).resolves.toEqual({ status: "denied", reason });
    expect(mocks.listForTenant).not.toHaveBeenCalled();
  });

  it("ignores page arguments and uses only the tenant verified by the admin context", async () => {
    const hostilePageArguments = {
      searchParams: { tenant: "ten_other", tenantId: "ten_other" },
      headers: { "x-tenant-id": "ten_other" },
      cookies: { tenant: "ten_other" },
    };

    await (loadTenantActivity as (...requestValues: unknown[]) => ReturnType<typeof loadTenantActivity>)(
      hostilePageArguments,
    );

    expect(mocks.tenantAdminContext).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.listForTenant).toHaveBeenCalledExactlyOnceWith("ten_verified", 100);
  });

  it("projects the canonical store result and removes cross-tenant, hidden-action, and raw detail data", async () => {
    const canonicalEvents = [
      {
        sequence: 4,
        occurredAt: new Date("2026-08-06T10:00:00.000Z"),
        actor: { kind: "user", userId: "verified-user-private" },
        tenantId: "ten_verified",
        action: "member.invited",
        subject: "membership:invited",
        detail: { role: "tenant_admin", secret: "visible-event-secret" },
        previousHash: "previous-4",
        hash: "hash-4",
      },
      {
        sequence: 5,
        occurredAt: new Date("2026-08-06T11:00:00.000Z"),
        actor: { kind: "user", userId: "other-user-private" },
        tenantId: "ten_other",
        action: "member.invited",
        subject: "membership:other",
        detail: { role: "tenant_owner", secret: "other-tenant-secret" },
        previousHash: "previous-5",
        hash: "hash-5",
      },
      {
        sequence: 6,
        occurredAt: new Date("2026-08-06T12:00:00.000Z"),
        actor: { kind: "system", job: "provider-private-job" },
        tenantId: "ten_verified",
        action: "provider.connected",
        subject: "provider:private",
        detail: { providerId: "provider-secret" },
        previousHash: "previous-6",
        hash: "hash-6",
      },
    ];
    mocks.listForTenant.mockResolvedValueOnce(canonicalEvents);

    const result = await loadTenantActivity();

    expect(result).toEqual({
      status: "ready",
      tenantName: tenant.displayName,
      records: [{
        sequence: 4,
        occurredAt: "2026-08-06T10:00:00.000Z",
        actor: "Tenant user",
        action: "member.invited",
        subject: "membership:invited",
        summary: "Member invited",
        metadata: { role: "tenant_admin" },
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /visible-event-secret|other-tenant-secret|provider-secret|other-user-private|provider-private-job/u,
    );
  });

  it("returns a tenant-invariant unavailable result when the audit read fails", async () => {
    mocks.listForTenant.mockRejectedValueOnce(new Error("database unavailable for ten_other"));

    await expect(loadTenantActivity()).resolves.toEqual({ status: "unavailable" });
  });
});
