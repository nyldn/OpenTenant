import { describe, expect, it } from "vitest";
import { createUsageMetricRegistry, validateExactUsageWindow } from "./usage";

describe("exact usage contracts", () => {
  it("registers a bounded server-owned metric catalogue and returns immutable definitions", () => {
    const registry = createUsageMetricRegistry([
      { metricId: "module.executions", unit: "execution", description: "Completed module executions" },
    ]);
    expect(registry.require("module.executions")).toEqual({
      metricId: "module.executions", unit: "execution", description: "Completed module executions",
    });
    expect(Object.isFrozen(registry.require("module.executions"))).toBe(true);
    expect(() => registry.require("request.supplied")).toThrow("unregistered usage metric");
  });

  it("rejects duplicate, malformed, and oversized metric definitions", () => {
    expect(() => createUsageMetricRegistry([
      { metricId: "module.executions", unit: "execution", description: "One" },
      { metricId: "module.executions", unit: "execution", description: "Two" },
    ])).toThrow();
    expect(() => createUsageMetricRegistry([{ metricId: "UPPER", unit: "x", description: "x" }])).toThrow();
    expect(() => createUsageMetricRegistry(Array.from({ length: 65 }, (_, index) => ({
      metricId: `metric.${index}`, unit: "unit", description: "description",
    })))).toThrow();
  });

  it("requires a bounded half-open aggregate window", () => {
    expect(validateExactUsageWindow({ start: "2026-08-01T00:00:00.000Z", end: "2026-08-02T00:00:00.000Z" }))
      .toEqual({ start: "2026-08-01T00:00:00.000Z", end: "2026-08-02T00:00:00.000Z" });
    expect(() => validateExactUsageWindow({ start: "2026-08-02T00:00:00.000Z", end: "2026-08-02T00:00:00.000Z" })).toThrow();
    expect(() => validateExactUsageWindow({ start: "2026-01-01T00:00:00.000Z", end: "2026-08-02T00:00:00.000Z" })).toThrow();
  });
});
