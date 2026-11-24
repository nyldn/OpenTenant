import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { applyMigrations, applyToFleet, type FleetTarget } from "./runner";

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function recordingPool(
  options: {
    recorded?: Array<{ id: string; checksum: string }>;
    failure?: Error;
    failOnSql?: string;
  } = {},
) {
  const clientSql: string[] = [];
  const clientQuery = vi.fn(async (sql: string, _values?: unknown[]) => {
    clientSql.push(sql);
    if (options.failure !== undefined || sql === options.failOnSql) {
      throw options.failure ?? new Error(`query failed: ${sql}`);
    }
    return {
      rows: sql === "select id, checksum from schema_migrations"
        ? (options.recorded ?? [])
        : [],
    };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  const end = vi.fn(async (): Promise<void> => undefined);
  const pool = { connect, end } as unknown as Pool;

  return { pool, clientSql, connect, clientQuery, release, end };
}

function target(tenantId: string, pool: Pool) {
  const connect = vi.fn(async () => pool);
  return { target: { tenantId, connect } satisfies FleetTarget, connect };
}

describe("applyMigrations", () => {
  it("baselines an untracked legacy catalog under the migration lock before applying upgrades", async () => {
    const initialSql = "select 'initial'";
    const upgradeSql = "select 'upgrade'";
    const stub = recordingPool({
      recorded: [{ id: "another-module/0001_init", checksum: migrationChecksum("select 'other'") }],
    });
    const baseline = vi.fn(async (client: { query(sql: string): Promise<unknown> }) => {
      await client.query("select inspect_legacy_schema()");
      return ["tenant-core/0001_init"];
    });

    await expect(
      applyMigrations(
        stub.pool,
        [
          { id: "tenant-core/0001_init", sql: initialSql },
          { id: "tenant-core/0002_upgrade", sql: upgradeSql },
        ],
        { baseline },
      ),
    ).resolves.toEqual({
      applied: ["tenant-core/0002_upgrade"],
      skipped: ["tenant-core/0001_init"],
    });

    expect(baseline).toHaveBeenCalledTimes(1);
    expect(stub.clientSql).toEqual([
      "select pg_advisory_lock($1)",
      expect.stringContaining("create table if not exists schema_migrations"),
      "select id, checksum from schema_migrations",
      "begin",
      "select inspect_legacy_schema()",
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      "commit",
      "begin",
      upgradeSql,
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      "commit",
      "select pg_advisory_unlock($1)",
    ]);
    expect(stub.clientQuery).toHaveBeenCalledWith(
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      ["tenant-core/0001_init", migrationChecksum(initialSql)],
    );
  });

  it("rolls back a failed legacy baseline and does not apply migrations", async () => {
    const stub = recordingPool();
    const baseline = vi.fn(async () => {
      throw new Error("legacy schema is ambiguous");
    });

    await expect(
      applyMigrations(
        stub.pool,
        [{ id: "tenant-core/0001_init", sql: "select 'initial'" }],
        { baseline },
      ),
    ).rejects.toThrow("legacy schema is ambiguous");

    expect(stub.clientSql).toContain("rollback");
    expect(stub.clientSql.filter((sql) => sql === "begin")).toHaveLength(1);
    expect(stub.clientSql).not.toContain("select 'initial'");
  });

  it("does not inspect a legacy baseline after this catalog has a recorded migration", async () => {
    const initialSql = "select 'initial'";
    const stub = recordingPool({
      recorded: [{
        id: "tenant-core/0001_init",
        checksum: migrationChecksum(initialSql),
      }],
    });
    const baseline = vi.fn(async () => ["tenant-core/0001_init"]);

    await expect(applyMigrations(
      stub.pool,
      [
        { id: "tenant-core/0001_init", sql: initialSql },
        { id: "tenant-core/0002_upgrade", sql: "select 'upgrade'" },
      ],
      { baseline },
    )).resolves.toEqual({
      applied: ["tenant-core/0002_upgrade"],
      skipped: ["tenant-core/0001_init"],
    });

    expect(baseline).not.toHaveBeenCalled();
  });

  it("creates the tracking table, applies pending migrations in lexical order, and skips recorded ids", async () => {
    const firstSql = "select 'first'";
    const stub = recordingPool({
      recorded: [{ id: "0001_first", checksum: migrationChecksum(firstSql) }],
    });
    const migrations = [
      { id: "0003_third", sql: "select 'third'" },
      { id: "0001_first", sql: firstSql },
      { id: "0002_second", sql: "select 'second'" },
    ];

    await expect(applyMigrations(stub.pool, migrations)).resolves.toEqual({
      applied: ["0002_second", "0003_third"],
      skipped: ["0001_first"],
    });

    expect(stub.clientSql[0]).toBe("select pg_advisory_lock($1)");
    expect(stub.clientSql[1]).toContain("create table if not exists schema_migrations");
    expect(stub.clientSql[2]).toBe("select id, checksum from schema_migrations");
    expect(stub.clientSql.slice(3, -1)).toEqual([
      "begin",
      "select 'second'",
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      "commit",
      "begin",
      "select 'third'",
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      "commit",
    ]);
    expect(stub.clientSql.at(-1)).toBe("select pg_advisory_unlock($1)");
    expect(stub.clientQuery).toHaveBeenNthCalledWith(
      6,
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      ["0002_second", migrationChecksum("select 'second'")],
    );
    expect(stub.clientQuery).toHaveBeenNthCalledWith(
      10,
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      ["0003_third", migrationChecksum("select 'third'")],
    );
    expect(stub.connect).toHaveBeenCalledTimes(1);
    expect(stub.release).toHaveBeenCalledTimes(1);
  });

  it("throws when a recorded migration checksum has drifted", async () => {
    const stub = recordingPool({
      recorded: [{ id: "0001_init", checksum: migrationChecksum("select 'old'") }],
    });

    await expect(
      applyMigrations(stub.pool, [{ id: "0001_init", sql: "select 'changed'" }]),
    ).rejects.toThrow("migration 0001_init was modified after being applied (checksum drift)");

    expect(stub.clientSql).not.toContain("begin");
    expect(stub.clientSql.at(-1)).toBe("select pg_advisory_unlock($1)");
  });

  it("throws when a pending migration is older than the newest recorded migration", async () => {
    const stub = recordingPool({
      recorded: [{ id: "0002_second", checksum: migrationChecksum("select 'second'") }],
    });

    await expect(
      applyMigrations(stub.pool, [{ id: "0001_first", sql: "select 'first'" }]),
    ).rejects.toThrow(
      "migration 0001_first is older than already-applied 0002_second; refusing out-of-order apply",
    );

    expect(stub.clientSql).not.toContain("begin");
  });

  it("rolls back a failed migration without inserting a tracking row", async () => {
    const migrationSql = "select broken_migration()";
    const stub = recordingPool({ failOnSql: migrationSql });

    await expect(
      applyMigrations(stub.pool, [{ id: "0001_broken", sql: migrationSql }]),
    ).rejects.toThrow(`query failed: ${migrationSql}`);

    expect(stub.clientSql).toContain("begin");
    expect(stub.clientSql).toContain(migrationSql);
    expect(stub.clientSql).toContain("rollback");
    expect(stub.clientSql).not.toContain(
      "insert into schema_migrations (id, checksum) values ($1, $2)",
    );
  });

  it("runs a migration preflight inside the transaction before applying SQL", async () => {
    const stub = recordingPool();
    const beforeApply = vi.fn(async (
      client: { query(sql: string): Promise<unknown> },
      migration: { id: string },
    ) => {
      await client.query(`select preflight('${migration.id}')`);
    });

    await applyMigrations(
      stub.pool,
      [{ id: "0001_guarded", sql: "select guarded_migration()" }],
      { beforeApply },
    );

    expect(beforeApply).toHaveBeenCalledOnce();
    expect(stub.clientSql.slice(3, -1)).toEqual([
      "begin",
      "select preflight('0001_guarded')",
      "select guarded_migration()",
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      "commit",
    ]);
  });
});

describe("applyToFleet", () => {
  it("runs the canary first and does not connect any other tenant after canary failure", async () => {
    const canaryPool = recordingPool({ failure: new Error("canary failed") });
    const otherPool = recordingPool();
    const canary = target("tenant_canary", canaryPool.pool);
    const other = target("tenant_other", otherPool.pool);

    await expect(
      applyToFleet([other.target, canary.target], [], "tenant_canary"),
    ).rejects.toThrow("canary failed");

    expect(canary.connect).toHaveBeenCalledTimes(1);
    expect(other.connect).not.toHaveBeenCalled();
    expect(canaryPool.end).toHaveBeenCalledTimes(1);
  });

  it("halts at the first non-canary failure and reports completed tenants", async () => {
    const canaryPool = recordingPool();
    const completedPool = recordingPool();
    const failedPool = recordingPool({ failure: new Error("tenant migration failed") });
    const untouchedPool = recordingPool();
    const canary = target("tenant_canary", canaryPool.pool);
    const completed = target("tenant_completed", completedPool.pool);
    const failed = target("tenant_failed", failedPool.pool);
    const untouched = target("tenant_untouched", untouchedPool.pool);

    await expect(
      applyToFleet(
        [canary.target, completed.target, failed.target, untouched.target],
        [],
        "tenant_canary",
      ),
    ).resolves.toEqual({
      canary: {
        tenantId: "tenant_canary",
        result: { applied: [], skipped: [] },
      },
      completed: [
        {
          tenantId: "tenant_completed",
          result: { applied: [], skipped: [] },
        },
      ],
      failed: { tenantId: "tenant_failed", error: "tenant migration failed" },
    });

    expect(completed.connect).toHaveBeenCalledTimes(1);
    expect(failed.connect).toHaveBeenCalledTimes(1);
    expect(untouched.connect).not.toHaveBeenCalled();
    expect(completedPool.end).toHaveBeenCalledTimes(1);
    expect(failedPool.end).toHaveBeenCalledTimes(1);
  });
});
