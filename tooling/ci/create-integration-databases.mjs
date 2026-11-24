/**
 * Creates the empty databases the migration integration suites drop and rebuild.
 *
 * Each schema-resetting suite gets its own database. The older store suites keep
 * their guarded `opentenant_ops04_`, `opentenant_ops05_`, and `opentenant_ops06_`
 * prefixes. Every database name is a fixed literal below.
 */
import pg from "pg";
import { pathToFileURL } from "node:url";
import {
  validateDatabaseServer,
  validateConnectedDatabase,
  validateDatabaseUrl,
} from "./run-database-store-tests.mjs";

export const DATABASES = [
  "opentenant_it_rate_limits",
  "opentenant_it_key_rotation",
  "opentenant_it_observability",
  "opentenant_it_tenant_worker",
  "opentenant_it_worker_tenant",
  "opentenant_it_postgres_control",
  "opentenant_it_postgres_tenant",
  "opentenant_it_identity_control",
  "opentenant_it_usage_export",
  "opentenant_it_audit",
  "opentenant_it_control_plane",
  "opentenant_it_provisioning_control",
  "opentenant_it_provisioning_tenant",
  "opentenant_it_tenant_core",
  "opentenant_it_tenant_support",
  "opentenant_it_store_admission",
  "opentenant_it_store_usage",
  "opentenant_it_store_model_routing",
  "opentenant_ops04_store_ownership",
  "opentenant_ops05_store_capability",
  "opentenant_it_store_brand_proposal",
  "opentenant_ops06_store_helpdesk_projection",
  "opentenant_it_support_delivery",
  "opentenant_it_export_control",
  "opentenant_it_export_tenant",
  "opentenant_it_store_quality_contract",
  "opentenant_it_support_ai",
];

/**
 * @param {string | undefined} adminUrl
 * @param {{Client?: typeof pg.Client, log?: (message: string) => void, allowUnixSocketServer?: boolean}} [dependencies]
 */
export async function createIntegrationDatabases(
  adminUrl,
  { Client = pg.Client, log = console.log, allowUnixSocketServer = false } = {},
) {
  const clientConfig = validateDatabaseUrl(adminUrl, "postgres");
  const client = new Client(clientConfig);
  await client.connect();
  try {
    await validateConnectedDatabase(client, { ...clientConfig, allowUnixSocketServer });
    const server = await client.query("select current_setting('server_version_num') as version, exists (select 1 from pg_available_extensions where name = 'vector') as vector");
    validateDatabaseServer({ serverVersionNumber: Number(server.rows[0]?.version), vectorAvailable: server.rows[0]?.vector === true });
    for (const database of DATABASES) {
      // The names are literals above, never input, so the identifier is safe to
      // interpolate. CREATE DATABASE cannot take a parameter.
      await client.query(`drop database if exists ${database}`);
      await client.query(`create database ${database}`);
      log(`created ${database}`);
    }
    return DATABASES.length;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createIntegrationDatabases(process.env.ADMIN_DATABASE_URL).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
