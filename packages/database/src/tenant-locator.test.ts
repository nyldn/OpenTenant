import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import { CredentialCipher } from "./credential-cipher";
import {
  ControlPlaneTenantDatabaseLocator,
  type TenantDatabaseRecord,
  type TenantDatabaseStore,
  withTenantContext,
} from "./tenant-locator";

const TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const CONNECTION_STRING = "postgresql://tenant:secret@db.example.test/tenant";
const tenantA = "tenant_a" as TenantId;
const tenantB = "tenant_b" as TenantId;

function poolStub() {
  const end = vi.fn(async (): Promise<void> => undefined);
  return { pool: { end } as unknown as Pool, end };
}

function recordFor(cipher: CredentialCipher, tenantId: TenantId): TenantDatabaseRecord {
  return {
    tenantId,
    provider: "neon",
    region: "aws-us-east-1",
    encryptedConnection: cipher.encrypt(CONNECTION_STRING, tenantId),
    schemaVersion: null,
  };
}

function storeWith(records: ReadonlyArray<TenantDatabaseRecord>): TenantDatabaseStore {
  const byTenant = new Map(records.map((record) => [record.tenantId, record]));
  return {
    get: vi.fn(async (tenantId: TenantId) => byTenant.get(tenantId) ?? null),
  };
}

describe("ControlPlaneTenantDatabaseLocator", () => {
  it("decrypts the stored record and passes the plaintext connection string to createPool", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const stub = poolStub();
    const createPool = vi.fn((_connectionString: string): Pool => stub.pool);
    const locator = new ControlPlaneTenantDatabaseLocator(
      storeWith([recordFor(cipher, tenantA)]),
      cipher,
      createPool,
    );

    await expect(locator.poolFor(tenantA)).resolves.toBe(stub.pool);
    expect(createPool).toHaveBeenCalledExactlyOnceWith(CONNECTION_STRING);
  });

  it("reuses the cached pool for a tenant", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const stub = poolStub();
    const createPool = vi.fn((_connectionString: string): Pool => stub.pool);
    const locator = new ControlPlaneTenantDatabaseLocator(
      storeWith([recordFor(cipher, tenantA)]),
      cipher,
      createPool,
    );

    const first = await locator.poolFor(tenantA);
    const second = await locator.poolFor(tenantA);

    expect(second).toBe(first);
    expect(createPool).toHaveBeenCalledTimes(1);
  });

  it("shares one pool between concurrent requests for the same tenant", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const stub = poolStub();
    const createPool = vi.fn((_connectionString: string): Pool => stub.pool);
    const locator = new ControlPlaneTenantDatabaseLocator(
      storeWith([recordFor(cipher, tenantA)]),
      cipher,
      createPool,
    );

    const [first, second] = await Promise.all([
      locator.poolFor(tenantA),
      locator.poolFor(tenantA),
    ]);

    expect(first).toBe(stub.pool);
    expect(second).toBe(first);
    expect(createPool).toHaveBeenCalledTimes(1);
  });

  it("rejects a record belonging to a different tenant", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const record = recordFor(cipher, tenantB);
    const store: TenantDatabaseStore = {
      get: vi.fn(async () => record),
    };
    const createPool = vi.fn((): Pool => poolStub().pool);
    const locator = new ControlPlaneTenantDatabaseLocator(store, cipher, createPool);

    await expect(locator.poolFor(tenantA)).rejects.toThrow(
      `store returned record for wrong tenant (asked ${tenantA})`,
    );
    expect(createPool).not.toHaveBeenCalled();
  });

  it("retries pool creation after a failed lookup", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const record = recordFor(cipher, tenantA);
    const stub = poolStub();
    const get = vi
      .fn<TenantDatabaseStore["get"]>()
      .mockRejectedValueOnce(new Error("control plane unavailable"))
      .mockResolvedValueOnce(record);
    const createPool = vi.fn((_connectionString: string): Pool => stub.pool);
    const locator = new ControlPlaneTenantDatabaseLocator({ get }, cipher, createPool);

    await expect(locator.poolFor(tenantA)).rejects.toThrow("control plane unavailable");
    await expect(locator.poolFor(tenantA)).resolves.toBe(stub.pool);

    expect(get).toHaveBeenCalledTimes(2);
    expect(createPool).toHaveBeenCalledExactlyOnceWith(CONNECTION_STRING);
  });

  it("names an unknown tenant without exposing a connection string", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const locator = new ControlPlaneTenantDatabaseLocator(
      storeWith([]),
      cipher,
      vi.fn((): Pool => poolStub().pool),
    );

    let thrown: unknown;
    try {
      await locator.poolFor(tenantA);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) throw new Error("expected unknown tenant lookup to throw");
    expect(thrown.message).toContain(tenantA);
    expect(thrown.message).not.toContain(CONNECTION_STRING);
  });

  it("ends every pool and clears the cache", async () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const stubs = [poolStub(), poolStub(), poolStub()];
    let nextPool = 0;
    const createPool = vi.fn((_connectionString: string): Pool => {
      const stub = stubs[nextPool];
      if (stub === undefined) throw new Error("unexpected pool creation");
      nextPool += 1;
      return stub.pool;
    });
    const locator = new ControlPlaneTenantDatabaseLocator(
      storeWith([recordFor(cipher, tenantA), recordFor(cipher, tenantB)]),
      cipher,
      createPool,
    );
    await locator.poolFor(tenantA);
    await locator.poolFor(tenantB);

    await locator.end();

    expect(stubs[0]?.end).toHaveBeenCalledTimes(1);
    expect(stubs[1]?.end).toHaveBeenCalledTimes(1);
    await expect(locator.poolFor(tenantA)).resolves.toBe(stubs[2]?.pool);
    expect(createPool).toHaveBeenCalledTimes(3);
  });
});

describe("withTenantContext", () => {
  function transactionStub(rollbackFails = false) {
    const calls: string[] = [];
    const release = vi.fn((destroy = false): void => {
      calls.push(`release:${String(destroy)}`);
    });
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push(values === undefined ? sql : `${sql}:${String(values[0])}`);
      if (sql === "rollback" && rollbackFails) throw new Error("rollback failed");
      return { rows: [] };
    });
    const client = { query, release } as unknown as PoolClient;
    const connect = vi.fn(async () => client);
    const pool = { connect } as unknown as Pool;
    return { calls, client, connect, pool, release };
  }

  it("sets transaction-local tenant context and commits before healthy release", async () => {
    const stub = transactionStub();

    await expect(withTenantContext(stub.pool, tenantA, async (client) => {
      expect(client).toBe(stub.client);
      stub.calls.push("callback");
      return "result";
    })).resolves.toBe("result");

    expect(stub.calls).toEqual([
      "begin",
      `select set_config('app.tenant_id', $1, true):${tenantA}`,
      "callback",
      "commit",
      "release:false",
    ]);
    expect(stub.connect).toHaveBeenCalledTimes(1);
    expect(stub.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("rolls back callback failures and returns a healthy client", async () => {
    const stub = transactionStub();
    const original = new Error("callback failed");

    await expect(withTenantContext(stub.pool, tenantA, async () => {
      stub.calls.push("callback");
      throw original;
    })).rejects.toBe(original);

    expect(stub.calls).toEqual([
      "begin",
      `select set_config('app.tenant_id', $1, true):${tenantA}`,
      "callback",
      "rollback",
      "release:false",
    ]);
    expect(stub.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("destroys the client after rollback failure while preserving the original error", async () => {
    const stub = transactionStub(true);
    const original = new Error("callback failed");

    await expect(withTenantContext(stub.pool, tenantA, async () => {
      throw original;
    })).rejects.toBe(original);

    expect(stub.calls.slice(-2)).toEqual(["rollback", "release:true"]);
    expect(stub.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
