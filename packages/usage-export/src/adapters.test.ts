import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileUsageExportSink, OpenMeterUsageExportSink, usageCloudEvent } from "./index";

const entry = { eventId: "a".repeat(32), tenantId: "tenant_test", metricId: "module.executions", quantity: 3, occurredAt: "2026-11-11T12:00:00.000Z" };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });

export async function httpFixture(status: number) {
  const calls: Array<{ path: string; contentType: string | undefined; body: string; authorization: string | undefined }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, contentType: req.headers["content-type"], body, authorization: req.headers.authorization });
    res.writeHead(status); res.end(status === 204 ? undefined : "private provider error");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  return { endpoint: `http://127.0.0.1:${address.port}/api/v1/events`, calls };
}

describe("usage export adapters", () => {
  it("projects only metric, quantity, tenant and occurrence time with stable ledger identity", () => {
    const event = usageCloudEvent({ ...entry, sourceReference: "tenant content", correctionReason: "private reason" } as typeof entry);
    expect(event).toEqual({ specversion: "1.0", id: entry.eventId, source: "urn:opentenant:usage-ledger", subject: entry.tenantId, type: entry.metricId, time: entry.occurredAt, datacontenttype: "application/json", data: { quantity: 3 } });
    expect(usageCloudEvent({ ...entry, quantity: -2 }).data.quantity).toBe(-2);
  });
  it("posts CloudEvents batches to a mock HTTP server with explicit authentication", async () => {
    const fixture = await httpFixture(204);
    const sink = new OpenMeterUsageExportSink({ id: "local-test", endpoint: fixture.endpoint, apiKey: "synthetic-key" });
    await sink.emit([usageCloudEvent(entry)]);
    expect(fixture.calls).toEqual([{ path: "/api/v1/events", contentType: "application/cloudevents-batch+json", authorization: "Bearer synthetic-key", body: JSON.stringify([usageCloudEvent(entry)]) }]);
  });
  it.each([429, 500, 503])("classifies %i as retryable without exposing upstream text", async (status) => {
    const fixture = await httpFixture(status);
    const sink = new OpenMeterUsageExportSink({ id: "local-test", endpoint: fixture.endpoint });
    await expect(sink.emit([usageCloudEvent(entry)])).rejects.toMatchObject({ message: "Usage export failed", retryable: true });
  });
  it("does not retry authentication errors", async () => {
    const fixture = await httpFixture(401);
    await expect(new OpenMeterUsageExportSink({ id: "local-test", endpoint: fixture.endpoint }).emit([usageCloudEvent(entry)])).rejects.toMatchObject({ retryable: false });
  });
  it("refuses unsafe endpoints and non-integer quantities", () => {
    expect(() => new OpenMeterUsageExportSink({ id: "test", endpoint: "http://external.example.test/api/v1/events" })).toThrow();
    expect(() => usageCloudEvent({ ...entry, quantity: 0.1 })).toThrow();
    expect(() => usageCloudEvent({ ...entry, eventId: "../../file" })).toThrow();
  });
  it("publishes one file per event across replays, and detects identity conflicts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opentenant-usage-"));
    try {
      const sink = new FileUsageExportSink("files", directory);
      const event = usageCloudEvent(entry);
      await Promise.all([sink.emit([event]), sink.emit([event])]);
      expect(await readdir(directory)).toEqual([`${entry.eventId}.json`]);
      expect(JSON.parse(await readFile(join(directory, `${entry.eventId}.json`), "utf8"))).toEqual(event);
      await expect(sink.emit([{ ...event, data: { quantity: 4 } }])).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
