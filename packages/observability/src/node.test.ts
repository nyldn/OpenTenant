import { describe, expect, it } from "vitest";
import { tracingComponents } from "./node";

describe("collector configuration", () => {
  it.each(["not-a-url", "ftp://example.test/traces", "https://public:secret@example.test/traces", "https://example.test/traces?token=secret"])("rejects invalid endpoints with a generic error", (endpoint) => {
    expect(() => tracingComponents(endpoint)).toThrow("Invalid trace collector configuration");
  });
  it("constructs the pg adapter and exporter without contacting a collector", async () => {
    const components = tracingComponents("http://127.0.0.1:4318/v1/traces");
    expect(components.instrumentations).toHaveLength(1);
    for (const instrumentation of components.instrumentations) instrumentation.disable();
    await components.traceExporter.shutdown();
  });
});
