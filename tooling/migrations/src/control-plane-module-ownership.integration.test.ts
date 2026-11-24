import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function controlPlaneMigrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

describeIntegration("control-plane module ownership against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  async function transaction(operation: (client: import("pg").PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await operation(client);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await controlPlaneMigrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'us'),
              ('ten_beta', 'beta', 'Beta', 'active', 'us')`,
    );
    await pool.query(
      `insert into platform_users (user_id, email, display_name, is_platform_admin)
       values ('user_reviewer', 'reviewer@example.test', 'Reviewer', true)`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enforces private assignment and insert-only reviewed promotion", async () => {
    const installation = await pool.query<{ installation_id: string }>(
      "select installation_id from installation_metadata where singleton = true",
    );
    const installationId = installation.rows[0]!.installation_id;
    const sourceDigest = "a".repeat(64);
    const promotedDigest = "b".repeat(64);

    await expect(pool.query(
      `insert into module_catalog (module_key, version, runtime, enabled_by_default)
       values ('ambiguous-scope', '1.0.0', 'native', false)`,
    )).rejects.toMatchObject({ code: "23502" });
    await expect(pool.query(
      `insert into module_catalog
        (module_key, version, runtime, enabled_by_default, ownership_scope,
         installation_id, owner_tenant_id)
       values ('private-default', '1.0.0', 'native', true, 'tenant', $1, 'ten_alpha')`,
      [installationId],
    )).rejects.toMatchObject({ code: "23514" });

    await transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, ownership_scope,
           installation_id, owner_tenant_id)
         values ('tenant-insights', '1.0.0', 'native', false, 'tenant', $1, 'ten_alpha')`,
        [installationId],
      );
      await client.query(
        `insert into module_versions (module_key, version, artifact_digest, created_by_user_id)
         values ('tenant-insights', '1.0.0', $1, 'user_reviewer')`,
        [sourceDigest],
      );
    });
    await expect(pool.query(
      `insert into tenant_modules (tenant_id, module_key, module_version, enabled)
       values ('ten_alpha', 'tenant-insights', '1.0.0', true)`,
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query(
      `insert into tenant_modules (tenant_id, module_key, module_version, enabled)
       values ('ten_beta', 'tenant-insights', '1.0.0', true)`,
    )).rejects.toMatchObject({ code: "P0001" });

    await expect(pool.query(
      "update module_catalog set ownership_scope = 'installation', owner_tenant_id = null where module_key = 'tenant-insights'",
    )).rejects.toMatchObject({ code: "P0001" });

    await expect(transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, ownership_scope, installation_id)
         values ('same-version-copy', '1.0.0', 'native', false, 'installation', $1)`,
        [installationId],
      );
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, source_module_key, source_version,
          source_artifact_digest, reviewed_by_user_id, reviewed_at,
          created_by_user_id, published_by_user_id)
         values ('same-version-copy', '1.0.0', $1, 'tenant-insights', '1.0.0',
                 $2, 'user_reviewer', now(),
                 'user_reviewer', 'user_reviewer')`,
        [promotedDigest, sourceDigest],
      );
    })).rejects.toMatchObject({ code: "23514" });

    await transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, ownership_scope, installation_id)
         values ('shared-insights', '1.1.0', 'native', false, 'installation', $1)`,
        [installationId],
      );
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, source_module_key, source_version,
          source_artifact_digest, reviewed_by_user_id, reviewed_at,
          created_by_user_id, published_by_user_id)
         values ('shared-insights', '1.1.0', $1, 'tenant-insights', '1.0.0',
                 $2, 'user_reviewer', now(),
                 'user_reviewer', 'user_reviewer')`,
        [promotedDigest, sourceDigest],
      );
    });
    await expect(pool.query(
      "update module_versions set artifact_digest = $1 where module_key = 'shared-insights'",
      ["c".repeat(64)],
    )).rejects.toMatchObject({ code: "P0001" });

    const { rows } = await pool.query(
      `select catalog.ownership_scope, catalog.owner_tenant_id, version.artifact_digest
         from module_catalog catalog
         join module_versions version on version.module_key = catalog.module_key
        where catalog.module_key in ('tenant-insights', 'shared-insights')
        order by catalog.module_key`,
    );
    expect(rows).toEqual([
      { ownership_scope: "installation", owner_tenant_id: null, artifact_digest: promotedDigest },
      { ownership_scope: "tenant", owner_tenant_id: "ten_alpha", artifact_digest: sourceDigest },
    ]);
  });
});
