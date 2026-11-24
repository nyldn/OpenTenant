import { describe, expect, it } from "vitest";
import type { IdentitySession, TenantId, UserId } from "./identity";
import {
  BRAND_PROPOSAL_PERMISSIONS,
  authorizeBrandProposalAction,
} from "./brand-proposal-authority";

const tenantId = "ten_example" as TenantId;

function session(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    userId: "usr_tenant_admin" as UserId,
    email: "admin@example.test",
    displayName: "Tenant Admin",
    activeTenantId: tenantId,
    activeRole: "tenant_admin",
    permissions: [],
    isPlatformAdmin: false,
    expiresAt: new Date("2026-07-30T12:00:00Z"),
    ...overrides,
  };
}

describe("brand proposal authority", () => {
  it("exposes the closed six-operation permission vocabulary", () => {
    expect(BRAND_PROPOSAL_PERMISSIONS).toEqual([
      "brand.proposal.upload",
      "brand.proposal.review",
      "brand.proposal.edit",
      "brand.proposal.apply",
      "brand.proposal.supersede",
      "brand.proposal.revoke",
    ]);
  });

  it.each(BRAND_PROPOSAL_PERMISSIONS)("requires exactly %s", (permission) => {
    for (const granted of BRAND_PROPOSAL_PERMISSIONS) {
      expect(authorizeBrandProposalAction(
        session({ permissions: [granted] }),
        tenantId,
        permission,
      ).allowed).toBe(granted === permission);
    }
  });

  it("fails closed for unknown permissions and a different active tenant", () => {
    expect(authorizeBrandProposalAction(
      session({ permissions: ["brand.proposal.unknown"] }),
      tenantId,
      "brand.proposal.unknown" as never,
    )).toEqual({ allowed: false, reason: "unknown_brand_proposal_permission" });
    expect(authorizeBrandProposalAction(
      session({
        activeTenantId: "ten_other" as TenantId,
        permissions: ["brand.proposal.review"],
      }),
      tenantId,
      "brand.proposal.review",
    )).toEqual({ allowed: false, reason: "active_tenant_mismatch" });
  });

  it("does not elevate platform administration or non-admin membership", () => {
    expect(authorizeBrandProposalAction(
      session({
        activeTenantId: null,
        activeRole: null,
        isPlatformAdmin: true,
        permissions: ["brand.proposal.apply"],
      }),
      tenantId,
      "brand.proposal.apply",
    )).toEqual({ allowed: false, reason: "active_tenant_mismatch" });
    expect(authorizeBrandProposalAction(
      session({
        activeRole: "tenant_member",
        permissions: ["brand.proposal.apply"],
      }),
      tenantId,
      "brand.proposal.apply",
    )).toEqual({ allowed: false, reason: "tenant_admin_required" });
  });
});
