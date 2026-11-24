import { enforceRateLimit } from "../../../../../../lib/rate-limit";
import { installationOwnerContext } from "../../../../../../lib/installation-owner";
import { sameOrigin } from "../../../../../../lib/settings-guard";
import { readBoundedForm } from "../../../../../../lib/bounded-body";
import { changeTenantLifecycle, requestTenantExport } from "../../../../../../lib/tenant-lifecycle";
export const runtime = "nodejs";
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const gate = await installationOwnerContext("owner.tenant.create");
  if (!gate.ok || !sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceRateLimit(req, { tenantId: "installation", userId: gate.context.authority.userId, routeClass: "tenant-creation" });
  if (limited) return limited;
  const { tenantId } = await params;
  const form = await readBoundedForm(req);
  const action = form?.get("action");
  const actor = { kind: "installation_owner" as const, userId: gate.context.authority.userId };
  try {
    if (action === "export") return Response.json({ jobId: await requestTenantExport(tenantId, actor) }, { status: 202 });
    if (action !== "suspend" && action !== "resume" && action !== "delete" && action !== "cancel_delete") return new Response("Invalid action", { status: 400 });
    // Require a deliberate, named confirmation independently of the browser UI.
    if (action === "delete") {
      const { tenantOperations } = await import("../../../../../../lib/tenant-worker-store");
      const { tenant } = await tenantOperations(tenantId);
      if (form?.get("confirmed") !== "delete" || !tenant || form.get("tenantName") !== tenant.display_name) {
        return new Response("Explicit tenant confirmation required", { status: 400 });
      }
    }
    const jobId = await changeTenantLifecycle(tenantId, action, actor);
    return Response.json({ jobId }, { status: jobId ? 202 : 200 });
  } catch { return new Response("Tenant action unavailable", { status: 409 }); }
}
