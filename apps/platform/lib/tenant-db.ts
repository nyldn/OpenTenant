import { serverConfig } from "./server-config";
/**
 * Tenant data-plane access for native modules. Resolves the tenant's Neon
 * connection from the control plane (encrypted, AAD-bound) and runs work
 * inside withTenantContext so fail-closed RLS always sees app.tenant_id.
 */
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import type { TenantId } from "@opentenant/auth";
import {
  ControlPlaneTenantDatabaseLocator,
  CredentialCipher,
  withTenantContext,
  type TenantDatabaseRecord,
} from "@opentenant/database";
import { controlPlanePool } from "./control-plane";

/**
 * Fluid-compute pool hygiene: attachDatabasePool drains connections before
 * instance suspension, and the small max plus idle timeout avoid stacking a
 * large client pool on Neon's own PgBouncer ("double pooling").
 */
function trackedPool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  attachDatabasePool(pool);
  return pool;
}

let locator: ControlPlaneTenantDatabaseLocator | null = null;
function tenantLocator(): ControlPlaneTenantDatabaseLocator {
  if (!locator) {
    locator = new ControlPlaneTenantDatabaseLocator(
      {
        async get(tenantId): Promise<TenantDatabaseRecord | null> {
          const { rows } = await controlPlanePool().query<{
            tenant_id: string;
            provider: "neon" | "azure_postgres";
            region: string;
            encrypted_connection: Buffer;
            schema_version: string | null;
          }>(
            `select tenant_id, provider, region, encrypted_connection, schema_version
               from tenant_databases where tenant_id = $1`,
            [tenantId],
          );
          const row = rows[0];
          return row
            ? {
                tenantId: row.tenant_id as TenantId,
                provider: row.provider,
                region: row.region,
                // Provisioning stores the cipher's base64 wire string as
                // bytea; decode back to the string CredentialCipher expects.
                encryptedConnection: row.encrypted_connection.toString("utf8"),
                schemaVersion: row.schema_version,
              }
            : null;
        },
      },
      CredentialCipher.fromEnv(serverConfig()),
      (connectionString) => trackedPool(connectionString, 5),
    );
  }
  return locator;
}

export interface TenantDbHandle {
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

/**
 * Resolves the tenant pool before the caller opens a control-plane
 * transaction. A cold pool lookup reads tenant_databases through the
 * control-plane pool, so resolving it while already holding one of that
 * pool's connections can exhaust the pool and deadlock under concurrency.
 */
export async function resolveTenantDb(tenantId: TenantId): Promise<TenantDbHandle> {
  const pool = await tenantLocator().poolFor(tenantId);
  return { withClient: (fn) => withTenantContext(pool, tenantId, fn) };
}

export async function withTenantDb<T>(
  tenantId: TenantId,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await tenantLocator().poolFor(tenantId);
  return withTenantContext(pool, tenantId, fn);
}
