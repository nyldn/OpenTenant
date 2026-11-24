import { tenantAdminContext } from "./tenant-admin";
import { sameOrigin } from "./settings-guard";
import { readBoundedForm } from "./bounded-body";
import { addCustomDomain, reissueCustomDomain, removeCustomDomain, verifyCustomDomain, type TxtResolver } from "./custom-domains";


/** Dependency injection is server-side only; no request can choose a resolver. */
export function domainMutation(resolveTxt: TxtResolver) {
  return async (req: Request): Promise<Response> => {
    const gate = await tenantAdminContext();
    if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
    if (gate.context.managedSupport) return new Response("forbidden", { status: 403 });
    const { tenant, session, auditActor } = gate.context;
    if (session.activeTenantId !== tenant.tenantId || !["tenant_owner", "tenant_admin"].includes(session.activeRole ?? "")) return new Response("forbidden", { status: 403 });
    if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
    const form = await readBoundedForm(req);
    if (!form) return new Response("bad form", { status: 400 });
    const host = String(form.get("host") ?? "");
    const action = form.get("action");
    try {
      let result: unknown;
      if (action === "add") result = await addCustomDomain(tenant.tenantId, host, auditActor);
      else if (action === "reissue") result = await reissueCustomDomain(tenant.tenantId, host, auditActor);
      else if (action === "verify") result = await verifyCustomDomain(tenant.tenantId, host, auditActor, resolveTxt);
      else if (action === "remove") { await removeCustomDomain(tenant.tenantId, host, auditActor); result = { removed: true }; }
      else return new Response("bad action", { status: 400 });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Domain operation failed. Check the subdomain and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  };
}
