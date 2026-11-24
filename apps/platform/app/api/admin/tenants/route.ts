import { serverConfig } from "../../../../lib/server-config";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { installationOwnerContext } from "../../../../lib/installation-owner";
import { sameOrigin } from "../../../../lib/settings-guard";
import { readBoundedForm } from "../../../../lib/bounded-body";
import { enqueueTenantProvisioning } from "../../../../lib/tenant-worker-store";
import { validateOwnerEmail } from "../../../../lib/tenant-lifecycle-policy";

export const runtime = "nodejs";

/** Only durable local writes occur in the request; provider work runs in the worker. */
export async function POST(req: Request): Promise<Response> {
  const gate = await installationOwnerContext("owner.tenant.create");
  if (!gate.ok || !sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceRateLimit(req, { tenantId: "installation", userId: gate.context.authority.userId, routeClass: "tenant-creation" });
  if (limited) return limited;
  const form = await readBoundedForm(req);
  const displayName = String(form?.get("displayName") ?? "").trim();
  const slug = String(form?.get("slug") ?? "").trim().toLowerCase();
  const dataRegion = form?.get("dataRegion");
  const brand = String(form?.get("cssBrandKey") ?? "").trim();
  const invalid = (error: string) => Response.redirect(new URL(`/admin/tenants/new?error=${error}`, req.url), 303);
  if (!displayName || displayName.length > 60) return invalid("name");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug)) return invalid("slug");
  if (dataRegion !== "us" && dataRegion !== "eu" && !(dataRegion === "ap" && serverConfig().PROVISIONING_PROVIDER === "postgres")) return invalid("region");
  if (brand && !/^[a-z0-9-]{1,32}$/.test(brand)) return invalid("brand");
  let ownerEmail: string;
  try { ownerEmail = validateOwnerEmail(String(form?.get("ownerEmail") ?? "")); }
  catch { return invalid("owner"); }
  try {
    const result = await enqueueTenantProvisioning({ slug, displayName, dataRegion, ownerEmail, actor: { kind: "installation_owner", userId: gate.context.authority.userId } });
    return Response.json(result, { status: 202, headers: { location: `/admin/tenants/${result.tenantId}`, "cache-control": "no-store" } });
  } catch { return new Response("Tenant setup could not be queued", { status: 409 }); }
}
