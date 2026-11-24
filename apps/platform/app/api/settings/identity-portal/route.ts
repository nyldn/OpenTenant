import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import type { AdminPortalIntent, TenantId } from "@opentenant/auth";
import {
  identityProviderFromEnv,
  tenantOrgResolver,
  workosPort,
} from "../../../../lib/identity";
import { audit } from "../../../../lib/audit";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

const INTENTS: ReadonlySet<AdminPortalIntent> = new Set(["sso", "dsync", "domain_verification"]);

/**
 * Launches the identity provider's Admin Portal for this tenant. Links are
 * single-use and short-lived, so the response redirects the requesting admin
 * straight to the portal instead of storing or emailing the URL.
 */
export async function POST(req: Request): Promise<Response> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  if (identityProviderFromEnv() !== "workos") {
    return new Response("not found", { status: 404 });
  }
  const { session, tenant, auditActor: actor } = gate.context;

  const form = await readBoundedForm(req);
  const intent = String(form?.get("intent") ?? "");
  if (!INTENTS.has(intent as AdminPortalIntent)) {
    return new Response("unknown intent", { status: 400 });
  }

  if ((intent === "sso" || intent === "dsync") &&
      session.activeRole !== "tenant_owner" && !session.isPlatformAdmin) {
    return new Response("forbidden", { status: 403 });
  }

  const orgId = await tenantOrgResolver().externalOrganizationForTenant(tenant.tenantId as TenantId);
  if (!orgId) return new Response("tenant has no identity organization", { status: 409 });

  // Audit the request before issuance so a provider-side link can never
  // exist without a trail, even if this process dies mid-flight.
  try {
    await audit(actor, tenant.tenantId, "identity.portal_link_requested", intent, {
      intent,
    });
  } catch {
    return new Response("internal error", { status: 500 });
  }
  const link = await workosPort().generateAdminPortalLink(orgId, intent as AdminPortalIntent);
  if (link.protocol !== "https:") return new Response("unexpected portal link", { status: 502 });
  return Response.redirect(link, 303);
}
