import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyMigrations } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const url = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const tables = ["audit_events", "audit_checkpoints", "model_resolution_events", "model_stream_terminal_events", "brain.decisions_log", "brain.raw_signals", "support.ticket_events", "support.depth_events", "support.outbox_events", "support.delivery_attempts", "support.slack_action_receipts"];
(url ? describe : describe.skip)("audit TRUNCATE protection against PostgreSQL", () => {
  const pool = new Pool({ connectionString: url });
  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade; create schema public; drop schema if exists support cascade; drop schema if exists tenant_core cascade; drop schema if exists brain cascade");
    await pool.query("do $$ begin create role tenant_app nosuperuser nobypassrls; exception when duplicate_object then null; end $$");
    for (const scope of ["control-plane", "tenant-core", "tenant-brain", "tenant-support"]) {
      const dir = new URL(`../sql/${scope}/`, import.meta.url);
      await applyMigrations(pool, await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".sql")).sort().map(async (file) => ({ id: `${scope}/${file}`, sql: await readFile(new URL(file, dir), "utf8") }))));
    }
    await pool.query("create role audit_truncate_runtime nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await pool.query("grant usage on schema public, brain, support to audit_truncate_runtime");
    await pool.query("grant truncate on all tables in schema public, brain, support to audit_truncate_runtime");
    for (const table of tables) await pool.query(`grant truncate on ${table} to audit_truncate_runtime`);
  });
  afterAll(async () => {
    await pool.query("drop owned by audit_truncate_runtime; drop role audit_truncate_runtime").catch(() => undefined);
    // Leave the shared integration database as later suites expect to find it.
    await pool.query("drop schema if exists support cascade; drop schema if exists brain cascade; drop schema if exists tenant_core cascade").catch(() => undefined);
    await pool.end();
  });
  it.each(tables)("blocks owner TRUNCATE on %s, including empty tables", async (table) => {
    await expect(pool.query(`truncate ${table} cascade`)).rejects.toThrow("append-only");
  });
  it.each(tables)("blocks restricted runtime TRUNCATE on %s even with a grant", async (table) => {
    const client = await pool.connect();
    try {
      await client.query("set role audit_truncate_runtime");
      await expect(client.query(`truncate ${table} cascade`)).rejects.toThrow("append-only");
    } finally { await client.query("reset role"); client.release(); }
  });
});
