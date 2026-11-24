import { randomUUID } from "node:crypto";
import { NeonProvisioner, PostgresProvisioner } from "@opentenant/provisioning";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import { serverConfig } from "./server-config";
import { LocalTenantExportSink, type TenantExportSink } from "./tenant-export";
import { workerAudit, type TenantWorkerJob } from "./tenant-worker-store";

export interface TenantDatabaseEraser { deleteProject(id: string): Promise<void> }
function provisioner(): TenantDatabaseEraser {
  const config = serverConfig();
  if (config.PROVISIONING_PROVIDER === "postgres") return new PostgresProvisioner(config.POSTGRES_ADMIN_DATABASE_URL ?? "");
  if (!config.NEON_API_KEY || !config.NEON_ORG_ID) throw new Error("Missing provisioner configuration");
  return new NeonProvisioner({ apiKey: config.NEON_API_KEY, orgId: config.NEON_ORG_ID });
}

/** Fail closed on a missing/revoked job, even if a worker holds an old payload. */
export function tenantEraseAllowed(tenant: { status: string; erase_after: Date | null } | undefined, job: TenantWorkerJob | undefined, now: Date): boolean {
  if (!tenant || tenant.status !== "deleted" || !job || job.kind !== "erase" || job.result.cancelled === "true" || job.status === "completed") return false;
  if (!tenant.erase_after || tenant.erase_after > now) throw new Error("Tenant retention has not elapsed");
  return true;
}

export async function eraseTenant(job: TenantWorkerJob, eraser?: TenantDatabaseEraser, sink: TenantExportSink = new LocalTenantExportSink()): Promise<void> {
  // Serialize physical retries as well as Graphile deliveries. This is a separate
  // lock from runTenantJob's session lock, so that entry point can call us safely.
  const lock = await controlPlanePool().connect();
  try {
    await lock.query(`select pg_advisory_lock(hashtextextended($1,0))`, [`tenant-erase:${job.tenant_id}`]);
    await eraseClaimedTenant(job, eraser, sink);
  } finally {
    try { await lock.query(`select pg_advisory_unlock(hashtextextended($1,0))`, [`tenant-erase:${job.tenant_id}`]); }
    finally { lock.release(); }
  }
}

async function eraseClaimedTenant(job: TenantWorkerJob, eraser: TenantDatabaseEraser | undefined, sink: TenantExportSink): Promise<void> {
  const row = await withControlPlaneTransaction(async client => {
    const tenant = (await client.query<{ status: string; erase_after: Date | null; database_erased_at: Date | null }>(`select status,erase_after,database_erased_at from tenants where tenant_id=$1 for update`, [job.tenant_id])).rows[0];
    const current = (await client.query<TenantWorkerJob>(`select * from tenant_worker_jobs where id=$1 and tenant_id=$2 for update`, [job.id, job.tenant_id])).rows[0];
    if (!tenantEraseAllowed(tenant, current, new Date())) return null;
    const project = (await client.query<{ project_id: string }>(`select project_id from provisioning_jobs where tenant_id=$1 and kind='provision'`, [job.tenant_id])).rows[0];
    if (!tenant.database_erased_at && !project?.project_id) throw new Error("Missing tenant project checkpoint");
    // Commit BEFORE contacting the provider. An uncertain or failed provider
    // outcome must never permit restoration of potentially erased data.
    await client.query(`update tenant_worker_jobs set result=result || '{"eraseStarted":"true"}'::jsonb,updated_at=now() where id=$1`, [job.id]);
    return { ...tenant, project_id: project?.project_id };
  });
  if (!row) return;
  const db = controlPlanePool();
  if (!row.database_erased_at) {
    await (eraser ?? provisioner()).deleteProject(row.project_id!);
    await db.query(`update tenants set database_erased_at=now() where tenant_id=$1 and status='deleted'`, [job.tenant_id]);
  }
  for (const { id } of (await db.query<{ id: string }>(`select id from tenant_export_archives where tenant_id=$1 union select id from tenant_worker_jobs where tenant_id=$1 and kind='export'`, [job.tenant_id])).rows) await sink.remove(id);
  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tenantWorkerConfig } = await import("./tenant-worker-config");
  for (const { id } of (await db.query<{ id: string }>(`select id from tenant_owner_invites where tenant_id=$1`, [job.tenant_id])).rows) {
    await rm(join(tenantWorkerConfig().inviteDirectory, `${id}.json`), { force: true });
    await rm(join(tenantWorkerConfig().inviteDirectory, `${id}.json.pending`), { force: true });
  }
  await withControlPlaneTransaction(async (client) => {
    // Receipts belong to individual events; the shared sink cursor is only a hint.
    // Detach that hint before FK traversal can erase other tenants' receipts.
    await client.query(`update usage_export_cursors set last_event_id=null where last_event_id in (select event_id from exact_usage_events where tenant_id=$1)`, [job.tenant_id]);
    await client.query(`select hard_erase_tenant($1)`, [job.tenant_id]);
    await workerAudit(client, { kind: "system", job: "tenant-hard-erase" }, null, "tenant.erased", randomUUID(), { erased: true });
  });
}
