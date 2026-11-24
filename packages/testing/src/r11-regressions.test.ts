import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
type Entry = { status: "fixed" | "open"; reason?: string; tests?: Array<{ file: string; name: string }>; commits?: string[] };
const index = JSON.parse(readFileSync(resolve(root, "docs/reviews/r11-regressions.json"), "utf8")) as Record<string, Entry>;
const review = readFileSync(resolve(root, "docs/reviews/2026-11-11-full-review.md"), "utf8");
const findings = Array.from(new Set([...review.match(/R11-\d{2}/g) ?? [], "R11-16", "R11-17", "R11-18"])).sort();

describe("R11 named regression index", () => {
  it("maps all eighteen original and integration review findings", () => {
    expect(findings).toHaveLength(18);
    expect(Object.keys(index).sort()).toEqual(findings);
  });
  it("keeps worker schema creation in migrations", () => {
    expect(existsSync(resolve(root, "apps/platform/workflows/heartbeat.ts"))).toBe(false);
    const worker = readFileSync(resolve(root, "apps/platform/workflows/tenant-worker.ts"), "utf8");
    expect(worker).not.toMatch(/create\s+(?:table|schema)/i);
    expect(existsSync(resolve(root, "tooling/migrations/sql/control-plane/0040_worker_jobs.sql"))).toBe(true);
  });
  it.each(findings)("requires named regression evidence or an explicit open reason for %s", id => {
    const entry = index[id]!;
    expect(["fixed", "open"]).toContain(entry.status);
    if (entry.status === "open") {
      expect(entry.reason?.trim().length).toBeGreaterThan(10);
      return;
    }
    expect(entry.tests?.length).toBeGreaterThan(0);
    for (const test of entry.tests!) {
      expect(test.file).toMatch(/\.(test|spec)\.[cm]?[jt]sx?$/);
      expect(test.file.split("/")).not.toContain("..");
      const source = readFileSync(resolve(root, test.file), "utf8");
      // Match actual named it/test calls, including parameterized test templates.
      const escaped = test.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(source).toMatch(new RegExp(`(?:it|test)(?:\\.each\\([\\s\\S]*?\\))?\\(\\s*["'\x60]${escaped}["'\x60]`));
    }
  });
});
