import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentSession: vi.fn(), currentTenant: vi.fn(), managed: vi.fn() }));
vi.mock("./session", () => ({ currentSession: mocks.currentSession }));
vi.mock("./tenant", () => ({ currentTenant: mocks.currentTenant }));
vi.mock("./managed-support", () => ({ managedSupportContext: mocks.managed }));

import {
  brandProposalEntry,
  brandProposalAdminContext,
  brandProposalTenantContext,
  tenantAdminContext,
} from "./tenant-admin";

describe("tenantAdminContext managed support separation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.currentTenant.mockResolvedValue({ tenantId: "ten_example", displayName: "Example Organisation" });
    mocks.currentSession.mockResolvedValue({
      userId: "usr_operator",
      isPlatformAdmin: true,
      activeTenantId: null,
      activeRole: null,
      permissions: [],
    });
  });

  it("does not treat platform administration as ambient tenant membership", async () => {
    await expect(tenantAdminContext()).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.currentSession).toHaveBeenCalledExactlyOnceWith("ten_example");
    expect(mocks.managed).not.toHaveBeenCalled();
  });

  it("falls back to a separately validated support context when exact tenant membership is absent", async () => {
    mocks.currentSession.mockResolvedValueOnce(null);
    mocks.managed.mockResolvedValue({
      ok: true,
      context: {
        sessionId: "sup_example",
        tenant: { tenantId: "ten_example" },
        operator: { userId: "usr_operator" },
        reason: "Repair approved tenant configuration",
      },
    });
    const result = await tenantAdminContext("branding.configure");
    expect(result).toEqual({
      ok: true,
      context: expect.objectContaining({
        managedSupport: expect.objectContaining({ sessionId: "sup_example" }),
        auditActor: { kind: "installation_owner", userId: "usr_operator" },
      }),
    });
    expect(mocks.currentSession).toHaveBeenCalledExactlyOnceWith("ten_example");
  });

  it("derives an ordinary tenant administrator audit actor once in the context", async () => {
    mocks.currentSession.mockResolvedValueOnce({
      userId: "usr_tenant_admin",
      isPlatformAdmin: false,
      activeTenantId: "ten_example",
      activeRole: "tenant_admin",
      permissions: [],
    });

    await expect(tenantAdminContext()).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({
        auditActor: { kind: "user", userId: "usr_tenant_admin" },
      }),
    });
  });

  it("rejects a support resolver result for a different tenant", async () => {
    mocks.currentSession.mockResolvedValueOnce(null);
    mocks.managed.mockResolvedValue({
      ok: true,
      context: {
        sessionId: "sup_example",
        tenant: { tenantId: "ten_other" },
        operator: { userId: "usr_operator" },
        reason: "Repair approved tenant configuration",
      },
    });

    await expect(tenantAdminContext("branding.configure")).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("binds proposal reads to a verified active tenant administrator", async () => {
    mocks.currentSession.mockResolvedValueOnce({
      userId: "usr_operator",
      isPlatformAdmin: false,
      activeTenantId: "ten_example",
      activeRole: "tenant_admin",
      permissions: [],
    });

    await expect(brandProposalTenantContext("ten_example" as never)).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({ tenantId: "ten_example" }),
    });
    expect(mocks.currentSession).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.currentTenant).toHaveBeenCalledOnce();
    expect(mocks.managed).not.toHaveBeenCalled();
  });

  it("refuses a proposal mutation when the verified active tenant differs", async () => {
    mocks.currentSession.mockResolvedValueOnce({
      userId: "usr_operator",
      isPlatformAdmin: false,
      activeTenantId: "ten_other",
      activeRole: "tenant_admin",
      permissions: ["brand.proposal.review"],
    });

    await expect(brandProposalAdminContext(
      "ten_example" as never,
      "brand.proposal.review",
    )).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(mocks.currentSession).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.currentTenant).toHaveBeenCalledOnce();
    expect(mocks.managed).not.toHaveBeenCalled();
  });

  it("rejects proposal reads for a path tenant different from the verified host", async () => {
    mocks.currentSession.mockResolvedValueOnce({ activeTenantId: "ten_other", activeRole: "tenant_owner" });
    await expect(brandProposalTenantContext("ten_other" as never)).resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("offers the Branding entry only for the exact tenant with an upload grant", () => {
    const session = { activeTenantId: "ten_example", activeRole: "tenant_owner", permissions: ["brand.proposal.upload"] };
    expect(brandProposalEntry(session as never, "ten_example" as never)?.href).toBe("/admin/tenants/ten_example/brand-proposals");
    for (const change of [{ activeRole: "tenant_member" }, { activeTenantId: "ten_other" }, { permissions: [] }, { activeTenantId: null, activeRole: null, isPlatformAdmin: true }]) {
      expect(brandProposalEntry({ ...session, ...change } as never, "ten_example" as never)).toBeNull();
    }
  });

  it("does not elevate platform administration into proposal authority", async () => {
    mocks.currentSession.mockResolvedValueOnce({
      userId: "usr_operator",
      isPlatformAdmin: true,
      activeTenantId: null,
      activeRole: null,
      permissions: ["brand.proposal.apply"],
    });

    await expect(brandProposalAdminContext(
      "ten_example" as never,
      "brand.proposal.apply",
    )).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(mocks.managed).not.toHaveBeenCalled();
  });
});
