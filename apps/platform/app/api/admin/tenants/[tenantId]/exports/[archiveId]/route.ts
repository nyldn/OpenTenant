import { installationOwnerContext } from "../../../../../../../lib/installation-owner";
import { downloadTenantExport } from "../../../../../../../lib/tenant-export";
export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string; archiveId: string }> }): Promise<Response> {
  const gate = await installationOwnerContext("owner.tenant.create");
  if (!gate.ok) return new Response("forbidden", { status: 403 });
  const { tenantId, archiveId } = await params;
  const data = await downloadTenantExport(tenantId, archiveId, { kind: "installation_owner", userId: gate.context.authority.userId }, undefined, req.signal);
  return data ? new Response(data.body, { headers: { "content-length": String(data.byteLength), "content-type": "application/gzip", "content-disposition": 'attachment; filename="tenant-export.tar.gz"', "cache-control": "no-store", "x-content-type-options": "nosniff" } }) : new Response("Not found", { status: 404 });
}
