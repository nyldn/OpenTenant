import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateTenantCore, TENANT_CORE_MIGRATIONS } from "./tenant-core";
import { applyMigrations } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("TENANT_CORE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function expectNoMigrationTracking(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ table_name: string | null }>(
    "select to_regclass('schema_migrations')::text as table_name",
  );
  expect(rows[0]?.table_name).toBeNull();
}

describeIntegration("tenant-core migrations against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  beforeAll(async () => {
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'opentenant_u31_app') then
        create role opentenant_u31_app nologin nosuperuser nobypassrls;
      end if;
    end $$`);
    await pool.query("alter role opentenant_u31_app nosuperuser nobypassrls");
  });

  beforeEach(async () => {
    await pool.query("drop schema if exists tenant_core cascade");
    await pool.query("drop table if exists schema_migrations");
  });

  afterAll(async () => {
    await pool.query("drop owned by opentenant_u31_app");
    await pool.query("drop role if exists opentenant_u31_app");
    await pool.end();
  });

  it("applies a fresh catalog, records checksums, and replays idempotently", async () => {
    await expect(migrateTenantCore(pool)).resolves.toEqual({
      applied: TENANT_CORE_MIGRATIONS.map(({ id }) => id),
      skipped: [],
    });
    await expect(migrateTenantCore(pool)).resolves.toEqual({
      applied: [],
      skipped: TENANT_CORE_MIGRATIONS.map(({ id }) => id),
    });

    const { rows } = await pool.query<{ id: string; checksum_length: number }>(
      `select id, length(checksum)::int as checksum_length
         from schema_migrations
        order by id`,
    );
    expect(rows).toEqual(TENANT_CORE_MIGRATIONS.map(({ id }) => ({
      id,
      checksum_length: 64,
    })));
  });

  it("baselines an exact old schema then applies the later migrations", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);

    const provisionedAt = "2026-01-02T03:04:05.000Z";
    await pool.query(`insert into tenant_core.tenant_meta
      (tenant_id, organization_id, data_region, provisioned_at)
      values ('ten_legacy', 'org_synthetic', 'us', $1)`, [provisionedAt]);

    // Derived, not listed. This suite has never run in CI, so when
    // 0004_data_region_ap was added nothing told the author that a hardcoded
    // list here had gone stale. Anything past the baseline is applied.
    await expect(migrateTenantCore(pool)).resolves.toEqual({
      applied: TENANT_CORE_MIGRATIONS.slice(1).map(({ id }) => id),
      skipped: [TENANT_CORE_MIGRATIONS[0]!.id],
    });

    const { rows } = await pool.query<{ exists: boolean }>(
      `select exists (
         select 1
           from information_schema.columns
          where table_schema = 'tenant_core'
            and table_name = 'tenant_meta'
            and column_name = 'organization_id'
       ) as exists`,
    );
    expect(rows[0]?.exists).toBe(false);
    const preserved = await pool.query("select tenant_id, data_region, provisioned_at from tenant_core.tenant_meta");
    expect(preserved.rows).toEqual([{ tenant_id: "ten_legacy", data_region: "us", provisioned_at: new Date(provisionedAt) }]);
  });

  it("baselines both migrations when an exact provider-neutral schema predates tracking", async () => {
    for (const migration of TENANT_CORE_MIGRATIONS.slice(0, 2)) {
      await pool.query(migration.sql);
    }

    await expect(migrateTenantCore(pool)).resolves.toEqual({
      applied: TENANT_CORE_MIGRATIONS.slice(2).map(({ id }) => id),
      skipped: TENANT_CORE_MIGRATIONS.slice(0, 2).map(({ id }) => id),
    });
  });

  it("rejects a second tenant anchor even when FORCE RLS hides the existing row", async () => {
    await migrateTenantCore(pool);
    await pool.query("grant usage on schema tenant_core to opentenant_u31_app");
    await pool.query("grant select, insert on tenant_core.tenant_meta to opentenant_u31_app");
    const first = await pool.connect();
    let firstCommitted = false;
    try {
      await first.query("begin");
      await first.query("set local role opentenant_u31_app");
      await first.query("select set_config('app.tenant_id', 'tenant_first', true)");
      await first.query(
        "insert into tenant_core.tenant_meta (tenant_id, data_region) values ('tenant_first', 'us')",
      );
      await first.query("commit");
      firstCommitted = true;
    } finally {
      if (!firstCommitted) await first.query("rollback").catch(() => undefined);
      first.release();
    }

    const second = await pool.connect();
    try {
      await second.query("begin");
      await second.query("set local role opentenant_u31_app");
      await second.query("select set_config('app.tenant_id', 'tenant_second', true)");
      const visible = await second.query("select tenant_id from tenant_core.tenant_meta");
      expect(visible.rows).toEqual([]);
      await expect(second.query(
        "insert into tenant_core.tenant_meta (tenant_id, data_region) values ('tenant_second', 'eu')",
      )).rejects.toMatchObject({ code: "23505" });
    } finally {
      await second.query("rollback").catch(() => undefined);
      second.release();
    }
  });

  it("rejects an ambiguous untracked schema without tracking or applying it", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query("alter table tenant_core.tenant_meta no force row level security");

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("rejects an untracked schema with a missing canonical check constraint", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query(
      "alter table tenant_core.tenant_meta drop constraint tenant_meta_data_region_check",
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("rejects an untracked canonical table with a user trigger", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query(`create function tenant_core.rewrite_tenant() returns trigger
      language plpgsql as $$ begin return new; end $$`);
    await pool.query(`create trigger rewrite_tenant before insert on tenant_core.tenant_meta
      for each row execute function tenant_core.rewrite_tenant()`);

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("rejects an untracked canonical table with an unexpected unique constraint", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query(
      "alter table tenant_core.tenant_meta add constraint tenant_meta_data_region_key unique (data_region)",
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("rejects an unexpected view in an otherwise canonical untracked schema", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query(
      "create view tenant_core.tenant_meta_export as select * from tenant_core.tenant_meta",
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("rejects a timestamp type modifier in an otherwise canonical untracked schema", async () => {
    await pool.query(TENANT_CORE_MIGRATIONS[0]!.sql);
    await pool.query(
      "alter table tenant_core.tenant_meta alter column provisioned_at type timestamptz(0)",
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    await expectNoMigrationTracking(pool);
  });

  it("diagnoses multiple tenant anchors before migration mutation and preserves every row", async () => {
    await applyMigrations(pool, TENANT_CORE_MIGRATIONS.slice(0, 2));
    await pool.query(
      `insert into tenant_core.tenant_meta (tenant_id, data_region)
       values ('tenant_first', 'us'), ('tenant_second', 'eu')`,
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "tenant_core has multiple identity anchors; automatic repair is prohibited",
    );

    const anchors = await pool.query<{ count: string }>(
      "select count(*) from tenant_core.tenant_meta",
    );
    const singletonColumn = await pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'tenant_core'
            and table_name = 'tenant_meta'
            and column_name = 'singleton'
       ) as exists`,
    );
    const tracked = await pool.query<{ id: string }>(
      "select id from schema_migrations order by id",
    );
    const rls = await pool.query<{ forced: boolean }>(
      `select c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tenant_core' and c.relname = 'tenant_meta'`,
    );
    expect(anchors.rows[0]?.count).toBe("2");
    expect(singletonColumn.rows[0]?.exists).toBe(false);
    expect(rls.rows[0]?.forced).toBe(true);
    expect(tracked.rows.map(({ id }) => id)).toEqual(
      TENANT_CORE_MIGRATIONS.slice(0, 2).map(({ id }) => id),
    );
  });

  it("rejects multiple anchors in an untracked legacy catalog before tracking setup", async () => {
    for (const migration of TENANT_CORE_MIGRATIONS.slice(0, 2)) {
      await pool.query(migration.sql);
    }
    await pool.query(
      `insert into tenant_core.tenant_meta (tenant_id, data_region)
       values ('tenant_first', 'us'), ('tenant_second', 'eu')`,
    );

    await expect(migrateTenantCore(pool)).rejects.toThrow(
      "tenant_core has multiple identity anchors; automatic repair is prohibited",
    );

    const anchors = await pool.query<{ count: string }>(
      "select count(*) from tenant_core.tenant_meta",
    );
    const tracking = await pool.query<{ table_name: string | null }>(
      "select to_regclass('schema_migrations')::text as table_name",
    );
    const rls = await pool.query<{ forced: boolean }>(
      `select c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tenant_core' and c.relname = 'tenant_meta'`,
    );
    expect(anchors.rows[0]?.count).toBe("2");
    expect(tracking.rows[0]?.table_name).toBeNull();
    expect(rls.rows[0]?.forced).toBe(true);
  });
});
