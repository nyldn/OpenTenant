import type { TenantId } from "@opentenant/auth";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import { withTenantDb } from "./tenant-db";
import { workerAudit, type TenantWorkerJob } from "./tenant-worker-store";
import { exportControlTables, exportTenantTables } from "./tenant-export-reader";
import { LocalTenantExportSink, archiveId, type TenantExportDownload, type TenantExportSink } from "./tenant-export-sink";
import { TenantExportError, type TenantExportOptions } from "./tenant-export-bounds";
export { LocalTenantExportSink, type TenantExportSink, type TenantExportDownload } from "./tenant-export-sink";
export { TENANT_EXPORT_LIMITS, TenantExportError, type TenantExportOptions } from "./tenant-export-bounds";

export async function exportTenant(job: TenantWorkerJob, sink: TenantExportSink = new LocalTenantExportSink(), options: TenantExportOptions = {}): Promise<void> {
  archiveId(job.id);
  try {
    const status = await controlPlanePool().query(`select status from tenants where tenant_id=$1`, [job.tenant_id]);
    if (!["active", "suspended"].includes(status.rows[0]?.status)) throw new TenantExportError("unavailable");
    await sink.write(job.id, async (append, budget) => {
      // Keep each cursor within its transaction and the stored application URI's
      // forced-RLS context. No provisioner or administrator tenant connection.
      await withTenantDb(job.tenant_id as TenantId, client => exportTenantTables(client, job.tenant_id, append, budget));
      await withControlPlaneTransaction(client => exportControlTables(client, job.tenant_id, append, budget));
    }, options);
    await withControlPlaneTransaction(async client => {
      // Lock against lifecycle deletion before publishing authority.
      const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [job.tenant_id]);
      if (!["active", "suspended"].includes(tenant.rows[0]?.status)) throw new TenantExportError("unavailable");
      await client.query(`insert into tenant_export_archives(id,tenant_id,expires_at) values ($1,$2,now()+interval '24 hours') on conflict (id) do nothing`, [job.id, job.tenant_id]);
      await workerAudit(client, job.actor, job.tenant_id, "tenant.export_completed", job.id);
    });
  } catch (error) {
    await sink.remove(job.id);
    await withControlPlaneTransaction(client => workerAudit(client, job.actor, job.tenant_id, "tenant.export_failed", job.id, { reason: error instanceof TenantExportError ? error.code : "export_failed" }));
    throw new TenantExportError(error instanceof TenantExportError ? error.code : "failed");
  }
}

export async function downloadTenantExport(tenantId: string, id: string, actor: TenantWorkerJob["actor"], sink: TenantExportSink = new LocalTenantExportSink(), signal?: AbortSignal): Promise<TenantExportDownload | null> {
  try { archiveId(id); } catch { return null; }
  const result = await controlPlanePool().query(`select a.id from tenant_export_archives a join tenants t on t.tenant_id=a.tenant_id where a.id=$1 and a.tenant_id=$2 and a.expires_at>now() and t.status in ('active','suspended')`, [id, tenantId]);
  if (!result.rows[0]) return null;
  let data: TenantExportDownload;
  try { data = await sink.read(id, signal); } catch { return null; }
  try { await withControlPlaneTransaction(client => workerAudit(client, actor, tenantId, "tenant.export_downloaded", id)); }
  catch (error) { await data.body.cancel(); throw error; }
  return data;
}

export async function expireTenantExports(sink: TenantExportSink = new LocalTenantExportSink()): Promise<void> {
  // Bound cleanup too, including installations with a large expired backlog.
  await sink.cleanup?.();
  for (let batch = 0; batch < 100; batch++) {
    const { rows } = await controlPlanePool().query<{ id: string }>(`select id from tenant_export_archives where expires_at<=now() order by id limit 100`);
    for (const { id } of rows) {
      await sink.remove(id);
      await controlPlanePool().query(`delete from tenant_export_archives where id=$1 and expires_at<=now()`, [id]);
    }
    if (rows.length < 100) return;
  }
}
