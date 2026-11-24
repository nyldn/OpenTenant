import type { PoolClient } from "pg";
import type { AuditActor } from "@opentenant/security";
import { withControlPlaneTransaction } from "./control-plane";
import { lifecycleTransition, type LifecycleAction } from "./tenant-lifecycle-policy";
import { tenantWorkerConfig } from "./tenant-worker-config";
import { queueTenantJob, workerAudit, type TenantWorkerJob } from "./tenant-worker-store";
export { suspendedTenantResponse } from "./tenant-lifecycle-policy";

async function cancelDeletion(client: PoolClient, tenantId: string, actor: AuditActor, tenant: { status: string; erase_after: Date | null; database_erased_at: Date | null }): Promise<void> {
  const jobs = (await client.query<TenantWorkerJob>(`select * from tenant_worker_jobs where tenant_id=$1 and kind='erase' order by created_at desc for update`, [tenantId])).rows;
  const job = jobs.find(job => job.result.cancelled !== "true");
  const next = lifecycleTransition(tenant.status, "cancel_delete", new Date(), 0, {
    priorStatus: job?.input.priorStatus,
    eraseAfter: tenant.erase_after,
    erasureStarted: !!tenant.database_erased_at || job?.result.eraseStarted === "true",
  });
  if (!job) throw new Error("Missing deletion checkpoint");
  // Complete revoked rows too: the worker may already have fetched a queue payload.
  // The durable result flag is checked again by eraseTenant under the tenant lock.
  for (const pending of jobs) {
    await client.query(`update tenant_worker_jobs set status='completed',result=result || '{"cancelled":"true"}'::jsonb,last_error=null,updated_at=now() where id=$1`, [pending.id]);
    await client.query(`select graphile_worker.remove_job($1)`, [`tenant-job:${pending.id}`]);
  }
  await client.query(`update tenants set status=$2,deleted_at=null,erase_after=null,updated_at=now() where tenant_id=$1`, [tenantId, next.status]);
  await workerAudit(client, actor, tenantId, "tenant.deletion_cancelled", tenantId, { jobId: job.id, restoredStatus: next.status });
}

export async function changeTenantLifecycle(tenantId: string, action: LifecycleAction, actor: AuditActor): Promise<string | null> {
  return withControlPlaneTransaction(async (client) => {
    // This row lock is also the erase claim's lock. Cancellation and physical
    // erasure have exactly one winner, including direct/retried worker calls.
    const tenant = (await client.query<{ status: string; erase_after: Date | null; database_erased_at: Date | null }>(`select status,erase_after,database_erased_at from tenants where tenant_id=$1 for update`, [tenantId])).rows[0];
    if (!tenant) throw new Error("Unknown tenant");
    if (action === "cancel_delete") { await cancelDeletion(client, tenantId, actor, tenant); return null; }
    const next = lifecycleTransition(tenant.status, action, new Date(), tenantWorkerConfig().retentionHours);
    await client.query(`update tenants set status=$2,deleted_at=case when $2='deleted' then now() else deleted_at end,erase_after=$3,updated_at=now() where tenant_id=$1`, [tenantId, next.status, next.eraseAfter ?? null]);
    const jobId = next.eraseAfter ? await queueTenantJob(client, { tenantId, kind: "erase", actor, runAt: next.eraseAfter, input: { priorStatus: tenant.status } }) : null;
    await workerAudit(client, actor, tenantId, `tenant.${action}`, tenantId, { jobId, eraseAfter: next.eraseAfter?.toISOString() ?? null });
    return jobId;
  });
}

export async function requestTenantExport(tenantId: string, actor: AuditActor): Promise<string> {
  return withControlPlaneTransaction(async (client) => {
    const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [tenantId]);
    if (!["active", "suspended"].includes(tenant.rows[0]?.status)) throw new Error("Tenant unavailable");
    const id = await queueTenantJob(client, { tenantId, kind: "export", actor });
    await workerAudit(client, actor, tenantId, "tenant.export_requested", id);
    return id;
  });
}
