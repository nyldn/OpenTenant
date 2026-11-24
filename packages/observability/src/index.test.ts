import { describe, expect, it } from "vitest";
import { validateTelemetryEvent as validateEvent } from "./index";

const sampleSchemas = {
    "sample.page.viewed": {},
    "sample.readout.completed": { provider: "string", latencyMs: "number" },
    "sample.readout.failed": { provider: "string", errorCode: "string", latencyMs: "number" },
    "sample.export.completed": { format: "string", respondentCount: "number" },
    "sample.import.completed": { respondentCount: "number" },
    "sample.import.rejected": { errorCount: "number" },
  } as const;
const validateTelemetryEvent = (input: unknown) => validateEvent(input, sampleSchemas);

function telemetryEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "sample.readout.completed",
    tenantId: "tenant_test",
    moduleKey: "sample",
    moduleVersion: "1.0.0",
    occurredAt: "2026-07-16T12:00:00.000Z",
    properties: {
      provider: "openai",
      latencyMs: 250,
    },
    ...overrides,
  };
}

describe("validateTelemetryEvent", () => {
  it("accepts a valid sample.readout.completed event", () => {
    const event = telemetryEvent();

    const result = validateTelemetryEvent(event);

    expect(result).toEqual({ ok: true, event });
    if (result.ok) {
      expect(result.event).not.toBe(event);
      expect(result.event.properties).not.toBe(event.properties);
    }
  });

  it("rejects extra or missing top-level fields", () => {
    expect(validateTelemetryEvent({ ...telemetryEvent(), content: "private" })).toEqual({
      ok: false,
      reason: "invalid event shape",
    });
    const { properties: _properties, ...missingProperties } = telemetryEvent();
    expect(validateTelemetryEvent(missingProperties)).toEqual({
      ok: false,
      reason: "invalid event shape",
    });
  });

  it("requires the event prefix to match the module key", () => {
    expect(validateTelemetryEvent(telemetryEvent({ moduleKey: "support" }))).toEqual({
      ok: false,
      reason: "event and module mismatch",
    });
    expect(
      validateTelemetryEvent(
        telemetryEvent({
          name: "platform.health.checked",
          moduleKey: "platform",
          properties: {},
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects unbounded identity fields", () => {
    expect(validateTelemetryEvent(telemetryEvent({ moduleVersion: " " }))).toEqual({
      ok: false,
      reason: "missing module identity",
    });
    expect(validateTelemetryEvent(telemetryEvent({ moduleVersion: "x".repeat(65) }))).toEqual({
      ok: false,
      reason: "missing module identity",
    });
  });

  it("rejects an unknown event name", () => {
    const result = validateTelemetryEvent(telemetryEvent({ name: "sample.unknown" }));

    expect(result).toEqual({ ok: false, reason: "unknown event name" });
  });

  it("rejects content-like string property values", () => {
    expect(
      validateTelemetryEvent(
        telemetryEvent({
          properties: { provider: "Private Person's provider" },
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "property provider has an invalid string value",
    });
  });

  it("rejects a property that is not allowlisted for the event", () => {
    const result = validateTelemetryEvent(
      telemetryEvent({
        name: "sample.page.viewed",
        properties: { respondentName: "Private Person" },
      }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "property not allowlisted",
    });
  });

  it("does not echo a content-bearing rejected property name", () => {
    const sensitiveName = "private_answer_notes_for_example_person";
    const result = validateTelemetryEvent(
      telemetryEvent({
        name: "sample.page.viewed",
        properties: { [sensitiveName]: "private content" },
      }),
    );

    expect(result).toEqual({ ok: false, reason: "property not allowlisted" });
    expect(JSON.stringify(result)).not.toContain(sensitiveName);
  });

  it("rejects event-specific property types", () => {
    expect(
      validateTelemetryEvent(
        telemetryEvent({
          name: "sample.export.completed",
          properties: { format: "json", respondentCount: "3" },
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "property respondentCount must be a number in [0, 10000000]",
    });
  });

  it("rejects a non-primitive property value", () => {
    const result = validateTelemetryEvent(
      telemetryEvent({ properties: { provider: { name: "openai" }, latencyMs: 250 } }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "property provider has non-primitive value",
    });
  });

  it("rejects a string property longer than 64 characters", () => {
    const result = validateTelemetryEvent(
      telemetryEvent({ properties: { provider: "x".repeat(65), latencyMs: 250 } }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "property provider exceeds 64 chars",
    });
  });

  it("rejects invalid timestamps and requires tenantId to be a string or null", () => {
    expect(
      validateTelemetryEvent(telemetryEvent({ occurredAt: "not-a-timestamp" })),
    ).toEqual({ ok: false, reason: "invalid timestamp" });
    expect(validateTelemetryEvent(telemetryEvent({ tenantId: 42 }))).toEqual({
      ok: false,
      reason: "invalid tenantId",
    });
    expect(validateTelemetryEvent(telemetryEvent({ tenantId: "tenant_test" })).ok).toBe(true);
    expect(validateTelemetryEvent(telemetryEvent({ tenantId: null })).ok).toBe(true);
  });

  it("accepts sample.import.rejected with a numeric errorCount", () => {
    const event = telemetryEvent({
      name: "sample.import.rejected",
      properties: { errorCount: 3 },
    });

    expect(validateTelemetryEvent(event)).toEqual({ ok: true, event });
  });

  it("rejects __proto__ as an unknown event name without throwing", () => {
    expect(validateTelemetryEvent(telemetryEvent({ name: "__proto__" }))).toEqual({
      ok: false,
      reason: "unknown event name",
    });
  });

  it("rejects constructor as an unknown event name without throwing", () => {
    expect(validateTelemetryEvent(telemetryEvent({ name: "constructor" }))).toEqual({
      ok: false,
      reason: "unknown event name",
    });
  });

  it.each([
    ["a string", "1200"],
    ["a negative number", -1],
    ["Infinity", Infinity],
    ["a number above the maximum", 10_000_001],
  ])("rejects latencyMs when it is %s", (_description, latencyMs) => {
    expect(
      validateTelemetryEvent(
        telemetryEvent({ properties: { provider: "openai", latencyMs } }),
      ),
    ).toEqual({
      ok: false,
      reason: "property latencyMs must be a number in [0, 10000000]",
    });
  });

  it("accepts latencyMs 1200 with a provider on sample.readout.completed", () => {
    const event = telemetryEvent({
      name: "sample.readout.completed",
      properties: { provider: "openai", latencyMs: 1200 },
    });

    expect(validateTelemetryEvent(event)).toEqual({ ok: true, event });
  });

  it("rejects a boolean respondentCount on sample.export.completed", () => {
    expect(
      validateTelemetryEvent(
        telemetryEvent({
          name: "sample.export.completed",
          properties: { format: "csv", respondentCount: true },
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "property respondentCount must be a number in [0, 10000000]",
    });
  });
  it("requires an explicit schema contribution for module events", () => {
    expect(validateEvent(telemetryEvent())).toEqual({ ok: false, reason: "unknown event name" });
    expect(validateEvent(telemetryEvent(), sampleSchemas).ok).toBe(true);
  });

});
