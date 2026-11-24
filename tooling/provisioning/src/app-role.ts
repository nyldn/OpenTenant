/**
 * Application role provisioning (spec 9.2).
 *
 * Neon's default owner role carries BYPASSRLS, which silently disables
 * row-level security (verified against a live project). Tenant traffic must
 * therefore run as a dedicated application role without that attribute. The
 * connection record stored in the control plane uses this role; the owner
 * URI is used only for provisioning and migrations.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";



/**
 * Neon pooled endpoints insert "-pooler" after the endpoint id segment:
 * ep-abc-123.us-east-1.aws.neon.tech -> ep-abc-123-pooler.us-east-1....
 * Already-pooled hosts pass through unchanged.
 */
export function pooledHost(hostname: string): string {
  const [endpoint, ...rest] = hostname.split(".");
  if (!endpoint || endpoint.endsWith("-pooler")) return hostname;
  return [`${endpoint}-pooler`, ...rest].join(".");
}

export interface AppRoleResult {
  /** Connection URI for the application role; encrypt and store this one. */
  appConnectionUri: string;
}

/** Establish the role before migrations grant module privileges. Never rotate an existing login here. */
export async function ensureAppRole(ownerConnectionUri: string): Promise<void> {
  const client = new Client({ connectionString: ownerConnectionUri });
  await client.connect();
  try {
    await client.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'tenant_app') then
        create role tenant_app nologin nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
      end if;
    end $$`);
  } finally { await client.end(); }
}

export async function createAppRole(ownerConnectionUri: string, roleName = "tenant_app"): Promise<AppRoleResult> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(roleName)) throw new Error("Invalid application role name");
  // ponytail: hosted Neon still uses SQL password rotation here until the reviewed
  // NeonCredentialRotation adapter is composed into provisioning (O27 follow-up).
  const APP_ROLE = roleName;
  // 24 random bytes, base64url: safe inside a URI without escaping.
  const password = randomBytes(24).toString("base64url");
  const client = new Client({ connectionString: ownerConnectionUri });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      "select exists(select 1 from pg_roles where rolname = $1) as exists",
      [APP_ROLE],
    );
    if (rows[0]?.exists) {
      // Idempotent resume: rotate the password AND re-assert the security
      // attributes, so a pre-existing role cannot retain BYPASSRLS,
      // SUPERUSER-adjacent flags, or unexpected inheritance.
      await client.query(
        `alter role ${APP_ROLE} with login password '${password}' nobypassrls nosuperuser nocreatedb nocreaterole noreplication`,
      );
    } else {
      await client.query(
        `create role ${APP_ROLE} with login password '${password}' nobypassrls nosuperuser nocreatedb nocreaterole noreplication`,
      );
    }
    await grantAppRolePrivileges(client, ownerConnectionUri, roleName);

    // Preserve host, database, and query parameters (e.g. sslmode) from the
    // owner URI; only the credentials change. The generated password uses
    // the base64url alphabet, so it is URI-safe and SQL-literal-safe.
    const app = new URL(ownerConnectionUri);
    app.username = APP_ROLE;
    app.password = password;
    // Application traffic goes through Neon's pooled endpoint (PgBouncer in
    // transaction mode). Our RLS pattern is compatible by construction:
    // set_config(..., is_local => true) and pg_advisory_xact_lock are both
    // transaction-scoped. Session-scoped SET / pg_advisory_lock must never
    // be introduced on this connection. The direct endpoint stays reserved
    // for provisioning and migrations (this function's own connection).
    if (app.hostname.endsWith(".neon.tech")) app.hostname = pooledHost(app.hostname);
    return { appConnectionUri: app.toString() };
  } finally {
    await client.end();
  }
}

/** Shared grants for local and API rotation. No password reaches this helper. */
export async function grantAppRolePrivileges(client: Pick<Client, "query">, ownerConnectionUri: string, roleName: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(roleName)) throw new Error("Invalid application role name");
  const APP_ROLE = roleName;
  if (roleName !== "tenant_app") {
    await client.query(`grant tenant_app to ${APP_ROLE}`);
    const database = new URL(ownerConnectionUri).pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(database)) throw new Error("Invalid tenant database name");
    await client.query(`grant connect on database "${database}" to ${APP_ROLE}`);
  }
  await client.query(`grant usage on schema tenant_core to ${APP_ROLE}`);
  await client.query(`grant select, insert, update on all tables in schema tenant_core to ${APP_ROLE}`);
  await client.query(`grant usage, select on all sequences in schema tenant_core to ${APP_ROLE}`);
  await client.query(
    `alter default privileges in schema tenant_core grant select, insert, update on tables to ${APP_ROLE}`,
  );
  await client.query(
    `alter default privileges in schema tenant_core grant usage, select on sequences to ${APP_ROLE}`,
  );
}
