import { describe, expect, it } from "vitest";
import { traceSpan, safeSpan, scrubErrorEvent } from "./tracing";

describe("safe observability boundaries", () => {
  it("runs without an SDK or collector and propagates the original failure", async () => {
    expect(await traceSpan("tenant.resolve", async () => 42)).toBe(42);
    const failure = new Error("private");
    await expect(traceSpan("identity.validate", async () => { throw failure; })).rejects.toBe(failure);
  });
  it("scrubs query text, connection details, headers, URLs, events and tenant identifiers", () => {
    const span = safeSpan({ name: "SELECT private FROM private", attributes: { "db.statement": "private", "db.connection_string": "private", "http.url": "private", "http.route": "/api/ready", "http.response.status_code": 200 }, events: [{ name: "private" }] });
    expect(JSON.stringify(span)).not.toContain("private");
    expect(span.attributes).toEqual({ "http.route": "/api/ready", "http.response.status_code": 200 });
  });
  it("replaces Sentry events with a strict allowlist, dropping request user exception and breadcrumbs", () => {
    const result = scrubErrorEvent({ event_id: "a".repeat(32), timestamp: 123, request: { data: "private" }, user: { email: "private" }, exception: { values: [{ value: "private" }] }, message: "private", breadcrumbs: [{ message: "private" }], extra: { content: "private" } });
    expect(result).toEqual({ event_id: "a".repeat(32), timestamp: 123, level: "error", message: "Platform operation failed" });
  });
});
