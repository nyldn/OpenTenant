/**
 * Server-only tenant database resolution (spec 9.3).
 *
 * A trusted server context (never a request header) supplies the TenantId.
 * The locator resolves it to an encrypted connection record from the control
 * plane, decrypts in memory, and returns a bounded pooled client. Browser
 * code never receives a connection string; plaintext URIs never leave this
 * module.
 */
import { Pool } from "pg";
import type { TenantId } from "@opentenant/auth";
import type { CredentialCipher } from "./credential-cipher";

export interface TenantDatabaseRecord {
  tenantId: TenantId;
  provider: "neon" | "azure_postgres";
  region: string;
  /** base64 AES-256-GCM record produced by CredentialCipher.encrypt. */
  encryptedConnection: string;
  schemaVersion: string | null;
}

export interface TenantDatabaseStore {
  get(tenantId: TenantId): Promise<TenantDatabaseRecord | null>;
}

export interface TenantDatabaseLocator {
  /** Resolve a pooled client for the tenant, or throw for unknown tenants. */
  poolFor(tenantId: TenantId): Promise<Pool>;
  /** Dispose all pools (shutdown and tests). */
  end(): Promise<void>;
}

const MAX_POOL_CONNECTIONS = 5;

export class ControlPlaneTenantDatabaseLocator implements TenantDatabaseLocator {
  /** Promise-valued cache: concurrent misses share one in-flight creation. */
  private readonly pools = new Map<string, Promise<Pool>>();

  constructor(
    private readonly store: TenantDatabaseStore,
    private readonly cipher: CredentialCipher,
    private readonly createPool: (connectionString: string) => Pool = (connectionString) =>
      new Pool({ connectionString, max: MAX_POOL_CONNECTIONS }),
  ) {}

  async poolFor(tenantId: TenantId): Promise<Pool> {
    const cached = this.pools.get(tenantId);
    if (cached) return cached;

    const creating = this.createFor(tenantId);
    this.pools.set(tenantId, creating);
    try {
      return await creating;
    } catch (error) {
      // A failed creation must not poison the cache.
      this.pools.delete(tenantId);
      throw error;
    }
  }

  private async createFor(tenantId: TenantId): Promise<Pool> {
    const record = await this.store.get(tenantId);
    if (record === null) {
      // Fail closed; the error names the tenant, never any credential.
      throw new Error(`no database record for tenant ${tenantId}`);
    }
    if (record.tenantId !== tenantId) {
      throw new Error(`store returned record for wrong tenant (asked ${tenantId})`);
    }

    // AAD binding: a record misfiled under another tenant fails to decrypt.
    const connectionString = this.cipher.decrypt(record.encryptedConnection, tenantId);
    return this.createPool(connectionString);
  }

  async end(): Promise<void> {
    const pending = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(
      pending.map((p) => p.then((pool) => pool.end()).catch(() => undefined)),
    );
  }
}

/**
 * Runs a callback inside a transaction with the tenant RLS context set. All
 * tenant-schema access goes through this helper so row-level security
 * policies (spec 9.2) always see an explicit, trusted tenant context.
 */
export async function withTenantContext<T>(
  pool: Pool,
  tenantId: TenantId,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("begin");
    // set_config with is_local=true scopes the setting to this transaction.
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Rollback failed: the connection state is unknown; destroy it rather
      // than returning a transaction-poisoned client to the pool.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
