import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { PgAdmissionStore } from "./admission-store";

describe("PgAdmissionStore", () => {
  it("rejects malformed admission before opening a transaction", async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    const store = new PgAdmissionStore(pool);
    await expect(store.admit({
      scope: { tenantId: " tenant", principalId: "principal", operation: "read" },
      idempotencyKey: "key", fingerprint: "fingerprint", sizeBytes: 1,
    }, {
      maxRequests: 1, windowMs: 1_000, maxConcurrent: 1, leaseMs: 100,
      idempotencyTtlMs: 1_000, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 10,
    })).resolves.toEqual({ admitted: false, code: "invalid_request" });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("uses a transaction-scoped database serialization guard", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("clock_timestamp")) return { rows: [{ now_ms: "100" }], rowCount: 1 };
        if (sql.includes("admission_policies") && sql.includes("for update")) return { rows: [], rowCount: 0 };
        if (sql.includes("admission_idempotency_records") && sql.includes("select")) return { rows: [], rowCount: 0 };
        if (sql.includes("count(*)") && sql.includes("admission_idempotency_records")) return { rows: [{ count: "0" }], rowCount: 1 };
        if (sql.includes("count(*)") && sql.includes("admission_leases")) return { rows: [{ count: "0" }], rowCount: 1 };
        if (sql.includes("admission_windows") && sql.includes("returning")) return { rows: [{ admitted_count: 1 }], rowCount: 1 };
        if (sql.includes("insert into admission_leases")) return { rows: [{ lease_id: "a".repeat(32), principal_id: "principal", operation: "read", admitted_ms: "100", expires_ms: "200", policy_snapshot: { maxRequests: 1, windowMs: 1_000, maxConcurrent: 1, leaseMs: 100, idempotencyTtlMs: 1_000, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 10 } }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }) as unknown as PoolClient["query"],
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const store = new PgAdmissionStore(pool, { leaseIdFactory: { nextLeaseId: () => "a".repeat(32) } });
    const decision = await store.admit({
      scope: { tenantId: "tenant", principalId: "principal", operation: "read" },
      idempotencyKey: "key", fingerprint: "fingerprint", sizeBytes: 1,
    }, {
      maxRequests: 1, windowMs: 1_000, maxConcurrent: 1, leaseMs: 100,
      idempotencyTtlMs: 1_000, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 10,
    });
    expect(decision).toMatchObject({ admitted: true, replayed: false });
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements[0]).toContain("begin");
    expect(statements.at(-1)).toContain("commit");
  });
});
