import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
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

describeIntegration("control-plane module capabilities against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  async function transaction(operation: (client: PoolClient) => Promise<void>): Promise<void> {
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

  async function publishCapabilityModule(): Promise<void> {
    const installation = await pool.query<{ installation_id: string }>(
      "select installation_id from installation_metadata where singleton = true",
    );
    await transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, remote_url,
           ownership_scope, installation_id, owner_tenant_id)
         values ('tenant-portal', '1.0.0', 'remote', false,
                 'https://tenant-portal.example.test', 'tenant', $1, 'ten_alpha')`,
        [installation.rows[0]!.installation_id],
      );
      await client.query(
        `insert into module_version_capabilities
          (module_key, module_version, capability, runtime_permission,
           creator_user_id, creator_authority_id)
         values ('tenant-portal', '1.0.0', 'support.ticket.read',
                 'tenant-portal.support_ticket_read', 'user_creator',
                 (select authority_id from module_creator_capability_authorities
                   where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                     and capability = 'support.ticket.read' and revoked_at is null))`,
      );
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, remote_url, created_by_user_id)
         values ('tenant-portal', '1.0.0', $1, 'https://tenant-portal.example.test', 'user_creator')`,
        ["a".repeat(64)],
      );
      await client.query(
        `insert into tenant_modules (tenant_id, module_key, module_version, enabled)
         values ('ten_alpha', 'tenant-portal', '1.0.0', true)`,
      );
    });
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
       values ('user_creator', 'creator@example.test', 'Creator', false),
              ('user_other', 'other@example.test', 'Other', false),
              ('user_owner', 'owner@example.test', 'Owner', true)`,
    );
    await pool.query(
      `insert into module_creator_capability_authorities
        (tenant_id, creator_user_id, capability, granted_by_user_id)
       values ('ten_alpha', 'user_creator', 'support.ticket.read', 'user_owner')`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("publishes declarations atomically and blocks capability expansion or mutation", async () => {
    const installation = await pool.query<{ installation_id: string }>(
      "select installation_id from installation_metadata where singleton = true",
    );
    await expect(pool.query(
      `insert into module_creator_capability_authorities
        (tenant_id, creator_user_id, capability, granted_by_user_id)
       values ('ten_alpha', 'user_creator', 'database.everything', 'user_owner')`,
    )).rejects.toMatchObject({ code: "23514" });
    await expect(transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, ownership_scope,
           installation_id, owner_tenant_id)
         values ('invalid-prefix', '1.0.0', 'native', false, 'tenant', $1, 'ten_alpha')`,
        [installation.rows[0]!.installation_id],
      );
      await client.query(
        `insert into module_version_capabilities
          (module_key, module_version, capability, runtime_permission,
           creator_user_id, creator_authority_id)
         values ('invalid-prefix', '1.0.0', 'support.ticket.read',
                 'other-module.support_ticket_read', 'user_creator',
                 (select authority_id from module_creator_capability_authorities
                   where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                     and capability = 'support.ticket.read' and revoked_at is null))`,
      );
    })).rejects.toMatchObject({ code: "23514" });

    await publishCapabilityModule();

    await expect(pool.query(
      `insert into module_version_capabilities
        (module_key, module_version, capability, runtime_permission,
         creator_user_id, creator_authority_id)
       values ('tenant-portal', '1.0.0', 'support.ticket.read',
               'tenant-portal.support-ticket-read', 'user_creator',
               (select authority_id from module_creator_capability_authorities
                 where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                   and capability = 'support.ticket.read' and revoked_at is null))`,
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      `update module_version_capabilities
          set runtime_permission = 'tenant-portal.changed'
        where module_key = 'tenant-portal' and module_version = '1.0.0'`,
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      `delete from module_version_capabilities
        where module_key = 'tenant-portal' and module_version = '1.0.0'`,
    )).rejects.toMatchObject({ code: "P0001" });

    await expect(transaction(async (client) => {
      await client.query(
        `insert into module_version_capabilities
          (module_key, module_version, capability, runtime_permission,
           creator_user_id, creator_authority_id)
         values ('tenant-portal', '2.0.0', 'support.ticket.read',
                 'tenant-portal.support-ticket-read', 'user_creator',
                 (select authority_id from module_creator_capability_authorities
                   where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                     and capability = 'support.ticket.read' and revoked_at is null))`,
      );
    })).rejects.toMatchObject({ code: "23503" });
  });

  it("requires an exact active entitlement and permits only one-way grant revocation", async () => {
    await publishCapabilityModule();

    await expect(pool.query(
      `insert into tenant_module_capability_grants
        (tenant_id, module_key, module_version, capability, granted_by_user_id)
       values ('ten_beta', 'tenant-portal', '1.0.0', 'support.ticket.read', 'user_owner')`,
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      `insert into tenant_module_capability_grants
        (tenant_id, module_key, module_version, capability, granted_by_user_id)
       values ('ten_alpha', 'tenant-portal', '9.9.9', 'support.ticket.read', 'user_owner')`,
    )).rejects.toMatchObject({ code: "P0001" });

    const grant = await pool.query<{ grant_id: string }>(
      `insert into tenant_module_capability_grants
        (tenant_id, module_key, module_version, capability, granted_by_user_id)
       values ('ten_alpha', 'tenant-portal', '1.0.0', 'support.ticket.read', 'user_owner')
       returning grant_id`,
    );
    await expect(pool.query(
      `insert into tenant_module_capability_grants
        (tenant_id, module_key, module_version, capability, granted_by_user_id)
       values ('ten_alpha', 'tenant-portal', '1.0.0', 'support.ticket.read', 'user_owner')`,
    )).rejects.toMatchObject({ code: "23505" });

    await expect(pool.query(
      "update tenant_module_capability_grants set revoked_at = now() where grant_id = $1",
      [grant.rows[0]!.grant_id],
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query(
      "update tenant_module_capability_grants set revoked_at = null where grant_id = $1",
      [grant.rows[0]!.grant_id],
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      "update tenant_module_capability_grants set expires_at = now() + interval '1 day' where grant_id = $1",
      [grant.rows[0]!.grant_id],
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      "delete from tenant_module_capability_grants where grant_id = $1",
      [grant.rows[0]!.grant_id],
    )).rejects.toMatchObject({ code: "P0001" });

    await expect(pool.query(
      `insert into tenant_module_capability_grants
        (tenant_id, module_key, module_version, capability, granted_by_user_id)
       values ('ten_alpha', 'tenant-portal', '1.0.0', 'support.ticket.read', 'user_owner')`,
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("binds declarations to the artifact creator and serializes publication races", async () => {
    const installation = await pool.query<{ installation_id: string }>(
      "select installation_id from installation_metadata where singleton = true",
    );
    await expect(transaction(async (client) => {
      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, ownership_scope,
           installation_id, owner_tenant_id)
         values ('creator-mismatch', '1.0.0', 'native', false, 'tenant', $1, 'ten_alpha')`,
        [installation.rows[0]!.installation_id],
      );
      await client.query(
        `insert into module_version_capabilities
          (module_key, module_version, capability, runtime_permission,
           creator_user_id, creator_authority_id)
         values ('creator-mismatch', '1.0.0', 'support.ticket.read',
                 'creator-mismatch.support_ticket_read', 'user_creator',
                 (select authority_id from module_creator_capability_authorities
                   where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                     and capability = 'support.ticket.read' and revoked_at is null))`,
      );
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, created_by_user_id)
         values ('creator-mismatch', '1.0.0', $1, 'user_other')`,
        ["b".repeat(64)],
      );
    })).rejects.toMatchObject({ code: "23503" });

    await publishCapabilityModule();
    const publisher = await pool.connect();
    const declarer = await pool.connect();
    try {
      await publisher.query("begin");
      await declarer.query("begin");
      await publisher.query(
        `insert into module_versions
          (module_key, version, artifact_digest, created_by_user_id)
         values ('tenant-portal', '2.0.0', $1, 'user_creator')`,
        ["c".repeat(64)],
      );
      let declarationSettled = false;
      // Settles to an outcome rather than rejecting. The rejection is expected,
      // but a bare rejected promise here escapes as an unhandled rejection the
      // moment any assertion below throws first, which is what it did on the
      // first CI run this suite ever had: 73 tests passed and the job still
      // failed on a rejection nobody was left to await. Always-fulfilling means
      // a genuine timing failure reports as a failed assertion instead.
      const declaration = declarer.query(
        `insert into module_version_capabilities
          (module_key, module_version, capability, runtime_permission,
           creator_user_id, creator_authority_id)
         values ('tenant-portal', '2.0.0', 'support.ticket.read',
                 'tenant-portal.support_ticket_read', 'user_creator',
                 (select authority_id from module_creator_capability_authorities
                   where tenant_id = 'ten_alpha' and creator_user_id = 'user_creator'
                     and capability = 'support.ticket.read' and revoked_at is null))`,
      ).then(
        () => ({ rejected: false as const, code: undefined as string | undefined }),
        (error: { code?: string }) => ({ rejected: true as const, code: error.code }),
      ).finally(() => {
        declarationSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(declarationSettled).toBe(false);
      await publisher.query("commit");
      expect(await declaration).toEqual({ rejected: true, code: "P0001" });
      await declarer.query("rollback");
    } finally {
      await publisher.query("rollback").catch(() => undefined);
      await declarer.query("rollback").catch(() => undefined);
      publisher.release();
      declarer.release();
    }
  });
});
