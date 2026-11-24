import { PgAuditStore } from "@opentenant/database";
import { updateEntitlementWithAuthorization } from "../../../../lib/authz-entitlement";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { readBoundedForm } from "../../../../lib/bounded-body";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { settingsResult } from "../../../settings/_lib/form-response";

export const runtime = "nodejs";

/** Entitlements require installation authority, beyond tenant access settings.
 * Only existing assignments can be toggled; assignment/ownership checks stay
 * with the existing catalog store. Never create entitlements from a form.
 */
export async function POST(req: Request): Promise<Response> {
  const gate = await tenantAdminContext("module.access.configure");
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!gate.context.session.isPlatformAdmin || gate.context.managedSupport) return new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const form = await readBoundedForm(req);
  const moduleKey = String(form?.get("moduleKey") ?? "");
  const enabled = form?.get("enabled");
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(moduleKey) || (enabled !== "true" && enabled !== "false")) return new Response("bad module", { status: 400 });
  try {
    const found = await withControlPlaneTransaction(async client => {
      if (!await updateEntitlementWithAuthorization(client, {
        tenantId: gate.context.tenant.tenantId, moduleKey, enabled: enabled === "true",
      })) return false;
      await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
        occurredAt: new Date(), actor: gate.context.auditActor, tenantId: gate.context.tenant.tenantId,
        action: "module.entitlement_changed", subject: moduleKey, detail: { enabled: enabled === "true" },
      });
      return true;
    });
    if (!found) return new Response("not found", { status: 404 });
  } catch { return new Response("internal error", { status: 500 }); }
  return settingsResult(req, "/settings/modules", { status: "success", message: "Module access saved." });
}
