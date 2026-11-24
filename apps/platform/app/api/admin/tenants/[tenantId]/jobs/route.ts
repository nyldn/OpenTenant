import { installationOwnerContext } from "../../../../../../lib/installation-owner";
import { tenantJobStatus } from "../../../../../../lib/tenant-worker-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const gate = await installationOwnerContext("owner.tenant.read");
  if (!gate.ok) return new Response("forbidden", { status: 403, headers });
  const { tenantId } = await params;
  const status = await tenantJobStatus(tenantId);
  if (!status) return new Response("Not found", { status: 404, headers });
  const manage = await installationOwnerContext("owner.tenant.create");
  return Response.json({ ...status, canManage: manage.ok }, { headers });
}
