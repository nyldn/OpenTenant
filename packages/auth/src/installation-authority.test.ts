import { describe, expect, it } from "vitest";
import type { IdentitySession, TenantId, UserId } from "./identity";
import {
  authorizeInstallationAction,
  installationAuthorityForSession,
} from "./installation-authority";

function session(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    userId: "usr_example" as UserId,
    email: "owner@example.test",
    displayName: "Example Owner",
    activeTenantId: null,
    activeRole: null,
    permissions: [],
    isPlatformAdmin: false,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("installation authority", () => {
  it("maps the legacy platform administrator source to explicit owner permissions", () => {
    const authority = installationAuthorityForSession(session({ isPlatformAdmin: true }));

    expect(authority).toMatchObject({
      kind: "installation_owner",
      userId: "usr_example",
      source: "legacy_platform_admin",
    });
    expect(authority?.permissions).toEqual([
      "owner.tenant.create",
      "owner.tenant.read",
      "owner.audit.read",
      "owner.support.enter",
      "owner.support.configure",
      "owner.helpdesk.queue.read",
    ]);
    expect(authorizeInstallationAction(
      session({ isPlatformAdmin: true }),
      "owner.support.customer_data.export",
    )).toEqual({ allowed: false, reason: "missing_installation_authority" });
  });

  it("does not infer installation authority from tenant membership or tenant permissions", () => {
    const tenantSession = session({
      activeTenantId: "ten_example" as TenantId,
      activeRole: "tenant_owner",
      permissions: ["owner.tenant.create"],
    });

    expect(installationAuthorityForSession(tenantSession)).toBeNull();
    expect(authorizeInstallationAction(tenantSession, "owner.tenant.create")).toEqual({
      allowed: false,
      reason: "missing_installation_authority",
    });
  });

  it("fails closed for unknown permissions and ambiguous runtime authority", () => {
    expect(authorizeInstallationAction(
      session({ isPlatformAdmin: true }),
      "owner.unknown" as "owner.tenant.create",
    )).toEqual({ allowed: false, reason: "unknown_installation_permission" });

    const ambiguous = session({ isPlatformAdmin: true }) as unknown as {
      isPlatformAdmin: unknown;
    };
    ambiguous.isPlatformAdmin = "true";
    expect(installationAuthorityForSession(ambiguous as IdentitySession)).toBeNull();
  });
});
