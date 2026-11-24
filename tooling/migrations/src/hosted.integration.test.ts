import { installedModules } from "../../../apps/platform/opentenant-modules";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationDatabaseUrl } from "./integration-guard";
// @ts-expect-error Node CLI entrypoint
import { runHosted } from "./hosted.mjs";

const url = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const integration = url ? describe : describe.skip;
integration("hosted migration command against PostgreSQL", () => {
  if (!url) return;
  const db = new Pool({ connectionString: url });
  const host = new URL(url).host;
  const env = { CONTROL_PLANE_DATABASE_URL: url };
  const args = ["control-plane", "--target", host];
  beforeEach(async () => { await db.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade"); await db.query("create schema public"); });
  afterAll(async () => { await db.end(); });
  it("dry-runs without creating tracking state, applies, repeats, and detects checksum drift", async () => {
    const log = vi.fn();
    await runHosted({ args: [...args, "--dry-run"], env, log });
    expect((await db.query("select to_regclass('schema_migrations') as name")).rows[0].name).toBeNull();
    expect(log.mock.calls.flat().join("\n")).toContain("0001_init");
    await runHosted({ args, env, log });
    const count = (await db.query("select count(*)::int as n from schema_migrations")).rows[0].n;
    expect(count).toBeGreaterThan(20);
    const catalog = (await db.query("select module_key from module_catalog where ownership_scope = 'platform' order by module_key")).rows.map(row => row.module_key);
    expect(catalog).toEqual(installedModules.modules.map(definition => definition.manifest.key).sort());
    await runHosted({ args, env, log });
    expect((await db.query("select count(*)::int as n from schema_migrations")).rows[0].n).toBe(count);
    await db.query("update schema_migrations set checksum = 'changed' where id = '0001_init'");
    await expect(runHosted({ args: [...args, "--dry-run"], env, log })).rejects.toThrow("Hosted migration failed");
    await expect(runHosted({ args, env, log })).rejects.toThrow("Hosted migration failed");
    expect(log.mock.calls.flat().join("\n")).not.toContain(new URL(url).password);
  });
  it("plans a tenant fleet canary first and stops on its real database failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opentenant-hosted-"));
    try {
      const manifest = join(directory, "fleet.json");
      await writeFile(manifest, JSON.stringify([{ tenantId: "second", databaseUrl: url }, { tenantId: "canary", databaseUrl: url }]));
      const fleetArgs = ["tenant-fleet", "--target", host, "--manifest", manifest, "--canary", "canary"];
      const log = vi.fn();
      await runHosted({ args: [...fleetArgs, "--dry-run"], log });
      expect(log.mock.calls[0]?.[0]).toContain("canary starting");
      const planned = log.mock.calls.flat().join("\n");
      for (const migration of installedModules.migrations.tenant.flat()) expect(planned).toContain(migration.id);
      expect((await db.query("select to_regclass('schema_migrations') as name")).rows[0].name).toBeNull();
      // Deliberately reject core SQL. The canary must stop before second starts.
      // Earlier suites share this database and may leave tenant_core behind.
      await db.query("drop schema if exists tenant_core cascade");
      await db.query("create schema tenant_core");
      log.mockClear();
      await expect(runHosted({ args: fleetArgs, log })).rejects.toThrow("Hosted migration failed");
      expect(log.mock.calls.flat().join("\n")).not.toContain("second starting");
    } finally { await db.query("drop schema if exists tenant_core cascade"); await rm(directory, { recursive: true, force: true }); }
  });
});
