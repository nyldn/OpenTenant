import { enforceRateLimit } from "../../../../lib/rate-limit";
import { PgAuditStore } from "@opentenant/database";
import { installationOwnerContext } from "../../../../lib/installation-owner";
import { sameOrigin } from "../../../../lib/settings-guard";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { writeManagedSupportPolicy } from "../../../../lib/tenant-settings-store";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";
const TENANT_NOT_FOUND = Symbol("tenant_not_found");

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const owner = await installationOwnerContext("owner.support.configure");
  if (!owner.ok) return new Response("forbidden", { status: 403 });
  // module-audit-exclude: installation operator support budget exists without any installed module.
  const limited = await enforceRateLimit(req, { tenantId: "installation", userId: owner.context.authority.userId, routeClass: "support" }); if (limited) return limited;
  const form = await readBoundedForm(req);
  const tenantId = String(form?.get("tenantId") ?? "");
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(tenantId)) return new Response("bad tenant", { status: 400 });
  const enabledValue = form?.get("enabled");
  if (enabledValue !== "true" && enabledValue !== "false") return new Response("bad policy", { status: 400 });
  const enabled = enabledValue === "true";
  try {
    await withControlPlaneTransaction(async (client) => {
      const found = await writeManagedSupportPolicy(client, tenantId, enabled);
      if (!found) throw TENANT_NOT_FOUND;
      await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
        occurredAt: new Date(),
        actor: { kind: "installation_owner", userId: owner.context.authority.userId },
        tenantId,
        action: "support.policy_changed",
        subject: tenantId,
        detail: { enabled },
      });
    });
  } catch (error) {
    if (error === TENANT_NOT_FOUND) return new Response("tenant not found", { status: 404 });
    return new Response("internal error", { status: 500 });
  }
  return Response.redirect(new URL("/admin", req.url), 303);
}
