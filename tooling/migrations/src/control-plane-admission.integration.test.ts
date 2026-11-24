import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
if (process.env.OPENTENANT_LOCAL_POSTGRES_PROOF === "admission" && !integrationUrl) {
  throw new Error("admission PostgreSQL proof requires its controller-supplied database URL");
}
const describeIntegration = integrationUrl ? describe : describe.skip;
async function migrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()
    .map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(join(directory, name), "utf8") })));
}

describeIntegration("control-plane admission migration against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 8 });
  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade"); await pool.query("create schema public");
    await applyMigrations(pool, await migrations());
    await pool.query("insert into tenants (tenant_id, slug, display_name, status, data_region) values ('ten_admission_proof', 'admission-proof', 'Admission Proof', 'active', 'eu')");
  });
  afterAll(async () => pool.end());

  it("serializes concurrent admissions without exceeding the tenant limit", async () => {
    await pool.query(`insert into admission_policies (tenant_id, scope_key, principal_id, operation, max_requests, window_ms, max_concurrent, lease_ms, idempotency_ttl_ms, max_idempotency_entries, max_size_bytes)
      values ('ten_admission_proof','scope-race','principal','read',2,1000,10,100,1000,10,100)`);
    const attempts = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const client = await pool.connect(); try {
        await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["scope-race"]);
        const result = await client.query(`insert into admission_windows (tenant_id, scope_key, window_started_at, admitted_count, limit_count)
          values ('ten_admission_proof','scope-race',to_timestamp(1),1,2)
          on conflict (tenant_id, scope_key, window_started_at) do update set admitted_count = admission_windows.admitted_count + 1
          where admission_windows.admitted_count < admission_windows.limit_count returning admitted_count`);
        await client.query("commit"); return { index, admitted: result.rowCount === 1 };
      } finally { client.release(); }
    }));
    expect(attempts.filter((attempt) => attempt.admitted)).toHaveLength(2);
    expect((await pool.query("select admitted_count, limit_count from admission_windows where scope_key='scope-race'")).rows[0]).toEqual({ admitted_count: 2, limit_count: 2 });
  });

  it("rolls back leases and idempotency when the transaction fails", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into admission_policies (tenant_id, scope_key, principal_id, operation, max_requests, window_ms, max_concurrent, lease_ms, idempotency_ttl_ms, max_idempotency_entries, max_size_bytes)
        values ('ten_admission_proof','scope-rollback','principal','read',1,1000,1,100,1000,1,100)`);
      await client.query(`insert into admission_leases (tenant_id, scope_key, lease_id, principal_id, operation, admitted_at, expires_at, retained_until, status, policy_snapshot)
        values ('ten_admission_proof','scope-rollback',$1,'principal','read',to_timestamp(2),to_timestamp(3),to_timestamp(4),'active','{}')`, ["b".repeat(32)]);
      await client.query(`insert into admission_idempotency_records (tenant_id, scope_key, idempotency_key, fingerprint, lease_id, retained_until)
        values ('ten_admission_proof','scope-rollback','rollback-key','fingerprint',$1,to_timestamp(4))`, ["b".repeat(32)]);
      await client.query("rollback");
    } finally { client.release(); }
    expect((await pool.query("select count(*)::int as count from admission_leases where scope_key='scope-rollback'")).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int as count from admission_idempotency_records where scope_key='scope-rollback'")).rows[0].count).toBe(0);
  });
});
