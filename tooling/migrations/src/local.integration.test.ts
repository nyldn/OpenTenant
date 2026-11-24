import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
// @ts-expect-error local.mjs is the Node entrypoint and has no declaration output.
import { loadControlPlaneMigrations, runLocalSetup } from "./local.mjs";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

describeIntegration("local setup against PostgreSQL", () => {
  if (!integrationUrl) return;
  const verifier = new Pool({ connectionString: integrationUrl });

  beforeEach(async () => {
    await verifier.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await verifier.query("create schema public");
  });

  afterAll(async () => {
    await verifier.end();
  });

  it("records the canonical catalog, seeds synthetic local data, and repeats cleanly", async () => {
    const migrations = await loadControlPlaneMigrations();
    const log = () => undefined;

    await runLocalSetup({ databaseUrl: integrationUrl, log });
    await runLocalSetup({ databaseUrl: integrationUrl, log });

    const recorded = await verifier.query<{ id: string; checksum: string }>(
      "select id, checksum from schema_migrations order by id",
    );
    expect(recorded.rows).toEqual(migrations.map((migration: MigrationFile) => ({
      id: migration.id,
      checksum: createHash("sha256").update(migration.sql).digest("hex"),
    })));

    await expect(verifier.query(
      `select tenant_id, slug, display_name, status, data_region
         from tenants where tenant_id = 'tenant_local'`,
    )).resolves.toMatchObject({
      rows: [{
        tenant_id: "tenant_local",
        slug: "local",
        display_name: "OpenTenant Local",
        status: "active",
        data_region: "eu",
      }],
    });
    await expect(verifier.query(
      `select user_id, email, display_name, is_platform_admin
         from platform_users where user_id = 'user_local'`,
    )).resolves.toMatchObject({
      rows: [{
        user_id: "user_local",
        email: "developer@example.test",
        display_name: "Local Developer",
        is_platform_admin: true,
      }],
    });
    await expect(verifier.query(
      "select module_key, enabled from tenant_modules where tenant_id = 'tenant_local' order by module_key",
    )).resolves.toMatchObject({
      rows: [
        { module_key: "assessment", enabled: true },
        { module_key: "brain", enabled: false },
        { module_key: "support", enabled: true },
      ],
    });
    await expect(verifier.query(
      "select mode, passcode_hash from module_access_policies where tenant_id = 'tenant_local' and module_key = 'assessment'",
    )).resolves.toMatchObject({
      rows: [{ mode: "identity", passcode_hash: null }],
    });
  });

  it("serializes concurrent canonical runners", async () => {
    const secondPool = new Pool({ connectionString: integrationUrl });
    const migration = [{ id: "0001_slow", sql: "select pg_sleep(0.05)" }];
    try {
      const results = await Promise.all([
        applyMigrations(verifier, migration),
        applyMigrations(secondPool, migration),
      ]);

      expect(results.flatMap((result) => result.applied)).toEqual(["0001_slow"]);
      expect(results.flatMap((result) => result.skipped)).toEqual(["0001_slow"]);
      await expect(verifier.query(
        "select id from schema_migrations order by id",
      )).resolves.toMatchObject({ rows: [{ id: "0001_slow" }] });
    } finally {
      await secondPool.end();
    }
  });

  it("rejects a changed checksum through the canonical runner", async () => {
    await applyMigrations(verifier, [{ id: "0001_init", sql: "select 1" }]);

    await expect(applyMigrations(
      verifier,
      [{ id: "0001_init", sql: "select 2" }],
    )).rejects.toThrow("migration 0001_init was modified after being applied (checksum drift)");
  });

  it("rejects a newly introduced older migration through the canonical runner", async () => {
    await applyMigrations(verifier, [{ id: "0002_second", sql: "select 2" }]);

    await expect(applyMigrations(
      verifier,
      [
        { id: "0001_first", sql: "select 1" },
        { id: "0002_second", sql: "select 2" },
      ],
    )).rejects.toThrow(
      "migration 0001_first is older than already-applied 0002_second; refusing out-of-order apply",
    );
  });
});
