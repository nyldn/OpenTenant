import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { helloModule } from "@example/module-hello";
import { installedModules } from "../../../apps/platform/opentenant-modules";
import { defineModules } from "../../../packages/module-sdk/src/index";
import { applyMigrations } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const url = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
describe.skipIf(!url)("installed third-party tenant migration", () => {
  const pool = new Pool({ connectionString: url ?? "" });
  beforeAll(async () => {
    await pool.query("drop schema if exists hello cascade");
    await pool.query("create table if not exists public.schema_migrations (id text primary key, checksum text not null, applied_at timestamptz not null default now())");
    await pool.query("delete from public.schema_migrations where id like 'tenant-hello/%'");
    await pool.query("do $$ begin create role tenant_app nologin; exception when duplicate_object then null; end $$");
  });
  afterAll(async () => { await pool.query("drop schema if exists hello cascade"); await pool.end(); });
  it("executes the added composition migration, enforces RLS and resumes without drift", async () => {
    const registry = defineModules([...installedModules.modules, helloModule]);
    const catalog = registry.get("hello")!.migrations.tenant;
    expect((await applyMigrations(pool, catalog)).applied).toEqual(["tenant-hello/0001_greetings"]);
    await pool.query("begin");
    try {
      await pool.query("set local role tenant_app");
      await pool.query("select set_config('app.tenant_id', 'ten_one', true)");
      await pool.query("insert into hello.greetings values ('ten_one', 'Hello')");
      expect((await pool.query("select * from hello.greetings")).rows).toHaveLength(1);
      await pool.query("select set_config('app.tenant_id', 'ten_two', true)");
      expect((await pool.query("select * from hello.greetings")).rows).toHaveLength(0);
    } finally { await pool.query("rollback"); }
    expect((await applyMigrations(pool, catalog)).skipped).toEqual(["tenant-hello/0001_greetings"]);
  });
});
