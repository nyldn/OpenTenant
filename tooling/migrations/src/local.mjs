import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import pg from "pg";
import { applyMigrations } from "./runner.ts";
import { installedModules } from "../../../apps/platform/opentenant-modules.ts";
import { seedModuleCatalog } from "@opentenant/platform-core";


const DEFAULT_LOCAL_URL =
  "postgresql://opentenant:opentenant-local@localhost:55432/opentenant";

function localDatabaseUrl(value = process.env.CONTROL_PLANE_DATABASE_URL ?? DEFAULT_LOCAL_URL) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Local migration command only accepts a loopback database");
  }
  return value;
}

function identifier(value, field) {
  if (!/^[a-z][a-z0-9_-]{2,63}$/u.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

export async function loadControlPlaneMigrations() {
  const here = dirname(fileURLToPath(import.meta.url));
  const directory = join(here, "..", "sql", "control-plane");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(
    names.map(async (name) => ({
      id: name.replace(/\.sql$/u, ""),
      sql: await readFile(join(directory, name), "utf8"),
    })),
  );
}

async function seed(client) {
  const tenantId = identifier(process.env.LOCAL_TENANT_ID ?? "tenant_local", "local tenant id");
  const userId = identifier(process.env.LOCAL_USER_ID ?? "user_local", "local user id");
  const email = process.env.LOCAL_USER_EMAIL ?? "developer@example.test";
  const displayName = process.env.LOCAL_USER_NAME ?? "Local Developer";

  await client.query(
    `insert into tenants (tenant_id, slug, display_name, status, data_region)
     values ($1, 'local', 'OpenTenant Local', 'active', 'eu')
     on conflict (tenant_id) do update set status = 'active', updated_at = now()`,
    [tenantId],
  );
  await client.query(
    `insert into platform_users (user_id, email, display_name, is_platform_admin)
     values ($1, $2, $3, true)
     on conflict (user_id) do update set email = excluded.email,
       display_name = excluded.display_name, is_platform_admin = true, updated_at = now()`,
    [userId, email, displayName],
  );
  await client.query(
    `insert into brand_policies (tenant_id, defaults, locked_keys, overrides)
     values ($1, $2::jsonb, '[]'::jsonb, '{}'::jsonb)
     on conflict (tenant_id) do nothing`,
    [
      tenantId,
      JSON.stringify({
        displayName: "OpenTenant Local",
        logoUrl: "/opentenant-logo.svg",
        markUrl: "/opentenant-mark.svg",
        cssBrandKey: "opentenant",
      }),
    ],
  );
  for (const definition of installedModules.modules) {
    const moduleKey = definition.manifest.key;
    await client.query(
      `insert into tenant_modules (tenant_id, module_key, module_version, enabled)
       select $1, module_key, version, $3 from module_catalog where module_key = $2
       on conflict (tenant_id, module_key) do update
         set module_version = excluded.module_version, enabled = excluded.enabled`,
      [tenantId, moduleKey, definition.catalog.enabledByDefault],
    );
  }
  for (const definition of installedModules.modules) {
    await client.query(
      `insert into module_access_policies (tenant_id, module_key, mode, passcode_hash)
       values ($1, $2, 'identity', null) on conflict (tenant_id, module_key) do nothing`,
      [tenantId, definition.manifest.key],
    );
  }
}

export async function runLocalSetup({
  databaseUrl = process.env.CONTROL_PLANE_DATABASE_URL ?? DEFAULT_LOCAL_URL,
  poolFactory = (connectionString) => new pg.Pool({ connectionString }),
  loadMigrations = loadControlPlaneMigrations,
  migrate = applyMigrations,
  seedDatabase = seed,
  log = console.log,
} = {}) {
  const checkedDatabaseUrl = localDatabaseUrl(databaseUrl);
  const pool = poolFactory(checkedDatabaseUrl);
  try {
    await migrate(pool, await loadMigrations());
    for (const catalog of installedModules.migrations.controlPlane) await migrate(pool, catalog);
    const seedClient = await pool.connect();
    try {
      await seedClient.query("begin");
      try {
        await seedModuleCatalog(installedModules, seedClient);
        await seedDatabase(seedClient);
        await seedClient.query("commit");
      } catch (error) {
        await seedClient.query("rollback");
        throw error;
      }
    } finally {
      seedClient.release();
    }
    log("Local OpenTenant database is migrated and seeded.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runLocalSetup();
}
