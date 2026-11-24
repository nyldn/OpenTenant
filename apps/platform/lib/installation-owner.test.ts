import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentSession: vi.fn() }));

vi.mock("./session", () => ({ currentSession: mocks.currentSession }));

import { installationOwnerContext } from "./installation-owner";

describe("installationOwnerContext", () => {
  beforeEach(() => mocks.currentSession.mockReset());

  it("preserves the legacy platform administrator tenant-create entry point", async () => {
    mocks.currentSession.mockResolvedValue({
      userId: "usr_owner",
      isPlatformAdmin: true,
      activeTenantId: null,
      activeRole: null,
      permissions: [],
    });

    await expect(installationOwnerContext("owner.tenant.create")).resolves.toEqual({
      ok: true,
      context: {
        authority: expect.objectContaining({
          kind: "installation_owner",
          userId: "usr_owner",
        }),
      },
    });
  });

  it("denies anonymous, tenant-only, and unknown authority", async () => {
    mocks.currentSession.mockResolvedValueOnce(null);
    await expect(installationOwnerContext("owner.tenant.create")).resolves.toEqual({
      ok: false,
      reason: "anonymous",
    });

    mocks.currentSession.mockResolvedValueOnce({
      userId: "usr_tenant_owner",
      isPlatformAdmin: false,
      activeTenantId: "ten_example",
      activeRole: "tenant_owner",
      permissions: ["owner.tenant.create"],
    });
    await expect(installationOwnerContext("owner.tenant.create")).resolves.toEqual({
      ok: false,
      reason: "missing_installation_authority",
    });
  });
});
