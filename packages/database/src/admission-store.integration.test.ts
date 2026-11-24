import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PgAdmissionStore } from "./admission-store";

const integrationUrl = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
if (process.env.OPENTENANT_LOCAL_POSTGRES_PROOF === "admission" && !integrationUrl) {
  throw new Error("admission PostgreSQL proof requires its controller-supplied database URL");
}
if (integrationUrl) {
  const url = new URL(integrationUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !url.pathname.slice(1).startsWith("opentenant_it_")) {
    throw new Error("CONTROL_PLANE_INTEGRATION_DATABASE_URL must identify a disposable loopback integration database");
  }
}
const describeIntegration = integrationUrl ? describe : describe.skip;
const policy = { maxRequests: 10, windowMs: 1_000, maxConcurrent: 10, leaseMs: 100, idempotencyTtlMs: 1_000, maxIdempotencyEntriesPerScope: 10, maxSizeBytes: 100 };
const request = (key: string, fingerprint = "fingerprint") => ({ scope: { tenantId: "ten_admission_store", principalId: "principal", operation: "read" }, idempotencyKey: key, fingerprint, sizeBytes: 1 });

describeIntegration("PgAdmissionStore against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 6 });
  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade"); await pool.query("create schema public");
    const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../tooling/migrations/sql/control-plane");
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".sql")).sort()) await pool.query(await readFile(join(directory, name), "utf8"));
    await pool.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('ten_admission_store','admission-store','Admission Store','active','eu')");
  });
  afterAll(async () => pool.end());

  it("replays the original decision across store instances and rejects fingerprint conflicts", async () => {
    const clock = { nowMs: () => 10_000 };
    const one = new PgAdmissionStore(pool, { clock, leaseIdFactory: { nextLeaseId: () => "c".repeat(32) } });
    const two = new PgAdmissionStore(pool, { clock, leaseIdFactory: { nextLeaseId: () => "d".repeat(32) } });
    const original = await one.admit(request("shared-key"), policy);
    const replay = await two.admit(request("shared-key"), policy);
    expect(original).toMatchObject({ admitted: true, replayed: false });
    expect(replay).toEqual({ ...(original as { admitted: true; lease: unknown }), replayed: true });
    await expect(two.admit(request("shared-key", "different"), policy)).resolves.toEqual({ admitted: false, code: "idempotency_conflict" });
  });

  it("ignores expired replay evidence without deleting live records", async () => {
    let now = 20_000; let id = "e".repeat(32);
    const store = new PgAdmissionStore(pool, { clock: { nowMs: () => now }, leaseIdFactory: { nextLeaseId: () => id } });
    expect(await store.admit(request("expired-key"), policy)).toMatchObject({ admitted: true, replayed: false });
    now = 20_500; id = "f".repeat(32);
    expect(await store.admit(request("live-key"), policy)).toMatchObject({ admitted: true, replayed: false });
    now = 21_001; id = "1".repeat(32);
    expect(await store.admit(request("expired-key", "replacement"), policy)).toMatchObject({ admitted: true, replayed: false });
    const rows = await pool.query("select idempotency_key from admission_idempotency_records where tenant_id='ten_admission_store' order by idempotency_key");
    expect(rows.rows).toEqual([{ idempotency_key: "expired-key" }, { idempotency_key: "live-key" }]);
  });

  it("serializes distinct-key concurrency across store instances", async () => {
    let unblockFirst!: () => void;
    let firstReachedCommit!: () => void;
    const reachedCommit = new Promise<void>((resolve) => { firstReachedCommit = resolve; });
    const unblockCommit = new Promise<void>((resolve) => { unblockFirst = resolve; });
    const concurrencyPolicy = { ...policy, maxConcurrent: 1 };
    const clock = { nowMs: () => 30_000 };
    const one = new PgAdmissionStore(pool, {
      clock,
      leaseIdFactory: { nextLeaseId: () => "2".repeat(32) },
      beforeCommit: async () => { firstReachedCommit(); await unblockCommit; },
    });
    const two = new PgAdmissionStore(pool, {
      clock,
      leaseIdFactory: { nextLeaseId: () => "3".repeat(32) },
    });

    const first = one.admit(request("concurrent-first"), concurrencyPolicy);
    await reachedCommit;
    const second = two.admit(request("concurrent-second"), concurrencyPolicy);
    let secondSettled = false;
    void second.finally(() => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondSettled).toBe(false);
    unblockFirst();

    await expect(first).resolves.toMatchObject({ admitted: true, replayed: false });
    await expect(second).resolves.toEqual({ admitted: false, code: "concurrency_limited" });
  });
});
