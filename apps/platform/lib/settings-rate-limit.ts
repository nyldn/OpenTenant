/** Shared HTTP mutation gate. Call only after the route's authorization succeeds. */
import { enforceRateLimit, routeClassForPath } from "./rate-limit";
import type { TenantAdminContext, BrandProposalTenantContext } from "./tenant-admin";

type MutationContext = TenantAdminContext | BrandProposalTenantContext | { tenantId: string; session: { userId: string } };
export async function enforceMutationRateLimit(req: Request, context: MutationContext): Promise<Response | null> {
  const routeClass = routeClassForPath(new URL(req.url).pathname);
  if (!routeClass) return new Response("service unavailable", { status: 503 });
  const tenantId = "tenant" in context ? context.tenant.tenantId : context.tenantId;
  return enforceRateLimit(req, { tenantId, userId: context.session.userId, routeClass });
}
