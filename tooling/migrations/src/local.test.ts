import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error local.mjs is the Node entrypoint and has no declaration output.
import { runLocalSetup } from "./local.mjs";

function setupPool() {
  const query = vi.fn(async () => ({ rows: [] }));
  const release = vi.fn();
  const seedClient = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => seedClient);
  const end = vi.fn(async (): Promise<void> => undefined);
  const pool = { connect, end } as unknown as Pool;
  const poolFactory = vi.fn(() => pool);

  return { pool, poolFactory, seedClient, connect, release, end };
}

describe("runLocalSetup", () => {
  it("migrates before seeding and closes every resource", async () => {
    const stub = setupPool();
    const catalog = [{ id: "0001_init", sql: "select 1" }];
    const loadMigrations = vi.fn(async () => catalog);
    const migrate = vi.fn(async () => ({ applied: ["0001_init"], skipped: [] }));
    const seedDatabase = vi.fn(async () => undefined);
    const log = vi.fn();

    await runLocalSetup({
      databaseUrl: "postgresql://user:password@127.0.0.1:5432/opentenant_it_local",
      poolFactory: stub.poolFactory,
      loadMigrations,
      migrate,
      seedDatabase,
      log,
    });

    expect(stub.poolFactory).toHaveBeenCalledWith(
      "postgresql://user:password@127.0.0.1:5432/opentenant_it_local",
    );
    expect(migrate).toHaveBeenCalledWith(stub.pool, catalog);
    expect(seedDatabase).toHaveBeenCalledWith(stub.seedClient);
    expect(migrate.mock.invocationCallOrder[0]).toBeLessThan(
      seedDatabase.mock.invocationCallOrder[0]!,
    );
    expect(stub.release).toHaveBeenCalledOnce();
    expect(stub.end).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Local OpenTenant database is migrated and seeded.");
  });

  it("does not seed when migration fails and still closes the pool", async () => {
    const stub = setupPool();
    const migrationError = new Error("migration failed");
    const seedDatabase = vi.fn(async () => undefined);

    await expect(runLocalSetup({
      poolFactory: stub.poolFactory,
      loadMigrations: async () => [{ id: "0001_init", sql: "select broken()" }],
      migrate: async () => {
        throw migrationError;
      },
      seedDatabase,
      log: vi.fn(),
    })).rejects.toBe(migrationError);

    expect(stub.connect).not.toHaveBeenCalled();
    expect(seedDatabase).not.toHaveBeenCalled();
    expect(stub.release).not.toHaveBeenCalled();
    expect(stub.end).toHaveBeenCalledOnce();
  });

  it("releases the seed client and closes the pool when seeding fails", async () => {
    const stub = setupPool();
    const seedError = new Error("seed failed");

    await expect(runLocalSetup({
      poolFactory: stub.poolFactory,
      loadMigrations: async () => [],
      migrate: async () => ({ applied: [], skipped: [] }),
      seedDatabase: async () => {
        throw seedError;
      },
      log: vi.fn(),
    })).rejects.toBe(seedError);

    expect(stub.release).toHaveBeenCalledOnce();
    expect(stub.end).toHaveBeenCalledOnce();
  });

  it("rejects non-loopback database URLs before creating a pool", async () => {
    const stub = setupPool();

    await expect(runLocalSetup({
      databaseUrl: "postgresql://user:password@database.example.test/opentenant",
      poolFactory: stub.poolFactory,
      loadMigrations: async () => [],
      migrate: async () => ({ applied: [], skipped: [] }),
      seedDatabase: async () => undefined,
      log: vi.fn(),
    })).rejects.toThrow("Local migration command only accepts a loopback database");

    expect(stub.poolFactory).not.toHaveBeenCalled();
  });
});
