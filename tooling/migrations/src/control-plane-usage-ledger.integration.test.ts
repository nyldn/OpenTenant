import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
if (process.env.OPENTENANT_LOCAL_POSTGRES_PROOF === "usage" && !integrationUrl) throw new Error("usage PostgreSQL proof requires its controller-supplied database URL");
const describeIntegration = integrationUrl ? describe : describe.skip;
async function migrations(): Promise<MigrationFile[]> { const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane"); return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".sql")).sort().map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(join(directory, name), "utf8") }))); }

describeIntegration("control-plane exact usage migration against PostgreSQL", () => {
  if (!integrationUrl) return; const pool = new Pool({ connectionString: integrationUrl, max: 4 });
  beforeAll(async () => { await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade"); await pool.query("create schema public"); await applyMigrations(pool, await migrations()); await pool.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('ten_usage_a','usage-a','Usage A','active','eu'),('ten_usage_b','usage-b','Usage B','active','eu')"); await pool.query("insert into usage_metric_definitions (tenant_id,metric_id,unit,description) values ('ten_usage_a','module.executions','execution','Completed module executions'),('ten_usage_b','module.executions','execution','Completed module executions'),('ten_usage_a','storage.bytes','byte','Stored bytes')"); });
  afterAll(async () => pool.end());

  it("rejects update, delete, and truncate while preserving correction evidence", async () => {
    await pool.query(`insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,idempotency_key) values ($1,'ten_usage_a','module.executions',5,'2026-08-06 10:00Z','source','original','original')`, ["a".repeat(32)]);
    await pool.query(`insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,idempotency_key,correction_of_event_id,correction_reason) values ($1,'ten_usage_a','module.executions',-2,'2026-08-06 10:00Z','source','correction','correction',$2,'Synthetic reconciliation')`, ["b".repeat(32), "a".repeat(32)]);
    await expect(pool.query("update exact_usage_events set quantity=1 where event_id=$1", ["a".repeat(32)])).rejects.toThrow();
    await expect(pool.query("delete from exact_usage_events where event_id=$1", ["a".repeat(32)])).rejects.toThrow();
    await expect(pool.query("truncate exact_usage_events")).rejects.toThrow();
    expect((await pool.query("select sum(quantity)::int as total from exact_usage_events where tenant_id='ten_usage_a' and metric_id='module.executions'")).rows[0].total).toBe(3);
  });

  it("isolates corrections by tenant and metric", async () => {
    const insert = `insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,idempotency_key,correction_of_event_id,correction_reason) values ($1,$2,$3,-1,$4,'source',$5,$5,$6,'Synthetic mismatch')`;
    await expect(pool.query(insert, ["c".repeat(32), "ten_usage_b", "module.executions", "2026-08-06 10:00Z", "cross-tenant", "a".repeat(32)])).rejects.toThrow();
    await expect(pool.query(insert, ["d".repeat(32), "ten_usage_a", "storage.bytes", "2026-08-06 10:00Z", "cross-metric", "a".repeat(32)])).rejects.toThrow();
    await expect(pool.query(insert, ["f".repeat(32), "ten_usage_a", "module.executions", "2026-08-06 10:00:00.001Z", "cross-window", "a".repeat(32)])).rejects.toThrow();
    await expect(pool.query(insert, ["1".repeat(32), "ten_usage_a", "module.executions", "2026-08-06 10:00Z", "correction-of-correction", "b".repeat(32)])).rejects.toThrow();
    expect((await pool.query("select count(*)::int as count, sum(quantity)::int as total from exact_usage_events where tenant_id='ten_usage_a' and metric_id='module.executions'")).rows[0]).toEqual({ count: 2, total: 3 });
    await pool.query(`insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,idempotency_key) values ($1,'ten_usage_b','module.executions',1,'2026-08-06 13:00Z','source','proof','proof')`, ["e".repeat(32)]);
  });
});
