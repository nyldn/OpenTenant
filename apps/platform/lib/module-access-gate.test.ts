vi.mock("../opentenant-modules", () => ({ installedModules: { get: () => ({ permissions: { passcode: ["sample.use"] } }), route: () => ({ module: { manifest: { key: "sample" } } }) } }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentitySession, TenantId, UserId } from "@opentenant/auth";
import type { ModuleAccessDependencies } from "./module-access-gate";
import { resolveModuleAccess } from "./module-access-gate";

const tenantId = "ten_sample" as TenantId;

function identitySession(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    userId: "usr_member" as UserId,
    email: "member@example.test",
    displayName: null,
    activeTenantId: tenantId,
    activeRole: "tenant_member",
    permissions: [],
    isPlatformAdmin: false,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function dependencies(): ModuleAccessDependencies {
  return {
    currentTenant: vi.fn().mockResolvedValue({ tenantId, displayName: "Synthetic tenant" }),
    nativeModuleEnabled: vi.fn().mockResolvedValue(true),
    moduleAccessPolicy: vi.fn().mockResolvedValue({ mode: "identity", passcodeHash: null }),
    currentSession: vi.fn().mockResolvedValue(identitySession()),
    verifiedPasscodePrincipal: vi.fn().mockReturnValue({
      kind: "passcode",
      principalId: "passcode:sample",
      tenantId,
      moduleKey: "sample",
    }),
  };
}

describe("resolveAssessmentAccess", () => {
  let deps: ModuleAccessDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it("returns a tenant-bound identity principal in identity mode", async () => {
    const result = await resolveModuleAccess("sample", undefined, deps);

    expect(result).toEqual({
      ok: true,
      tenantId,
      mode: "identity",
      principal: {
        kind: "identity",
        principalId: "usr_member",
        session: expect.objectContaining({ activeTenantId: tenantId }),
      },
    });
    expect(deps.currentSession).toHaveBeenCalledExactlyOnceWith(tenantId);
    expect(deps.verifiedPasscodePrincipal).not.toHaveBeenCalled();
  });

  it("returns a tenant-bound signed principal in passcode mode", async () => {
    vi.mocked(deps.moduleAccessPolicy).mockResolvedValueOnce({
      mode: "passcode",
      passcodeHash: "synthetic-hash",
    });

    const result = await resolveModuleAccess("sample", "signed-grant", deps);

    expect(result).toEqual({
      ok: true,
      tenantId,
      mode: "passcode",
      principal: {
        kind: "passcode",
        principalId: "passcode:sample",
        tenantId,
        moduleKey: "sample",
      },
    });
    expect(deps.verifiedPasscodePrincipal).toHaveBeenCalledExactlyOnceWith(
      "signed-grant",
      tenantId,
      "sample",
      "synthetic-hash",
    );
    expect(deps.currentSession).not.toHaveBeenCalled();
  });

  it("stops when the request host has no tenant", async () => {
    vi.mocked(deps.currentTenant).mockResolvedValueOnce(null);

    await expect(resolveModuleAccess("sample", "signed-grant", deps)).resolves.toEqual({
      ok: false,
      reason: "no_tenant",
    });
    expect(deps.nativeModuleEnabled).not.toHaveBeenCalled();
    expect(deps.moduleAccessPolicy).not.toHaveBeenCalled();
    expect(deps.currentSession).not.toHaveBeenCalled();
    expect(deps.verifiedPasscodePrincipal).not.toHaveBeenCalled();
  });

  it("returns unavailable before policy work when entitlement is missing or disabled", async () => {
    vi.mocked(deps.nativeModuleEnabled).mockResolvedValueOnce(false);

    await expect(resolveModuleAccess("sample", "signed-grant", deps)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      tenantId,
    });
    expect(deps.moduleAccessPolicy).not.toHaveBeenCalled();
    expect(deps.currentSession).not.toHaveBeenCalled();
    expect(deps.verifiedPasscodePrincipal).not.toHaveBeenCalled();
  });

  it("requires a current session bound to the resolved tenant", async () => {
    vi.mocked(deps.currentSession).mockResolvedValueOnce(null);
    await expect(resolveModuleAccess("sample", undefined, deps)).resolves.toEqual({
      ok: false,
      reason: "anonymous",
      tenantId,
      mode: "identity",
    });

    vi.mocked(deps.currentSession).mockResolvedValueOnce(identitySession({
      activeTenantId: null,
      isPlatformAdmin: true,
    }));
    await expect(resolveModuleAccess("sample", undefined, deps)).resolves.toEqual({
      ok: false,
      reason: "forbidden",
      tenantId,
      mode: "identity",
    });
  });

  it("rejects a revoked or invalid passcode grant", async () => {
    vi.mocked(deps.moduleAccessPolicy).mockResolvedValueOnce({
      mode: "passcode",
      passcodeHash: "synthetic-hash",
    });
    vi.mocked(deps.verifiedPasscodePrincipal).mockReturnValueOnce(null);

    await expect(resolveModuleAccess("sample", "revoked-grant", deps)).resolves.toEqual({
      ok: false,
      reason: "passcode_required",
      tenantId,
      mode: "passcode",
    });
  });
});
