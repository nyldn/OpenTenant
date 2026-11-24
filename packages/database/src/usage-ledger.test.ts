import { describe, expect, it } from "vitest";
import { createUsageMetricRegistry } from "@opentenant/platform-core";
import { PgUsageLedger, UsageLedgerConflictError, UsageLedgerValidationError } from "./usage-ledger";

const metrics = createUsageMetricRegistry([
  { metricId: "module.executions", unit: "execution", description: "Completed module executions" },
  { metricId: "storage.bytes", unit: "byte", description: "Stored bytes" },
]);
describe("PgUsageLedger validation", () => {
  it("keeps admission outcomes separate and rejects unregistered or invalid usage", async () => {
    const pool = { connect: async () => { throw new Error("database must not be reached"); } };
    const ledger = new PgUsageLedger(pool as never, metrics);
    await expect(ledger.append({ tenantId: "tenant", metricId: "request.metric", quantity: 1, occurredAt: "2026-08-06T00:00:00.000Z", sourceReference: "source", fingerprint: "fingerprint", idempotencyKey: "key" })).rejects.toThrow("unregistered usage metric");
    await expect(ledger.append({ tenantId: "tenant", metricId: "module.executions", quantity: 0, occurredAt: "2026-08-06T00:00:00.000Z", sourceReference: "source", fingerprint: "fingerprint", idempotencyKey: "key" })).rejects.toBeInstanceOf(UsageLedgerValidationError);
  });

  it("replays only a complete immutable event identity", async () => {
    const row = {
      event_id: "a".repeat(32), tenant_id: "tenant", metric_id: "module.executions", quantity: "3",
      occurred_at: new Date("2026-08-06T10:00:00.000Z"), recorded_at: new Date("2026-08-06T10:01:00.000Z"),
      source_reference: "source", fingerprint: "fingerprint", idempotency_key: "key",
      correction_of_event_id: null, correction_reason: null,
    };
    const client = { query: async (sql: string) => ({ rows: sql.includes("select * from exact_usage_events") ? [row] : [] }), release: () => undefined };
    const ledger = new PgUsageLedger({ connect: async () => client } as never, metrics);
    const original = { tenantId: "tenant", metricId: "module.executions", quantity: 3, occurredAt: "2026-08-06T10:00:00.000Z", sourceReference: "source", fingerprint: "fingerprint", idempotencyKey: "key" };
    await expect(ledger.append(original)).resolves.toMatchObject({ eventId: row.event_id });
    for (const mismatch of [
      { metricId: "storage.bytes" }, { quantity: 4 }, { occurredAt: "2026-08-06T10:00:00.001Z" },
      { sourceReference: "different" }, { fingerprint: "different" },
    ]) await expect(ledger.append({ ...original, ...mismatch })).rejects.toBeInstanceOf(UsageLedgerConflictError);
    await expect(ledger.correct({ ...original, quantity: -3, correctionOfEventId: "b".repeat(32), reason: "Synthetic correction" })).rejects.toBeInstanceOf(UsageLedgerConflictError);
  });
});
