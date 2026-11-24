import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import { withTenantMemberMutationLockUsingPool } from "./member-mutation-lock";

const tenantId = "tenant_example" as TenantId;

function transactionStub(rollbackFails = false) {
  const calls: string[] = [];
  const release = vi.fn((destroy = false): void => {
    calls.push(`release:${String(destroy)}`);
  });
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push(values === undefined ? sql : `${sql}:${values.join(",")}`);
    if (sql === "rollback" && rollbackFails) throw new Error("rollback failed");
    return { rows: [] };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  return { calls, client, connect, pool, query, release };
}

describe("tenant member mutation advisory lock", () => {
  it("begins, takes a parameterized transaction lock, commits, and releases", async () => {
    const stub = transactionStub();

    await expect(withTenantMemberMutationLockUsingPool(
      stub.pool,
      tenantId,
      async (client) => {
        expect(client).toBe(stub.client);
        await client.query("select locked_operation");
        stub.calls.push("operation");
        return "result";
      },
    )).resolves.toBe("result");

    expect(stub.calls).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2)):opentenant.member-removal.v1,tenant_example",
      "select locked_operation",
      "operation",
      "commit",
      "release:false",
    ]);
    expect(stub.query).toHaveBeenNthCalledWith(
      2,
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["opentenant.member-removal.v1", tenantId],
    );
  });

  it("rolls back operation failures and releases a healthy client", async () => {
    const stub = transactionStub();
    const original = new Error("provider list failed");

    await expect(withTenantMemberMutationLockUsingPool(
      stub.pool,
      tenantId,
      async () => {
        stub.calls.push("operation");
        throw original;
      },
    )).rejects.toBe(original);

    expect(stub.calls).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2)):opentenant.member-removal.v1,tenant_example",
      "operation",
      "rollback",
      "release:false",
    ]);
  });

  it("destroys the client after rollback failure and preserves the operation error", async () => {
    const stub = transactionStub(true);
    const original = new Error("provider delete failed");

    await expect(withTenantMemberMutationLockUsingPool(
      stub.pool,
      tenantId,
      async () => {
        throw original;
      },
    )).rejects.toBe(original);

    expect(stub.calls.slice(-2)).toEqual(["rollback", "release:true"]);
    expect(stub.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});


it("completes five serialized mutations when all pool connections hold or await the lock", async () => {
  let lockTail = Promise.resolve();
  let checkouts = 0;
  let completed = 0;
  const database = {
    connect: vi.fn(async () => {
      if (++checkouts > 5) throw new Error("pool exhausted");
      let unlock: () => void = () => undefined;
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("pg_advisory_xact_lock")) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => { unlock = resolve; });
            await previous;
          }
          if (sql === "commit" || sql === "rollback") unlock();
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      return client as unknown as PoolClient;
    }),
  };
  await Promise.all(Array.from({ length: 5 }, () => withTenantMemberMutationLockUsingPool(
    database, tenantId, async (client) => {
      expect(checkouts).toBe(5);
      await client.query("select operation_on_locked_client");
      completed++;
    },
  )));
  expect(completed).toBe(5);
  expect(database.connect).toHaveBeenCalledTimes(5);
});
