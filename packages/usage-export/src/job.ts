import type { Pool } from "pg";
import { UsageExportError, usageCloudEvent, type UsageExportEntry, type UsageExportSink } from "./contracts";

export interface UsageExportOptions {
  readonly pool: Pool;
  readonly sink: UsageExportSink;
  readonly batchSize?: number;
  readonly maxBatches?: number;
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Worker wiring point. No scheduler or environment reads; one bounded drain. */
export async function runUsageExport(options: UsageExportOptions): Promise<{ exported: number; batches: number }> {
  const { pool, sink } = options;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(sink.id)) throw new UsageExportError();
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 10;
  const attempts = options.attempts ?? 4;
  const backoffMs = options.backoffMs ?? 250;
  const bounds = [[batchSize, 1000], [maxBatches, 1000], [attempts, 10], [backoffMs, 30_000]] as const;
  if (bounds.some(([value, max]) => !Number.isSafeInteger(value) || value < 1 || value > max)) throw new UsageExportError();
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let exported = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("insert into usage_export_cursors (sink_id) values ($1) on conflict do nothing", [sink.id]);
      // Serialize drains for this sink across workers, including delivery/ack.
      await client.query("select sink_id from usage_export_cursors where sink_id=$1 for update", [sink.id]);
      const result = await client.query<{ event_id: string; tenant_id: string; metric_id: string; quantity: string; occurred_at: Date }>(`select e.event_id,e.tenant_id,e.metric_id,e.quantity,e.occurred_at
        from exact_usage_events e where not exists
        (select 1 from usage_export_receipts r where r.sink_id=$1 and r.event_id=e.event_id)
        order by e.recorded_at,e.event_id limit $2`, [sink.id, batchSize]);
      const entries: UsageExportEntry[] = result.rows.map((row) => ({ eventId: row.event_id, tenantId: row.tenant_id, metricId: row.metric_id, quantity: Number(row.quantity), occurredAt: row.occurred_at.toISOString() }));
      if (!entries.length) { await client.query("commit"); break; }
      const events = entries.map(usageCloudEvent);
      for (let attempt = 1; ; attempt++) {
        try { await sink.emit(events); break; }
        catch (error) {
          if (!(error instanceof UsageExportError) || !error.retryable || attempt >= attempts) throw new UsageExportError();
          await sleep(Math.min(30_000, backoffMs * 2 ** (attempt - 1)));
        }
      }
      await client.query(`insert into usage_export_receipts (sink_id,event_id) select $1,unnest($2::text[])`, [sink.id, entries.map((entry) => entry.eventId)]);
      await client.query(`update usage_export_cursors set last_event_id=$2, exported_count=exported_count+$3, updated_at=clock_timestamp() where sink_id=$1`, [sink.id, entries.at(-1)!.eventId, entries.length]);
      await client.query("commit");
      exported += entries.length;
      batches++;
    } catch {
      await client.query("rollback").catch(() => undefined);
      throw new UsageExportError();
    } finally { client.release(); }
  }
  return { exported, batches };
}
