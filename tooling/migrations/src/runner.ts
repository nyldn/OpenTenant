/**
 * Migration runner (spec 9.3).
 *
 * Guarantees:
 * - One runner at a time per database via a session advisory lock.
 * - Each migration's SQL and its tracking row commit in one transaction, so
 *   there is never an applied-but-unrecorded (or recorded-but-unapplied)
 *   migration. Migration files must not contain begin/commit.
 * - Checksums detect edited migrations; ordering gaps (a pending migration
 *   older than one already recorded) abort the run as drift.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/** Fixed advisory lock key for OpenTenant migrations (arbitrary stable value). */
const MIGRATION_LOCK_KEY = 7_310_356_002_412_001n;

export interface MigrationFile {
  /** Lexically ordered identifier, e.g. "0001_init". */
  id: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface MigrationOptions {
  /** Apply tracking setup, baseline, and the entire catalog atomically. */
  atomicCatalog?: boolean;
  /** Runs transactionally under the advisory lock before tracking-table setup. */
  preflight?: (client: PoolClient) => Promise<void>;
  /**
   * Inspect and baseline an exact legacy schema that predates migration
   * tracking. The callback runs once, under the advisory lock and inside a
   * transaction, only when this catalog has no recorded migrations. Returned
   * ids must be a contiguous prefix of the supplied catalog.
   */
  baseline?: (client: PoolClient) => Promise<ReadonlyArray<string>>;
  /** Runs inside each pending migration transaction immediately before SQL. */
  beforeApply?: (client: PoolClient, migration: MigrationFile) => Promise<void>;
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function applyMigrations(
  pool: Pool,
  migrations: ReadonlyArray<MigrationFile>,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY.toString()]);
    if (options.preflight && !options.atomicCatalog) {
      await lockClient.query("begin");
      try {
        await options.preflight(lockClient);
        await lockClient.query("commit");
      } catch (error) {
        await lockClient.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    return await runLocked(lockClient, migrations, options);
  } finally {
    await lockClient
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY.toString()])
      .catch(() => undefined);
    lockClient.release();
  }
}

async function runLocked(
  client: PoolClient,
  migrations: ReadonlyArray<MigrationFile>,
  options: MigrationOptions,
): Promise<MigrationResult> {
  if (!options.atomicCatalog) {
    return runCatalog(client, migrations, options, false);
  }

  await client.query("begin");
  try {
    await options.preflight?.(client);
    const result = await runCatalog(client, migrations, options, true);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function runCatalog(
  client: PoolClient,
  migrations: ReadonlyArray<MigrationFile>,
  options: MigrationOptions,
  outerTransaction: boolean,
): Promise<MigrationResult> {
  await client.query(
    `create table if not exists schema_migrations (
       id text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`,
  );

  const { rows } = await client.query<{ id: string; checksum: string }>(
    "select id, checksum from schema_migrations",
  );
  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const catalogPrefixes = new Set(ordered.map((migration) => {
    const separator = migration.id.indexOf("/");
    return separator > 0 ? migration.id.slice(0, separator + 1) : null;
  }));
  const onlyCatalogPrefix = [...catalogPrefixes][0];
  const catalogPrefix = catalogPrefixes.size === 1 && typeof onlyCatalogPrefix === "string"
    ? onlyCatalogPrefix
    : null;
  const recorded = new Map(
    rows
      .filter((row) => catalogPrefix === null || row.id.startsWith(catalogPrefix))
      .map((r) => [r.id, r.checksum]),
  );
  const newestRecorded = [...recorded.keys()].sort().at(-1) ?? "";

  const applied: string[] = [];
  const skipped: string[] = [];

  if (recorded.size === 0 && options.baseline) {
    if (!outerTransaction) await client.query("begin");
    try {
      const baselineIds = [...await options.baseline(client)];
      const expectedPrefix = ordered.slice(0, baselineIds.length).map((migration) => migration.id);
      if (
        new Set(baselineIds).size !== baselineIds.length
        || baselineIds.some((id, index) => id !== expectedPrefix[index])
      ) {
        throw new Error("migration baseline must be a contiguous catalog prefix");
      }
      for (const id of baselineIds) {
        const migration = ordered.find((candidate) => candidate.id === id);
        if (!migration) throw new Error(`migration baseline returned unknown id ${id}`);
        const migrationChecksum = checksum(migration.sql);
        await client.query("insert into schema_migrations (id, checksum) values ($1, $2)", [
          id,
          migrationChecksum,
        ]);
        recorded.set(id, migrationChecksum);
      }
      if (!outerTransaction) await client.query("commit");
    } catch (error) {
      if (!outerTransaction) await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }

  for (const migration of ordered) {
    const existing = recorded.get(migration.id);
    if (existing !== undefined) {
      if (existing !== checksum(migration.sql)) {
        throw new Error(`migration ${migration.id} was modified after being applied (checksum drift)`);
      }
      skipped.push(migration.id);
      continue;
    }

    if (migration.id.localeCompare(newestRecorded) < 0) {
      throw new Error(
        `migration ${migration.id} is older than already-applied ${newestRecorded}; refusing out-of-order apply`,
      );
    }

    if (!outerTransaction) await client.query("begin");
    try {
      await options.beforeApply?.(client, migration);
      await client.query(migration.sql);
      await client.query("insert into schema_migrations (id, checksum) values ($1, $2)", [
        migration.id,
        checksum(migration.sql),
      ]);
      if (!outerTransaction) await client.query("commit");
    } catch (error) {
      if (!outerTransaction) await client.query("rollback").catch(() => undefined);
      throw error;
    }
    applied.push(migration.id);
  }

  return { applied, skipped };
}

export interface FleetTarget {
  tenantId: string;
  connect(): Promise<Pool>;
}

export interface FleetRunResult {
  canary: { tenantId: string; result: MigrationResult };
  completed: Array<{ tenantId: string; result: MigrationResult }>;
  failed: { tenantId: string; error: string } | null;
}

/**
 * Fleet rollout (spec 9.3): canary tenant first; any canary failure stops the
 * run before other tenants are touched. Tenants process sequentially and the
 * run halts at the first failure so progress is never ambiguous. Re-running
 * is safe because applyMigrations skips recorded, checksum-verified files.
 */
export async function applyToFleet(
  targets: ReadonlyArray<FleetTarget>,
  migrations: ReadonlyArray<MigrationFile>,
  canaryTenantId: string,
): Promise<FleetRunResult> {
  const canaryTarget = targets.find((t) => t.tenantId === canaryTenantId);
  if (!canaryTarget) throw new Error(`canary tenant ${canaryTenantId} is not in the target list`);

  const canaryPool = await canaryTarget.connect();
  let canaryResult: MigrationResult;
  try {
    canaryResult = await applyMigrations(canaryPool, migrations);
  } finally {
    await canaryPool.end();
  }

  const completed: Array<{ tenantId: string; result: MigrationResult }> = [];
  for (const target of targets) {
    if (target.tenantId === canaryTenantId) continue;
    const pool = await target.connect();
    try {
      completed.push({ tenantId: target.tenantId, result: await applyMigrations(pool, migrations) });
    } catch (error) {
      return {
        canary: { tenantId: canaryTenantId, result: canaryResult },
        completed,
        failed: {
          tenantId: target.tenantId,
          error: error instanceof Error ? error.message : "unknown migration error",
        },
      };
    } finally {
      await pool.end();
    }
  }

  return { canary: { tenantId: canaryTenantId, result: canaryResult }, completed, failed: null };
}

/** Read-only planning: no tracking table, lock, baseline, or SQL is written. */
export async function pendingMigrations(pool: Pool, migrations: ReadonlyArray<MigrationFile>): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const exists = await client.query<{ name: string | null }>("select to_regclass('public.schema_migrations')::text as name");
    const rows = exists.rows[0]?.name
      ? (await client.query<{ id: string; checksum: string }>("select id, checksum from public.schema_migrations")).rows
      : [];
    const ids = new Set(migrations.map((migration) => migration.id));
    const prefixes = new Set(migrations.map((migration) => migration.id.includes("/") ? migration.id.split("/")[0] + "/" : ""));
    const relevant = rows.filter((row) => [...prefixes].some((prefix) => row.id.startsWith(prefix)));
    if (relevant.some((row) => !ids.has(row.id))) throw new Error("Database contains migrations outside the supplied catalog");
    const recorded = new Map(relevant.map((row) => [row.id, row.checksum]));
    const newest = [...recorded.keys()].sort().at(-1) ?? "";
    const pending: string[] = [];
    for (const migration of [...migrations].sort((a, b) => a.id.localeCompare(b.id))) {
      if (recorded.has(migration.id)) {
        if (recorded.get(migration.id) !== checksum(migration.sql)) throw new Error(`Migration checksum drift: ${migration.id}`);
      } else {
        if (migration.id.localeCompare(newest) < 0) throw new Error(`Migration ordering drift: ${migration.id}`);
        pending.push(migration.id);
      }
    }
    await client.query("commit");
    return pending;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
