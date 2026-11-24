import type { IdentitySession, TenantId } from "./identity";

export const BRAND_PROPOSAL_PERMISSIONS = [
  "brand.proposal.upload",
  "brand.proposal.review",
  "brand.proposal.edit",
  "brand.proposal.apply",
  "brand.proposal.supersede",
  "brand.proposal.revoke",
] as const;

export type BrandProposalPermission = (typeof BRAND_PROPOSAL_PERMISSIONS)[number];

export type BrandProposalAuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "unknown_brand_proposal_permission"
        | "active_tenant_mismatch"
        | "tenant_admin_required"
        | "missing_brand_proposal_permission";
    };

const knownPermissions = new Set<string>(BRAND_PROPOSAL_PERMISSIONS);

/** Exact, tenant-bound, fail-closed authorization for proposal mutations. */
export function authorizeBrandProposalAction(
  session: IdentitySession,
  tenantId: TenantId,
  permission: BrandProposalPermission,
): BrandProposalAuthorizationDecision {
  if (!knownPermissions.has(permission)) {
    return { allowed: false, reason: "unknown_brand_proposal_permission" };
  }
  if (session.activeTenantId !== tenantId) {
    return { allowed: false, reason: "active_tenant_mismatch" };
  }
  if (session.activeRole !== "tenant_owner" && session.activeRole !== "tenant_admin") {
    return { allowed: false, reason: "tenant_admin_required" };
  }
  if (!session.permissions.includes(permission)) {
    return { allowed: false, reason: "missing_brand_proposal_permission" };
  }
  return { allowed: true };
}
