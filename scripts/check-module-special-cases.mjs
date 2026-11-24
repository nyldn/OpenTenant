import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const pattern = /assessment|ASSESSMENT_MANIFEST|"support"|"brain"/u;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "apps/platform", "packages"], { encoding: "utf8" }).trim().split("\n");
const matches = [], exclusions = [];
for (const file of new Set(files)) {
  if (file === "apps/platform/opentenant-modules.ts") continue;
  if (file.startsWith("packages/") && (!/^packages\/[^/]+\/src\/.*\.(?:js|mjs|ts|tsx)$/u.test(file)
    || /\.(?:test|spec)\./u.test(file))) continue;
  let lines;
  try { lines = readFileSync(file, "utf8").split("\n"); } catch { continue; }
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    const entry = `${file}:${index + 1}:${line}`;
    // Composition dependencies are package metadata, not dispatch or policy.
    // The composition file documents this single metadata exclusion.
    if ((file === "apps/platform/package.json" && line.includes('"@opentenant/assessment":')) || lines[index - 1]?.includes("module-audit-exclude:")) exclusions.push(entry);
    else matches.push(entry);
  });
}
console.log(JSON.stringify({ specialCases: matches.length, exclusions, matches }, null, 2));
assert.equal(matches.length, 0, "Move module-specific behavior into manifest contributions");
