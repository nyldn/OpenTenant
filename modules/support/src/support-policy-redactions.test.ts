import { describe, expect, it } from "vitest";
import { applyRedactions } from "./support-ai-policy";

describe("applyRedactions", () => {
  const body = "Card 4111111111111111 exp 12/29 cvv 123 thanks.";

  it("removes every character covered by nested ranges", () => {
    const redacted = applyRedactions(body, [
      { start: 5, end: 7, reason: "pan" },
      { start: 0, end: 39, reason: "pan" },
    ]);

    expect(redacted).toBe("[REDACTED] thanks.");
    expect(redacted).not.toContain("123");
  });

  it("merges overlapping ranges and keeps disjoint ones separate", () => {
    expect(applyRedactions(body, [
      { start: 5, end: 12, reason: "pan" },
      { start: 10, end: 21, reason: "pan" },
      { start: 36, end: 39, reason: "pan" },
    ])).toBe("Card [REDACTED] exp 12/29 cvv [REDACTED] thanks.");
  });

  it("leaves the body unchanged without redactions", () => {
    expect(applyRedactions(body, [])).toBe(body);
  });
});
