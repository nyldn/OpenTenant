import type { TenantId } from "@opentenant/auth";
import { currentTenant } from "../../../../../../lib/tenant";
import { currentSession } from "../../../../../../lib/session";
import { tenantAdminContext } from "../../../../../../lib/tenant-admin";
import { readTenantBrandingAsset } from "../../../../../../lib/tenant-branding-assets";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host", "X-Content-Type-Options": "nosniff" };
  const tenant = await currentTenant();
  if (!tenant) return new Response("Not found", { status: 404, headers });
  const session = await currentSession(tenant.tenantId as TenantId);
  const member = session?.activeTenantId === tenant.tenantId && ["tenant_owner", "tenant_admin", "tenant_member"].includes(session.activeRole ?? "");
  if (!member) {
    const gate = await tenantAdminContext("branding.configure");
    if (!gate.ok || gate.context.tenant.tenantId !== tenant.tenantId) return new Response("Not found", { status: 404, headers });
  }
  const asset = await readTenantBrandingAsset(tenant.tenantId, (await params).assetId);
  return asset ? new Response(new Uint8Array(asset.content), { headers: { ...headers, "Content-Type": asset.mime_type, "Content-Security-Policy": "default-src 'none'; sandbox" } }) : new Response("Not found", { status: 404, headers });
}
