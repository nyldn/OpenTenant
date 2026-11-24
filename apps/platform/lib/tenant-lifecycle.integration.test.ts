import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "graphile-worker";
import { applyMigrations } from "@opentenant/migrations";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { changeTenantLifecycle } from "./tenant-lifecycle";
import { eraseTenant } from "./tenant-erase";
import { tenantJob, retryTenantJob } from "./tenant-worker-store";
import { PgAuditStore } from "@opentenant/database";
import { takeProcessSingleton } from "@opentenant/platform-core/runtime-globals";
const url = integrationDatabaseUrl("TENANT_WORKER_DATABASE_URL");
const suite = url ? describe : describe.skip;
suite("deletion cancellation on real Postgres", () => {
  const admin = new Pool({ connectionString: url });
  const database = `opentenant_it_lifecycle_${randomUUID().replaceAll("-", "")}`;
  let db: Pool;
  const actor = { kind: "installation_owner" as const, userId: "operator_example" };
  beforeAll(async () => {
    // The requested two-file run executes suites concurrently. Give this suite
    // its own database within the ephemeral cluster, including Graphile's schema.
    await admin.query(`create database "${database}"`);
    const isolated = new URL(url!);
    isolated.pathname = `/${database}`;
    db = new Pool({ connectionString: isolated.href });
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", isolated.href);
    await applyMigrations(db, await loadControlPlaneMigrations());
    await runMigrations({ pgPool: db });
  }, 120000);
  afterAll(async () => {
    await db?.end();
    await takeProcessSingleton<Pool>(Symbol.for("opentenant.control-plane-pool"))?.end();
    vi.unstubAllEnvs();
    await admin.query(`drop database if exists "${database}"`);
    await admin.end();
  });
  async function seed(status: string) {
    const id = `ten_${randomUUID()}`;
    await db.query(`insert into tenants(tenant_id,slug,display_name,status,data_region) values ($1,$2,'Example Tenant',$3,'us')`, [id, `cancel-${randomUUID()}`, status]);
    return id;
  }
  it.each(["active", "suspended"])("restores %s and fences stale/retried jobs across a later deletion", async status => {
    const id = await seed(status);
    const jobId = (await changeTenantLifecycle(id, "delete", actor))!;
    const stale = (await tenantJob(jobId, id))!;
    await expect(changeTenantLifecycle(id, "delete", actor)).rejects.toThrow();
    await changeTenantLifecycle(id, "cancel_delete", actor);
    expect((await db.query(`select status,deleted_at,erase_after from tenants where tenant_id=$1`, [id])).rows[0]).toEqual({ status, deleted_at: null, erase_after: null });
    expect((await db.query(`select * from graphile_worker.jobs where key=$1`, [`tenant-job:${jobId}`])).rowCount).toBe(0);
    const eraser = { deleteProject: vi.fn() };
    const sink = { remove: vi.fn(), write: vi.fn(), read: vi.fn() };
    // Simulate a worker that fetched the payload before cancellation and then
    // overwrote status with running. Revocation must survive that stale write.
    await db.query(`update tenant_worker_jobs set status='running' where id=$1`, [jobId]);
    await eraseTenant(stale, eraser, sink);
    await changeTenantLifecycle(id, "delete", actor);
    await db.query(`update tenants set erase_after=now()-interval '1 second' where tenant_id=$1`, [id]);
    await eraseTenant(stale, eraser, sink);
    expect(eraser.deleteProject).not.toHaveBeenCalled();
    expect(sink.remove).not.toHaveBeenCalled();
    await db.query(`update tenant_worker_jobs set status='failed' where id=$1`, [jobId]);
    await expect(retryTenantJob(id, jobId, actor)).rejects.toThrow("revoked");
    expect((await db.query(`select action,detail from audit_events where tenant_id=$1 and action='tenant.deletion_cancelled'`, [id])).rows).toEqual([{ action: "tenant.deletion_cancelled", detail: { jobId, restoredStatus: status } }]);
    expect((await new PgAuditStore(db).verifyChain(id)).intact).toBe(true);
  });
  it("rechecks revocation after cancellation wins against an erase waiting on its lock", async () => {
    const id = await seed("suspended");
    const jobId = (await changeTenantLifecycle(id, "delete", actor))!;
    const stale = (await tenantJob(jobId, id))!;
    const lock = await db.connect();
    const eraser = { deleteProject: vi.fn() };
    const sink = { remove: vi.fn(), write: vi.fn(), read: vi.fn() };
    let erasing: Promise<void> | undefined;
    try {
      await lock.query(`select pg_advisory_lock(hashtextextended($1,0))`, [`tenant-erase:${id}`]);
      erasing = eraseTenant(stale, eraser, sink);
      await expect.poll(async () => Number((await db.query(`select count(*) from pg_locks where locktype='advisory' and not granted`)).rows[0].count)).toBeGreaterThan(0);
      await changeTenantLifecycle(id, "cancel_delete", actor);
    } finally {
      await lock.query(`select pg_advisory_unlock(hashtextextended($1,0))`, [`tenant-erase:${id}`]);
      lock.release();
      await erasing;
    }
    expect((await db.query(`select status from tenants where tenant_id=$1`, [id])).rows[0].status).toBe("suspended");
    expect(eraser.deleteProject).not.toHaveBeenCalled();
    expect(sink.remove).not.toHaveBeenCalled();
  }, 30000);
  it("commits the erase claim before a provider call and denies concurrent cancellation and retries after provider failure", async () => {
    const id = await seed("active");
    await db.query(`insert into provisioning_jobs(tenant_id,kind,project_id) values ($1,'provision','synthetic')`, [id]);
    const jobId = (await changeTenantLifecycle(id, "delete", actor))!;
    const job = (await tenantJob(jobId, id))!;
    await db.query(`update tenants set erase_after=now()-interval '1 second' where tenant_id=$1`, [id]);
    let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const eraser = { deleteProject: vi.fn(async () => { started(); await barrier; throw new Error("synthetic provider outage"); }) };
    const erasing = eraseTenant(job, eraser);
    try {
      await entered;
      // Move the deadline back into retention to prove that the committed
      // physical-start checkpoint independently prevents restoration.
      await db.query(`update tenants set erase_after=now()+interval '1 hour' where tenant_id=$1`, [id]);
      await expect(changeTenantLifecycle(id, "cancel_delete", actor)).rejects.toThrow();
      expect((await tenantJob(jobId, id))?.result.eraseStarted).toBe("true");
    } finally { release(); }
    await expect(erasing).rejects.toThrow("provider outage");
    await expect(changeTenantLifecycle(id, "cancel_delete", actor)).rejects.toThrow();
    expect((await db.query(`select status from tenants where tenant_id=$1`, [id])).rows[0].status).toBe("deleted");
  }, 30000);
});
