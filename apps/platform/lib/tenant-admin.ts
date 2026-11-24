/**
 * Authorization gate for tenant administration (spec 8.2): exact verified
 * tenant_owner/tenant_admin membership, or a separately validated managed-
 * support context for one classified action. Platform administration alone
 * is never ambient tenant access.
 */
import {
  authorizeBrandProposalAction,
  type BrandProposalPermission,
  type IdentitySession,
  type SupportAction,
  type TenantId,
} from "@opentenant/auth";
import type { ResolvedTenant } from "@opentenant/database";
import type { AuditActor } from "@opentenant/security";
import { currentSession } from "./session";
import { currentTenant } from "./tenant";
import { managedSupportContext, type ManagedSupportContext } from "./managed-support";
import { unavailableTenantContext, auditActor } from "./settings-guard";

export interface TenantAdminContext {
  session: IdentitySession;
  tenant: ResolvedTenant;
  managedSupport?: ManagedSupportContext;
  auditActor: AuditActor;
}

export interface BrandProposalTenantContext {
  session: IdentitySession;
  tenantId: TenantId;
}

/**
 * Brand proposal reads bind directly to the identity provider's verified
 * active tenant and require a tenant administrator role. Installation and
 * managed-support authority are deliberately not accepted.
 */
export async function brandProposalTenantContext(
  tenantId: TenantId,
): Promise<
  | { ok: true; context: BrandProposalTenantContext }
  | { ok: false; reason: "anonymous" | "forbidden" }
> {
  // An expected ID is a comparison only. A valid session with another active
  // organization must receive a denial rather than an anonymous login loop.
  const session = await currentSession();
  if (!session) return { ok: false, reason: "anonymous" };
  const tenant = await currentTenant();
  if (
    tenant?.tenantId !== tenantId || session.activeTenantId !== tenantId
    || (session.activeRole !== "tenant_owner" && session.activeRole !== "tenant_admin")
  ) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, context: { session, tenantId } };
}

/**
 * Proposal mutations add one exact operation permission to the verified
 * tenant-administrator context. The submitted tenant is only an expected value
 * passed to session validation, never an authority source.
 */
export async function brandProposalAdminContext(
  tenantId: TenantId,
  permission: BrandProposalPermission,
): Promise<
  | { ok: true; context: BrandProposalTenantContext }
  | { ok: false; reason: "anonymous" | "forbidden" }
> {
  const tenantContext = await brandProposalTenantContext(tenantId);
  if (!tenantContext.ok) return tenantContext;
  const { session } = tenantContext.context;
  const decision = authorizeBrandProposalAction(session, tenantId, permission);
  return decision.allowed ? tenantContext : { ok: false, reason: "forbidden" };
}

export async function tenantAdminContext(supportAction?: SupportAction): Promise<
  | { ok: true; context: TenantAdminContext }
  | { ok: false; reason: "anonymous" | "forbidden" | "no_tenant"; response?: Response }
> {
  const tenant = await currentTenant();
  if (!tenant) return unavailableTenantContext();

  // Keep the identity gateway's exact tenant binding for normal membership.
  // Managed support authenticates installation authority independently below.
  const session = await currentSession(tenant.tenantId as TenantId);

  const isTenantAdmin =
    session?.activeTenantId === tenant.tenantId &&
    (session.activeRole === "tenant_owner" || session.activeRole === "tenant_admin");
  if (isTenantAdmin && session) return {
    ok: true, context: { session, tenant, auditActor: auditActor(session, false) },
  };

  if (supportAction) {
    const support = await managedSupportContext(supportAction);
    if (support.ok) {
      if (support.context.tenant.tenantId === tenant.tenantId) {
        return {
          ok: true,
          context: {
            session: support.context.operator,
            tenant,
            managedSupport: support.context,
            auditActor: auditActor(support.context.operator, true),
          },
        };
      }
      return { ok: false, reason: "forbidden" };
    }
    if (support.reason === "anonymous") {
      return { ok: false, reason: "anonymous" };
    }
    return { ok: false, reason: "forbidden" };
  }

  return session ? { ok: false, reason: "forbidden" } : { ok: false, reason: "anonymous" };
}

/** S1 can render this only after resolving the verified Branding tenant. */
export function brandProposalEntry(session: IdentitySession, tenantId: TenantId): { href: string; label: string } | null {
  return authorizeBrandProposalAction(session, tenantId, "brand.proposal.upload").allowed
    ? { href: `/admin/tenants/${encodeURIComponent(tenantId)}/brand-proposals`, label: "Review brand proposals" }
    : null;
}
