import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { PgAuditStore } from "@opentenant/database";
import type { AuditActor } from "@opentenant/security";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import { tenantHostname } from "./server-config";
import { validateOwnerEmail } from "./tenant-lifecycle-policy";

export type TenantJobKind = "provision" | "export" | "erase" | "owner_grant";
export interface TenantWorkerJob {
  id: string; tenant_id: string; kind: TenantJobKind; status: string; attempts: number;
  actor: AuditActor; input: Record<string, string>; result: Record<string, string>;
  run_at: Date; last_error: string | null;
}

export async function workerAudit(client: PoolClient, actor: AuditActor, tenantId: string | null, action: string, subject: string, detail: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await new PgAuditStore(controlPlanePool()).appendWithClient(client, { occurredAt: new Date(), actor, tenantId, action, subject, detail });
}

/** Queue insertion commits with the domain mutation. Worker migrations run at process setup. */
export async function queueTenantJob(client: PoolClient, input: { tenantId: string; kind: TenantJobKind; actor: AuditActor; input?: Record<string, string>; runAt?: Date }): Promise<string> {
  const id = randomUUID();
  await client.query(`insert into tenant_worker_jobs(id,tenant_id,kind,actor,input,run_at) values ($1,$2,$3,$4,$5,coalesce($6,now()))`, [id, input.tenantId, input.kind, JSON.stringify(input.actor), JSON.stringify(input.input ?? {}), input.runAt ?? null]);
  await scheduleTenantJob(client, id, input.tenantId, input.runAt);
  return id;
}

async function scheduleTenantJob(client: PoolClient, id: string, tenantId: string, runAt?: Date): Promise<void> {
  await client.query(`select graphile_worker.add_job('tenant_job', payload := $1::json, queue_name := $2, run_at := coalesce($3,now()), max_attempts := 5::smallint, job_key := $4)`, [JSON.stringify({ jobId: id }), `tenant:${tenantId}`, runAt ?? null, `tenant-job:${id}`]);
}

export async function enqueueTenantProvisioning(input: { slug: string; displayName: string; dataRegion: "us" | "eu" | "ap"; ownerEmail: string; actor: AuditActor }): Promise<{ tenantId: string; jobId: string }> {
  const ownerEmail = validateOwnerEmail(input.ownerEmail);
  const host = tenantHostname(input.slug);
  return withControlPlaneTransaction(async (client) => {
    const tenantId = `ten_${randomUUID()}`;
    await client.query(`insert into tenants(tenant_id,slug,display_name,status,data_region) values ($1,$2,$3,'provisioning',$4)`, [tenantId, input.slug, input.displayName, input.dataRegion]);
    await client.query(`insert into brand_policies(tenant_id) values ($1)`, [tenantId]);
    await client.query(`insert into domains(host,tenant_id,kind,verification,active) values ($1,$2,'opentenant_subdomain','verified',true)`, [host, tenantId]);
    const jobId = await queueTenantJob(client, { tenantId, kind: "provision", actor: input.actor, input: { ownerEmail } });
    await workerAudit(client, input.actor, tenantId, "tenant.created", input.slug, { jobId });
    return { tenantId, jobId };
  });
}

export async function retryTenantJob(tenantId: string, id: string, actor: AuditActor): Promise<void> {
  await withControlPlaneTransaction(async (client) => {
    const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [tenantId]);
    const row = await client.query<TenantWorkerJob>(`select * from tenant_worker_jobs where id=$1 and tenant_id=$2 for update`, [id, tenantId]);
    const job = row.rows[0];
    if (!job || job.status !== "failed") throw new Error("Job is not retryable");
    if (job.result.cancelled === "true" || (job.kind === "erase" && tenant.rows[0]?.status !== "deleted")) throw new Error("Deletion revoked");
    if (tenant.rows[0]?.status === "deleted" && job.kind !== "erase") throw new Error("Tenant deleted");
    await client.query(`update tenant_worker_jobs set status='pending',attempts=0,last_error=null,updated_at=now() where id=$1`, [id]);
    await scheduleTenantJob(client, id, tenantId, job.run_at);
    await workerAudit(client, actor, tenantId, "tenant.job_retried", id, { kind: job.kind });
  });
}

export async function tenantJob(id: string, tenantId: string): Promise<TenantWorkerJob | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const result = await controlPlanePool().query<TenantWorkerJob>(`select * from tenant_worker_jobs where id=$1 and tenant_id=$2`, [id, tenantId]);
  return result.rows[0] ?? null;
}

export async function tenantOperations(tenantId: string) {
  const tenant = await controlPlanePool().query<{ tenant_id: string; slug: string; display_name: string; status: string; erase_after: Date | null }>(`select tenant_id,slug,display_name,status,erase_after from tenants where tenant_id=$1`, [tenantId]);
  const jobs = await controlPlanePool().query<TenantWorkerJob>(`select * from tenant_worker_jobs where tenant_id=$1 order by created_at desc limit 50`, [tenantId]);
  return { tenant: tenant.rows[0] ?? null, jobs: jobs.rows };
}

/** Explicit browser projection. Never expose job inputs, actor, provider errors or results. */
export async function tenantJobStatus(tenantId: string) {
  const { tenant, jobs } = await tenantOperations(tenantId);
  if (!tenant) return null;
  return {
    tenant: { id: tenant.tenant_id, name: tenant.display_name, slug: tenant.slug, status: tenant.status, eraseAfter: tenant.erase_after?.toISOString() ?? null },
    jobs: jobs.map(job => ({ id: job.id, kind: job.kind, status: job.result.cancelled === "true" ? "cancelled" : job.status, attempts: job.attempts })),
  };
}
export type TenantJobStatus = NonNullable<Awaited<ReturnType<typeof tenantJobStatus>>>;
