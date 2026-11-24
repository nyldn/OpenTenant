import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createUsageMetricRegistry } from "@opentenant/platform-core";
import { PgUsageLedger, UsageLedgerConflictError } from "./usage-ledger";

const integrationUrl = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
if (process.env.OPENTENANT_LOCAL_POSTGRES_PROOF === "usage" && !integrationUrl) throw new Error("usage PostgreSQL proof requires its controller-supplied database URL");
if (integrationUrl) { const url = new URL(integrationUrl); if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !url.pathname.slice(1).startsWith("opentenant_it_")) throw new Error("unsafe integration database URL"); }
const describeIntegration = integrationUrl ? describe : describe.skip;
const metrics = createUsageMetricRegistry([
  { metricId: "module.executions", unit: "execution", description: "Completed module executions" },
  { metricId: "storage.bytes", unit: "byte", description: "Stored bytes" },
]);
const event = (key: string, quantity = 3, occurredAt = "2026-08-06T10:00:00.000Z") => ({ tenantId: "ten_usage_store", metricId: "module.executions", quantity, occurredAt, sourceReference: "job:synthetic", fingerprint: `fp:${key}:${quantity}`, idempotencyKey: key });

describeIntegration("PgUsageLedger against PostgreSQL", () => {
  if (!integrationUrl) return; const pool = new Pool({ connectionString: integrationUrl, max: 8 });
  beforeAll(async () => { await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade"); await pool.query("create schema public"); const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../tooling/migrations/sql/control-plane"); for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".sql")).sort()) await pool.query(await readFile(join(directory, name), "utf8")); await pool.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('ten_usage_store','usage-store','Usage Store','active','eu'),('ten_usage_other','usage-other','Usage Other','active','eu')"); });
  afterAll(async () => pool.end());

  it("commits one event when two stores race the same idempotency key", async () => {
    const one = new PgUsageLedger(pool, metrics); const two = new PgUsageLedger(pool, metrics);
    const raceEvent = event("race", 3, "2026-08-05T10:00:00.000Z");
    const results = await Promise.all([one.append(raceEvent), two.append(raceEvent)]);
    expect(new Set(results.map((result) => result.eventId)).size).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect((await pool.query("select count(*)::int as count from exact_usage_events where tenant_id='ten_usage_store' and idempotency_key='race'")).rows[0].count).toBe(1);
    for (const mismatch of [
      { metricId: "storage.bytes" }, { quantity: 4 }, { occurredAt: "2026-08-05T10:00:00.001Z" },
      { sourceReference: "job:different" }, { fingerprint: "different" },
    ]) await expect(two.append({ ...raceEvent, ...mismatch })).rejects.toBeInstanceOf(UsageLedgerConflictError);
    await expect(two.correct({ ...raceEvent, quantity: -3, correctionOfEventId: results[0]!.eventId, reason: "Synthetic reconciliation" })).rejects.toBeInstanceOf(UsageLedgerConflictError);
    expect(await one.aggregate({ tenantId: "ten_usage_store", metricId: "module.executions", start: "2026-08-06T00:00:00.000Z", end: "2026-08-07T00:00:00.000Z" })).toBe(0);
  });

  it("commits distinct keys and aggregates half-open windows with corrections exactly once", async () => {
    const ledger = new PgUsageLedger(pool, metrics);
    const original = await ledger.append(event("distinct-a", 5)); await ledger.append(event("distinct-b", 5));
    await ledger.append(event("at-start", 7, "2026-08-06T00:00:00.000Z"));
    await ledger.append({ ...event("other-tenant", 40), tenantId: "ten_usage_other" });
    await ledger.append({ ...event("other-metric", 70), metricId: "storage.bytes" });
    await ledger.append(event("at-end", 99, "2026-08-07T00:00:00.000Z"));
    const correctionInput = { ...event("correction", -2), correctionOfEventId: original.eventId, reason: "Synthetic reconciliation" };
    const correction = await ledger.correct(correctionInput);
    expect(await ledger.correct(correctionInput)).toEqual(correction);
    const window = { start: "2026-08-06T00:00:00.000Z", end: "2026-08-07T00:00:00.000Z" } as const;
    expect(await ledger.aggregate({ tenantId: "ten_usage_store", metricId: "module.executions", ...window })).toBe(15);
    expect(await ledger.aggregate({ tenantId: "ten_usage_other", metricId: "module.executions", ...window })).toBe(40);
    expect(await ledger.aggregate({ tenantId: "ten_usage_store", metricId: "storage.bytes", ...window })).toBe(70);
    expect((await pool.query("select count(*)::int as count from exact_usage_events where idempotency_key in ('distinct-a','distinct-b')")).rows[0].count).toBe(2);
    const before = await ledger.aggregate({ tenantId: "ten_usage_store", metricId: "module.executions", ...window });
    await expect(ledger.correct({ ...event("unknown-correction", -1), metricId: "unknown.metric", correctionOfEventId: original.eventId, reason: "Synthetic reconciliation" })).rejects.toThrow("unregistered usage metric");
    await expect(ledger.correct({ ...event("cross-window-correction", -1, "2026-08-07T00:00:00.000Z"), correctionOfEventId: original.eventId, reason: "Synthetic reconciliation" })).rejects.toThrow();
    expect(await ledger.aggregate({ tenantId: "ten_usage_store", metricId: "module.executions", ...window })).toBe(before);
    expect((await pool.query("select quantity::int, occurred_at from exact_usage_events where event_id=$1", [original.eventId])).rows[0]).toMatchObject({ quantity: 5, occurred_at: new Date("2026-08-06T10:00:00.000Z") });
    await expect(ledger.correct({ ...event("correction", -2), correctionOfEventId: "f".repeat(32), reason: "Synthetic reconciliation" })).rejects.toBeInstanceOf(UsageLedgerConflictError);
    await expect(ledger.correct({ ...event("correction", -2), correctionOfEventId: original.eventId, reason: "Different reason" })).rejects.toBeInstanceOf(UsageLedgerConflictError);
    await ledger.append(event("proof-row", 1, "2026-08-06T23:00:00.000Z"));
  });
});
