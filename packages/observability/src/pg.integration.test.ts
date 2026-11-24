import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { safeSpan } from "./tracing";

const url = process.env.OBSERVABILITY_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || (!target.port || target.port === "5432") || !target.pathname.startsWith("/opentenant_it_")) throw new Error("Tracing proof requires its isolated local database");
}
const suite = url ? describe : describe.skip;
suite("pg transaction spans with an in-memory exporter", () => {
  if (!url) return;
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({ serviceName: "opentenant-platform", spanProcessors: [new SimpleSpanProcessor(exporter)], instrumentations: [new PgInstrumentation({ enhancedDatabaseReporting: false })], autoDetectResources: false, metricReaders: [], logRecordProcessors: [] });
  beforeAll(() => { sdk.start(); });
  afterAll(async () => { await sdk.shutdown(); });
  it("captures BEGIN query and COMMIT without exporting SQL or connection metadata", async () => {
    // Load pg only after instrumentation, as instrumentation.ts does at startup.
    const require = createRequire(new URL("../../../apps/platform/package.json", import.meta.url));
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select $1::text as synthetic_value", ["synthetic_private_value"]);
        await client.query("commit");
      } finally { client.release(); }
      const spans = exporter.getFinishedSpans().filter((span) => (span.attributes["db.system"] ?? span.attributes["db.system.name"]) === "postgresql");
      expect(spans.length).toBeGreaterThanOrEqual(3);
      const safe = spans.map(safeSpan);
      expect(safe.every((span) => span.name === "db.query")).toBe(true);
      expect(safe[0]!.spanContext().traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(JSON.stringify(safe.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, resource: span.resource })))).not.toMatch(/synthetic_private_value|db.statement|db.connection_string|postgresql:\/\//);
    } finally { await pool.end(); }
  });
});
