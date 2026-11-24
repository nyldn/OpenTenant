import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ExactUsageEvent, ExactUsageWindow, UsageMetricRegistry } from "@opentenant/platform-core";
import { validateExactUsageWindow } from "@opentenant/platform-core";

export interface AppendExactUsageInput {
  readonly tenantId: string; readonly metricId: string; readonly quantity: number;
  readonly occurredAt: string; readonly sourceReference: string; readonly fingerprint: string;
  readonly idempotencyKey: string;
}
export interface CorrectExactUsageInput extends AppendExactUsageInput {
  readonly correctionOfEventId: string; readonly reason: string;
}
export interface AggregateExactUsageInput extends ExactUsageWindow { readonly tenantId: string; readonly metricId: string }
export class UsageLedgerConflictError extends Error {}
export class UsageLedgerValidationError extends Error {}

const bounded = (value: unknown, max = 128) => typeof value === "string" && value.length > 0 && value.length <= max
  && value === value.trim() && /^[\x20-\x7e]+$/.test(value);
const safe = (value: unknown, positive: boolean) => typeof value === "number" && Number.isSafeInteger(value)
  && (positive ? value > 0 : value !== 0);
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
type Row = { event_id: string; tenant_id: string; metric_id: string; quantity: string; occurred_at: Date; recorded_at: Date; source_reference: string; fingerprint: string; idempotency_key: string | null; correction_of_event_id: string | null; correction_reason: string | null };

export class PgUsageLedger {
  constructor(private readonly pool: Pool, private readonly metrics: UsageMetricRegistry) {}

  async append(input: AppendExactUsageInput): Promise<ExactUsageEvent> {
    return this.write(input, null, null, true);
  }
  async correct(input: CorrectExactUsageInput): Promise<ExactUsageEvent> {
    if (!bounded(input.correctionOfEventId, 32) || !bounded(input.reason, 256)) throw new UsageLedgerValidationError("invalid correction");
    return this.write(input, input.correctionOfEventId, input.reason, false);
  }
  async aggregate(input: AggregateExactUsageInput): Promise<number> {
    if (!bounded(input.tenantId) || Object.keys(input).length !== 4) throw new UsageLedgerValidationError("invalid aggregate request");
    this.metrics.require(input.metricId);
    const window = validateExactUsageWindow({ start: input.start, end: input.end });
    const result = await this.pool.query(`select coalesce(sum(quantity),0)::text as total from exact_usage_events
      where tenant_id=$1 and metric_id=$2 and occurred_at >= $3::timestamptz and occurred_at < $4::timestamptz`,
    [input.tenantId, input.metricId, window.start, window.end]);
    const total = Number(result.rows[0]?.total ?? 0);
    if (!Number.isSafeInteger(total)) throw new UsageLedgerValidationError("usage aggregate exceeds safe integer range");
    return total;
  }

  private async write(input: AppendExactUsageInput, correction: string | null, reason: string | null, positive: boolean) {
    if (!input || !bounded(input.tenantId) || !safe(input.quantity, positive) || !iso(input.occurredAt)
      || !bounded(input.sourceReference) || !bounded(input.fingerprint) || !bounded(input.idempotencyKey)) {
      throw new UsageLedgerValidationError("invalid exact usage event");
    }
    const definition = this.metrics.require(input.metricId);
    return this.transaction(async (client) => {
      const lock = `${input.tenantId.length}:${input.tenantId}${input.idempotencyKey}`;
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
      const replay = (await client.query<Row>(`select * from exact_usage_events where tenant_id=$1 and idempotency_key=$2`, [input.tenantId, input.idempotencyKey])).rows[0];
      if (replay) {
        if (replay.metric_id !== input.metricId || Number(replay.quantity) !== input.quantity
          || replay.occurred_at.toISOString() !== input.occurredAt || replay.source_reference !== input.sourceReference
          || replay.fingerprint !== input.fingerprint || replay.correction_of_event_id !== correction
          || replay.correction_reason !== reason) {
          throw new UsageLedgerConflictError("idempotency event identity conflict");
        }
        return this.event(replay);
      }
      await client.query(`insert into usage_metric_definitions (tenant_id,metric_id,unit,description) values ($1,$2,$3,$4)
        on conflict (tenant_id,metric_id) do nothing`, [input.tenantId, definition.metricId, definition.unit, definition.description]);
      const persisted = (await client.query(`select unit,description from usage_metric_definitions where tenant_id=$1 and metric_id=$2`, [input.tenantId, definition.metricId])).rows[0];
      if (!persisted || persisted.unit !== definition.unit || persisted.description !== definition.description) throw new UsageLedgerConflictError("metric definition conflict");
      const inserted = await client.query<Row>(`insert into exact_usage_events
        (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,idempotency_key,correction_of_event_id,correction_reason)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [randomBytes(16).toString("hex"), input.tenantId, input.metricId, input.quantity, input.occurredAt,
        input.sourceReference, input.fingerprint, input.idempotencyKey, correction, reason]);
      return this.event(inserted.rows[0]!);
    });
  }
  private event(row: Row): ExactUsageEvent { return Object.freeze({
    eventId: row.event_id, tenantId: row.tenant_id, metricId: row.metric_id, quantity: Number(row.quantity),
    occurredAt: row.occurred_at.toISOString(), recordedAt: row.recorded_at.toISOString(), sourceReference: row.source_reference,
    fingerprint: row.fingerprint, idempotencyKey: row.idempotency_key, correctionOfEventId: row.correction_of_event_id,
    correctionReason: row.correction_reason,
  }); }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); try { await client.query("begin"); const result = await operation(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
}
