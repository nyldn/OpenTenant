import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps same-origin paths with query and fragment", () => {
    expect(safeReturnPath("/settings/members?tab=invites#top")).toBe("/settings/members?tab=invites#top");
    expect(safeReturnPath("/m/assessment")).toBe("/m/assessment");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example/",
    "evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example".replace("%5C", "\\"),
    "/\t/evil.example",
    "/\n/evil.example",
    "/.//evil.example",
    `/${"a".repeat(2048)}`,
  ])("collapses %j to the root", (raw) => {
    expect(safeReturnPath(raw)).toBe("/");
  });

  it("normalises dot segments without leaving the origin", () => {
    expect(safeReturnPath("/a/../settings")).toBe("/settings");
  });
});
