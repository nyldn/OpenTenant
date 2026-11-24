import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ write: (line: string) => { lines.push(line); } }) };
}

describe("content-free logger", () => {
  it("keeps only typed operational values and drops secret-bearing objects", () => {
    const { lines, logger } = capture();
    logger.info({ event: "request.completed", statusCode: 200, durationMs: 12, body: "private", cookie: "private", authorization: "private", connectionString: "private", error: new Error("private"), tenantId: "private", traceId: "forged", eventExtra: "private" });
    const row = JSON.parse(lines[0]!);
    expect(row).toMatchObject({ event: "request.completed", statusCode: 200, durationMs: 12 });
    expect(lines.join("")).not.toContain("private");
    expect(lines.join("")).not.toContain("forged");
  });

  it("rejects arbitrary strings even on allowlisted fields and accepts no free text message", () => {
    const { lines, logger } = capture();
    logger.error({ event: "postgres://secret@example.test", statusCode: "private", durationMs: Infinity, traceId: "a".repeat(32) });
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("event");
    expect(lines.join("")).not.toContain("secret");
    expect(lines.join("")).not.toContain("private");
  });
});


it("injects the active trace ID and ignores a caller-supplied ID", () => {
  const traceId = "a".repeat(32);
  const active = vi.spyOn(trace, "getActiveSpan").mockReturnValue(trace.wrapSpanContext({ traceId, spanId: "b".repeat(16), traceFlags: 1 }));
  const { logger, lines } = capture();
  logger.info({ event: "request.completed", traceId: "forged" });
  expect(JSON.parse(lines[0]!).traceId).toBe(traceId);
  active.mockRestore();
});
