vi.mock("../opentenant-modules", () => ({ installedModules: { get: (key: string) => key === "sample" ? { manifest } : undefined } }));
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { IdentitySession, TenantId, UserId } from "@opentenant/auth";
import { signModuleAccess } from "@opentenant/security";
import { productionConfig } from "../test/production-config";
import {
  passcodeAdmissionFingerprint,
  resolvePermissions,
  passcodePolicyBinding,
  verifiedPasscodePrincipal,
} from "./module-access";

const query = vi.hoisted(() => vi.fn());
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query }) }));
const manifest = {
  key: "sample", version: "1.0.0", runtime: "native", navigation: [],
  permissions: ["sample.use", "sample.promote", "sample.admin"],
  rolePermissions: {
    tenant_owner: ["sample.use", "sample.promote", "sample.admin"],
    tenant_admin: ["sample.use", "sample.promote", "sample.admin"],
    tenant_member: ["sample.use"],
  },
};
beforeEach(() => query.mockResolvedValue({ rows: [{ enabled: true, authorization_manifest: manifest }] }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("passcodeAdmissionFingerprint", () => {
  it("is deterministic, secret-keyed, and bound to tenant and module", () => {
    vi.stubEnv("MODULE_ACCESS_SECRET", "synthetic-server-secret-one");
    const tenant = "ten_a" as TenantId;
    const fingerprint = passcodeAdmissionFingerprint(tenant, "sample", "1234");

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(passcodeAdmissionFingerprint(tenant, "sample", "1234")).toBe(fingerprint);
    expect(passcodeAdmissionFingerprint(tenant, "sample", "1235")).not.toBe(fingerprint);
    expect(passcodeAdmissionFingerprint("ten_b" as TenantId, "sample", "1234")).not.toBe(fingerprint);
    expect(passcodeAdmissionFingerprint(tenant, "other", "1234")).not.toBe(fingerprint);
    expect(fingerprint).not.toContain("1234");

    vi.stubEnv("MODULE_ACCESS_SECRET", "synthetic-server-secret-two");
    expect(passcodeAdmissionFingerprint(tenant, "other", "1234")).not.toBe(fingerprint);
  });
});

describe("verifiedPasscodePrincipal", () => {
  const passcodeHash = "scrypt$synthetic-salt$synthetic-hash";

  function grant(overrides: { expiresAt?: number; passcodeHash?: string } = {}): string {
    return signModuleAccess({
      tenantId: "ten_a",
      moduleKey: "sample",
      policyBinding: passcodePolicyBinding(overrides.passcodeHash ?? passcodeHash),
      expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
    }, "synthetic-server-secret");
  }

  it("returns a tenant and module-bound principal only for a valid signed grant", () => {
    vi.stubEnv("MODULE_ACCESS_SECRET", "synthetic-server-secret");
    const tenantId = "ten_a" as TenantId;
    const token = grant();

    expect(verifiedPasscodePrincipal(token, tenantId, "sample", passcodeHash)).toEqual({
      kind: "passcode",
      principalId: "passcode:sample",
      tenantId,
      moduleKey: "sample",
    });
    expect(verifiedPasscodePrincipal(token, "ten_b" as TenantId, "sample", passcodeHash)).toBeNull();
    expect(verifiedPasscodePrincipal(undefined, tenantId, "sample", passcodeHash)).toBeNull();
    expect(verifiedPasscodePrincipal(grant({ expiresAt: Date.now() - 1 }), tenantId, "sample", passcodeHash))
      .toBeNull();
  });

  it("revokes grants issued before a passcode rotation", () => {
    vi.stubEnv("MODULE_ACCESS_SECRET", "synthetic-server-secret");
    const tenantId = "ten_a" as TenantId;
    const token = grant();

    expect(verifiedPasscodePrincipal(token, tenantId, "sample", "scrypt$rotated$hash")).toBeNull();
    expect(verifiedPasscodePrincipal(token, tenantId, "sample", null)).toBeNull();
  });
});

function session(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    userId: "user_1" as UserId,
    email: "member@example.test",
    displayName: null,
    activeTenantId: "ten_a" as TenantId,
    activeRole: "tenant_member",
    permissions: [],
    isPlatformAdmin: false,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe("resolvePermissions", () => {
  it("grants base use to an active member with no RBAC claims", async () => {
    await expect(resolvePermissions(session(), "ten_a", "sample")).resolves.toEqual(["sample.use"]);
  });

  it("adds elevated permissions only for the requested module", async () => {
    const s = session({ activeRole: "tenant_admin", permissions: ["sample.promote", "sample.admin", "sample.use", "support.admin"] });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual([
      "sample.use",
      "sample.promote",
      "sample.admin",
    ]);
  });

  it("never duplicates base use when the claim also carries it", async () => {
    const s = session({ activeRole: "tenant_admin", permissions: ["sample.use", "sample.promote"] });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual([
      "sample.use",
      "sample.promote",
    ]);
  });

  it("does not leak a prefix-sharing module's permissions", async () => {
    const s = session({ permissions: ["samplestorm.admin"] });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual(["sample.use"]);
  });

  it("rejects forged claims and role escalation on mapped manifests", async () => {
    await expect(resolvePermissions(session({ permissions: ["sample.forged", "sample.admin"] }), "ten_a", "sample"))
      .resolves.toEqual(["sample.use"]);
    await expect(resolvePermissions(session({ activeRole: "tenant_admin", permissions: ["sample.forged"] }), "ten_a", "sample"))
      .resolves.toEqual(["sample.use"]);
  });

  it("denies missing, disabled or failing entitlement reads", async () => {
    for (const rows of [[], [{ enabled: false, authorization_manifest: manifest }]]) {
      query.mockResolvedValueOnce({ rows });
      await expect(resolvePermissions(session(), "ten_a", "sample")).resolves.toEqual([]);
    }
    query.mockRejectedValueOnce(new Error("synthetic database failure"));
    await expect(resolvePermissions(session(), "ten_a", "sample")).resolves.toEqual([]);
  });

  it("denies missing membership, expired sessions and unknown provider config", async () => {
    await expect(resolvePermissions(session({ activeRole: null }), "ten_a", "sample")).resolves.toEqual([]);
    await expect(resolvePermissions(session({ expiresAt: new Date(0) }), "ten_a", "sample")).resolves.toEqual([]);
    vi.stubEnv("AUTHZ_PROVIDER", "typo");
    await expect(resolvePermissions(session(), "ten_a", "sample")).resolves.toEqual([]);
  });

  it("uses the installed manifest ceiling even when the database snapshot is legacy", async () => {
    query.mockResolvedValueOnce({ rows: [{ enabled: true, authorization_manifest: null }] });
    await expect(resolvePermissions(session({ permissions: ["sample.legacy"] }), "ten_a", "sample"))
      .resolves.toEqual(["sample.use"]);
  });

  it("fails closed on stalled entitlement reads", async () => {
    query.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(resolvePermissions(session(), "ten_a", "sample")).resolves.toEqual([]);
  });

  it("returns nothing for a session on a different tenant", async () => {
    const s = session({ activeTenantId: "ten_b" as TenantId, permissions: ["sample.admin"] });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual([]);
  });

  it("lets a platform admin through the tenant gate with base use", async () => {
    const s = session({ activeTenantId: null, activeRole: null, isPlatformAdmin: true });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual(["sample.use"]);
  });

  it("never carries a platform admin's home-tenant claims into another tenant", async () => {
    const s = session({
      activeTenantId: "ten_home" as TenantId,
      isPlatformAdmin: true,
      permissions: ["sample.promote", "sample.admin"],
    });
    await expect(resolvePermissions(s, "ten_a", "sample")).resolves.toEqual(["sample.use"]);
  });
});


describe("production passcode secret custody", () => {
  it.each([undefined, ""])("rejects missing dedicated secret %s despite a cookie secret", (secret) => {
    for (const [name, value] of Object.entries(productionConfig)) vi.stubEnv(name, value);
    vi.stubEnv("MODULE_ACCESS_SECRET", secret);
    expect(() => passcodeAdmissionFingerprint("ten_a" as TenantId, "sample", "1234")).toThrow("MODULE_ACCESS_SECRET");
  });
  it("keeps the development fallback", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("MODULE_ACCESS_SECRET", undefined);
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "synthetic-cookie-secret");
    expect(passcodeAdmissionFingerprint("ten_a" as TenantId, "sample", "1234")).toMatch(/^[a-f0-9]{64}$/);
  });
});
