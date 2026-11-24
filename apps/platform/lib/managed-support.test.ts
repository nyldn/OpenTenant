import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  currentTenant: vi.fn(),
  readToken: vi.fn(),
  findActive: vi.fn(),
}));

vi.mock("./session", () => ({ currentSession: mocks.currentSession }));
vi.mock("./tenant", () => ({ currentTenant: mocks.currentTenant }));
vi.mock("./support-session-cookie", () => ({ supportSessionToken: mocks.readToken }));
vi.mock("./support-session-store", () => ({ supportSessionStore: () => ({ findActive: mocks.findActive }) }));

import { managedSupportContext, managedSupportSessionForTenant } from "./managed-support";

describe("managedSupportContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.currentTenant.mockResolvedValue({ tenantId: "ten_example", displayName: "Example Organisation" });
    mocks.readToken.mockResolvedValue("opaque-token");
    mocks.currentSession.mockResolvedValue({
      userId: "usr_operator",
      email: "operator@example.test",
      isPlatformAdmin: true,
      activeTenantId: null,
      activeRole: null,
      permissions: [],
    });
    mocks.findActive.mockResolvedValue({
      sessionId: "sup_example",
      installationId: "ins_example",
      tenantId: "ten_example",
      operatorUserId: "usr_operator",
      reason: "Repair approved tenant configuration",
      reference: "CHG-123",
      allowedActionClasses: ["routine_configuration"],
      createdAt: new Date("2026-07-22T10:00:00Z"),
      lastActivityAt: new Date("2026-07-22T10:05:00Z"),
      expiresAt: new Date("2099-07-22T10:30:00Z"),
      revokedAt: null,
    });
  });

  it("retains the real operator and reason for routine configuration", async () => {
    await expect(managedSupportContext("branding.configure")).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({
        operator: expect.objectContaining({ userId: "usr_operator", email: "operator@example.test" }),
        reason: "Repair approved tenant configuration",
        tenant: expect.objectContaining({ tenantId: "ten_example" }),
      }),
    });
  });

  it("does not reinterpret operator or tenant mismatches", async () => {
    mocks.findActive.mockResolvedValueOnce({
      sessionId: "sup_example",
      tenantId: "ten_other",
      operatorUserId: "usr_operator",
    });
    await expect(managedSupportContext("branding.configure")).resolves.toEqual({
      ok: false,
      reason: "support_context_mismatch",
    });

    mocks.findActive.mockResolvedValueOnce({
      sessionId: "sup_example",
      tenantId: "ten_example",
      operatorUserId: "usr_other",
    });
    await expect(managedSupportContext("branding.configure")).resolves.toEqual({
      ok: false,
      reason: "support_context_mismatch",
    });
  });

  it("resolves an active session against an explicit tenant without granting a sensitive action", async () => {
    await expect(managedSupportSessionForTenant("ten_example")).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({
        sessionId: "sup_example",
        tenantId: "ten_example",
        operator: expect.objectContaining({ userId: "usr_operator" }),
        reason: "Repair approved tenant configuration",
      }),
    });

    expect(mocks.currentTenant).not.toHaveBeenCalled();
  });

  it("fails closed when the explicit tenant does not match the active support session", async () => {
    await expect(managedSupportSessionForTenant("ten_other")).resolves.toEqual({
      ok: false,
      reason: "support_context_mismatch",
    });
  });
});
