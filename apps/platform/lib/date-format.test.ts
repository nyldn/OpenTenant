import { describe, expect, it } from "vitest";
import { formatUtcDate, formatUtcDateTime } from "./date-format";

describe("support date formatting", () => {
  const date = new Date("2026-09-11T15:04:00.000Z");

  it("formats dates as readable UTC dates", () => {
    expect(formatUtcDate(date)).toBe("Sep 11, 2026");
    expect(formatUtcDateTime(date)).toContain("Sep 11, 2026");
    expect(formatUtcDateTime(date)).toContain("UTC");
  });

  it("handles invalid dates without rendering Invalid Date", () => {
    expect(formatUtcDate(new Date("invalid"))).toBe("Unknown date");
    expect(formatUtcDateTime(new Date("invalid"))).toBe("Unknown date");
  });
});
