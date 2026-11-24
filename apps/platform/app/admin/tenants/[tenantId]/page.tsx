import { TenantOperations } from "../tenant-action-form";
import { notFound } from "next/navigation";
import { installationOwnerContext } from "../../../../lib/installation-owner";
import { tenantJobStatus } from "../../../../lib/tenant-worker-store";
import { tenantWorkerConfig } from "../../../../lib/tenant-worker-config";
export const dynamic = "force-dynamic";
export default async function TenantOperationsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const gate = await installationOwnerContext("owner.tenant.read");
  // Per-tenant admin documents stay 404 for anyone who is not an installation
  // owner, signed out included. The baseline records this status as reviewed
  // authorization evidence (tooling/e2e/audit/compare.mjs never remaps status).
  if (!gate.ok) notFound();
  const { tenantId } = await params;
  const status = await tenantJobStatus(tenantId);
  if (!status) notFound();
  const manage = await installationOwnerContext("owner.tenant.create");
  return <TenantOperations initial={{ ...status, canManage: manage.ok }} retentionHours={tenantWorkerConfig().retentionHours} />;
}
