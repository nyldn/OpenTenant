import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
const migrationSql = readFileSync(new URL("../sql/control-plane/0029_model_routing_store.sql", import.meta.url), "utf8");
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

describe("model routing store migration contract", () => {
  it("adds policy pins, current consent policy, attempt kind, and terminal evidence", () => {
    expect(migrationSql).toContain("upstream_provider");
    expect(migrationSql).toContain("upstream_data_policy");
    expect(migrationSql).toContain("create table model_consent_policy_versions");
    expect(migrationSql).toContain("operation_kind");
    expect(migrationSql).toContain("create table model_stream_terminal_events");
  });

  it("does not add content, credential, or usage fields", () => {
    expect(migrationSql).not.toMatch(/\b(prompt|completion|response|credential|api_key|secret|usage)\s+(text|jsonb|bytea|bigint|integer)\b/iu);
  });
});

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function migrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

describeIntegration("model routing store schema against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    const allMigrations = await migrations();
    const modelRoutingStoreMigration = allMigrations.find(
      (migration) => migration.id === "0029_model_routing_store",
    );
    if (!modelRoutingStoreMigration) throw new Error("0029 model routing store migration is missing");
    await applyMigrations(
      pool,
      allMigrations.filter((migration) => migration.id < modelRoutingStoreMigration.id),
    );
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_route', 'route', 'Route', 'active', 'eu')`,
    );
    await pool.query(
      `insert into model_allowlist_versions (allowlist_version, require_zero_retention, created_by)
       values ('v2', false, 'owner')`,
    );
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version)
       values ('res_before_0029', 'ten_route', 'support', 'legacy', 'synthetic', 'legacy-model',
               'none', 'eu', 'zero_retention', 'v2')`,
    );
    await applyMigrations(pool, [modelRoutingStoreMigration]);
    await pool.query(
      `insert into model_consent_policy_versions (policy_version, published_by)
       values ('cb-2', 'owner')`,
    );
  });

  afterAll(async () => pool.end());

  async function rejects(sql: string, values: unknown[] = []): Promise<string> {
    try {
      await pool.query(sql, values);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`expected PostgreSQL to reject: ${sql}`);
  }

  it("marks pre-0029 resolution evidence as legacy unknown", async () => {
    const legacy = await pool.query<{ operation_kind: string }>(
      "select operation_kind from model_resolution_events where resolution_id = 'res_before_0029'",
    );
    expect(legacy.rows).toEqual([{ operation_kind: "legacy_unknown" }]);
  });

  it("requires complete router pins on new rows", async () => {
    const incomplete = await rejects(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture, pinned_upstream)
       values ('v2', 'openrouter', 'route/model', 'eu', 'zero_retention', true)`,
    );
    expect(incomplete).toContain("model_allowlist_entries_pin_details");

    await pool.query(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture, pinned_upstream,
         upstream_provider, upstream_data_policy)
       values ('v2', 'openrouter', 'route/model', 'eu', 'zero_retention', true,
               'anthropic', 'eu-zero-retention')`,
    );
  });

  it("links one append-only terminal to a stream attempt", async () => {
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version, operation_kind)
       values ('res_stream', 'ten_route', 'support', 'triage', 'openrouter', 'route/model',
               'tenant', 'eu', 'zero_retention', 'v2', 'stream')`,
    );
    await pool.query(
      `insert into model_stream_terminal_events (resolution_id, terminal_state)
       values ('res_stream', 'completed')`,
    );
    expect(await rejects(
      `insert into model_stream_terminal_events (resolution_id, terminal_state)
       values ('res_stream', 'cancelled')`,
    )).toMatch(/model_stream_terminal_events_pkey|duplicate key/u);
    expect(await rejects(
      "update model_stream_terminal_events set terminal_state = 'failed' where resolution_id = 'res_stream'",
    )).toContain("append-only evidence");
  });

  it("refuses a terminal for a non-stream operation and unsafe failure shapes", async () => {
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version, operation_kind)
       values ('res_complete', 'ten_route', 'support', 'triage', 'openrouter', 'route/model',
               'tenant', 'eu', 'zero_retention', 'v2', 'complete')`,
    );
    expect(await rejects(
      `insert into model_stream_terminal_events (resolution_id, terminal_state)
       values ('res_complete', 'completed')`,
    )).toMatch(/foreign key|model_stream_terminal_events/u);
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version, operation_kind)
       values ('res_stream_bad', 'ten_route', 'support', 'triage', 'openrouter', 'route/model',
               'tenant', 'eu', 'zero_retention', 'v2', 'stream')`,
    );
    expect(await rejects(
      `insert into model_stream_terminal_events (resolution_id, terminal_state, failure_code)
       values ('res_stream_bad', 'completed', 'ADAPTER_ERROR')`,
    )).toContain("model_stream_terminal_events_check");
  });

  it("enforces failure codes without rejecting null codes for completed or cancelled streams", async () => {
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version, operation_kind)
       values ('res_failed_null', 'ten_route', 'support', 'triage', 'openrouter', 'route/model', 'tenant', 'eu', 'zero_retention', 'v2', 'stream'),
              ('res_failed_bad', 'ten_route', 'support', 'triage', 'openrouter', 'route/model', 'tenant', 'eu', 'zero_retention', 'v2', 'stream'),
              ('res_failed_ok', 'ten_route', 'support', 'triage', 'openrouter', 'route/model', 'tenant', 'eu', 'zero_retention', 'v2', 'stream'),
              ('res_completed_ok', 'ten_route', 'support', 'triage', 'openrouter', 'route/model', 'tenant', 'eu', 'zero_retention', 'v2', 'stream'),
              ('res_cancelled_ok', 'ten_route', 'support', 'triage', 'openrouter', 'route/model', 'tenant', 'eu', 'zero_retention', 'v2', 'stream')`,
    );
    expect(await rejects(
      `insert into model_stream_terminal_events (resolution_id, terminal_state)
       values ('res_failed_null', 'failed')`,
    )).toContain("model_stream_terminal_events_check");
    expect(await rejects(
      `insert into model_stream_terminal_events (resolution_id, terminal_state, failure_code)
       values ('res_failed_bad', 'failed', 'BACKEND_DETAIL')`,
    )).toContain("model_stream_terminal_events_check");
    await pool.query(
      `insert into model_stream_terminal_events (resolution_id, terminal_state, failure_code)
       values ('res_failed_ok', 'failed', 'ADAPTER_ERROR'),
              ('res_completed_ok', 'completed', null),
              ('res_cancelled_ok', 'cancelled', null)`,
    );
  });

  it("keeps policy and terminal metadata free of content and usage columns", async () => {
    const columns = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('model_resolution_events', 'model_stream_terminal_events')`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(["prompt", "completion", "response", "credential", "secret", "usage"]),
    );
  });
});
