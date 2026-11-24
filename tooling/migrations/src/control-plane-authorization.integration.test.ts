import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyMigrations } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const url = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
(url ? describe : describe.skip)("control-plane authorization configuration", () => {
  if (!url) return;
  const pool = new Pool({ connectionString: url });
  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    const dir = new URL("../sql/control-plane/", import.meta.url);
    const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
    await applyMigrations(pool, await Promise.all(names.map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(new URL(name, dir), "utf8") }))));
  });
  afterAll(() => pool.end());
  it("seeds mapped built-ins and binds provider IDs to an installation", async () => {
    const rows = await pool.query("select module_key, authorization_manifest from module_catalog where module_key in ('brain', 'support', 'assessment')");
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.authorization_manifest.key).toBe(row.module_key);
      expect(row.authorization_manifest.rolePermissions.tenant_member).toEqual([`${row.module_key}.use`]);
    }
    const insert = "insert into authorization_provider_config (installation_id, provider, store_id, model_id) select installation_id, 'openfga', $1, $2 from installation_metadata";
    await expect(pool.query(insert, [null, null])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(insert, ["invalid", "invalid"])).rejects.toMatchObject({ code: "23514" });
    await pool.query(insert, ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAV"]);
    expect((await pool.query("select provider from authorization_provider_config")).rows).toEqual([{ provider: "openfga" }]);
  });
  it("rejects cross-module snapshots and malformed permission maps", async () => {
    for (const snapshot of [{ key: "other", permissions: [] }, { key: "brain", permissions: [] , rolePermissions: null }, { key: "brain" }]) {
      await expect(pool.query("update module_catalog set authorization_manifest = $1 where module_key = 'brain'", [snapshot])).rejects.toMatchObject({ code: "23514" });
    }
  });
});
