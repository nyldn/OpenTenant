import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenMeterUsageExportSink, runUsageExport, type UsageCloudEvent } from "./index";

const databaseUrl = process.env.USAGE_EXPORT_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/opentenant_it_")) throw new Error("usage export proof requires a loopback opentenant_it_ database");
}

describe.skipIf(!databaseUrl)("durable usage export with PostgreSQL and mock HTTP ingest", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const received = new Map<string, UsageCloudEvent>();
  const bodies: UsageCloudEvent[][] = [];
  let failures = 0;
  let reject = false;
  let endpoint: string;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const events: UsageCloudEvent[] = JSON.parse(body);
    bodies.push(events);
    if (reject) { res.writeHead(401); res.end("private token"); return; }
    for (const event of events) received.set(event.id, event);
    // Simulate ambiguous acceptance: accepted events followed by transient failure.
    res.writeHead(failures-- > 0 ? 503 : 204); res.end();
  });
  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade; create schema public");
    const directory = new URL("../../../tooling/migrations/sql/control-plane/", import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await pool.query(await readFile(new URL(file, directory), "utf8"));
    await pool.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('tenant_test','usage-export','Usage export','active','us')");
    await pool.query("insert into usage_metric_definitions (tenant_id,metric_id,unit,description) values ('tenant_test','module.executions','execution','Synthetic usage')");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server");
    endpoint = `http://127.0.0.1:${address.port}/api/v1/events`;
  }, 60_000);
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); });
  beforeEach(() => { failures = 0; reject = false; bodies.length = 0; received.clear(); });
  const id = (n: number) => n.toString(16).padStart(32, "0");
  async function append(n: number, correction?: number) {
    await pool.query(`insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,correction_of_event_id,correction_reason)
      values ($1,'tenant_test','module.executions',$2,'2026-11-11T12:00:00Z','private tenant content','private fingerprint',$3,$4)`, [id(n), correction ? -1 : 3, correction ? id(correction) : null, correction ? "private correction reason" : null]);
  }
  function options(sinkId: string) { return { pool, sink: new OpenMeterUsageExportSink({ id: sinkId, endpoint }), batchSize: 1, sleep: vi.fn(async () => undefined) }; }

  it("exports corrections as separate signed events, batches, retries and deduplicates", async () => {
    await append(1); await append(2, 1);
    failures = 2;
    const input = options("retry");
    expect(await runUsageExport(input)).toEqual({ exported: 2, batches: 2 });
    expect(input.sleep.mock.calls).toEqual([[250], [500]]);
    expect(bodies).toHaveLength(4);
    expect(received.size).toBe(2);
    expect(received.get(id(2))!.data.quantity).toBe(-1);
    expect(JSON.stringify(bodies)).not.toContain("private");
    expect(await runUsageExport(input)).toEqual({ exported: 0, batches: 0 });
    expect((await pool.query("select exported_count::int from usage_export_cursors where sink_id='retry'")).rows[0].exported_count).toBe(2);
  });
  it("leaves the durable cursor unadvanced on failure and resumes after restart", async () => {
    reject = true;
    await expect(runUsageExport(options("resume"))).rejects.toThrow("Usage export failed");
    expect((await pool.query("select * from usage_export_receipts where sink_id='resume'")).rowCount).toBe(0);
    reject = false;
    expect((await runUsageExport(options("resume"))).exported).toBe(2);
  });
  it("serializes concurrent workers for the same sink", async () => {
    const result = await Promise.all([runUsageExport(options("concurrent")), runUsageExport(options("concurrent"))]);
    expect(result.reduce((total, value) => total + value.exported, 0)).toBe(2);
    expect(bodies).toHaveLength(2);
  });
  it("finds late commits older than the last acknowledged event", async () => {
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query(`insert into exact_usage_events (event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,recorded_at)
        values ($1,'tenant_test','module.executions',1,'2026-11-11T12:00:00Z','private','private','2026-01-01')`, [id(3)]);
      expect((await runUsageExport(options("late"))).exported).toBe(2);
      await writer.query("commit");
      expect((await runUsageExport(options("late"))).exported).toBe(1);
      expect(received.has(id(3))).toBe(true);
    } finally { await writer.query("rollback"); writer.release(); }
  });
  it("bounds retry attempts and does not acknowledge an ambiguous batch", async () => {
    failures = 100;
    const input = { ...options("exhausted"), attempts: 3 };
    await expect(runUsageExport(input)).rejects.toThrow();
    expect(bodies).toHaveLength(3);
    expect(input.sleep).toHaveBeenCalledTimes(2);
    expect((await pool.query("select * from usage_export_receipts where sink_id='exhausted'")).rowCount).toBe(0);
    failures = 0;
    expect((await runUsageExport(input)).exported).toBe(3);
    expect(received.size).toBe(3);
  });
  it("preserves immutable ledger evidence and partitions sink cursors", async () => {
    await expect(pool.query("update exact_usage_events set quantity=99")).rejects.toThrow();
    await expect(pool.query("truncate exact_usage_events cascade")).rejects.toThrow();
    expect((await runUsageExport({ ...options("bounded"), maxBatches: 1 })).exported).toBe(1);
    expect((await runUsageExport(options("bounded"))).exported).toBe(2);
  });
});
