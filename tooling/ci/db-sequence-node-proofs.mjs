import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// These proofs must own fresh Docker clusters, rather than share a suite URL.
export const NODE_DATABASE_PROOFS = [
  { file: "tooling/unattended/src/postgres-proof.integration.mjs", tests: 2 },
  { file: "tooling/db-ephemeral/lifecycle.integration.mjs", tests: 2 },
];

/** @param {string} output @param {number} expected */
export function validateNodeProof(output, expected) {
  const counts = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  if (counts.tests !== expected || counts.pass !== expected
    || ["fail", "cancelled", "skipped", "todo"].some(key => counts[key] !== 0)) {
    throw new Error("Database harness proof requires exact cases and zero failures/skips/todos");
  }
  return counts;
}

function main() {
  const root = resolve(import.meta.dirname, "../..");
  const directory = resolve(process.env.DATABASE_STORE_REPORT_DIRECTORY ?? "artifacts/database-store-tests");
  mkdirSync(directory, { recursive: true });
  const summary = [];
  for (const proof of NODE_DATABASE_PROOFS) {
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", proof.file], { cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Database harness proof failed: ${proof.file}`);
    const counts = validateNodeProof(result.stdout, proof.tests);
    summary.push({ file: proof.file, ...counts });
    console.log(`Database harness ${proof.file}: ${proof.tests} passed, 0 skipped`);
  }
  writeFileSync(resolve(directory, "database-harness.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Database harness proof failed"); process.exitCode = 1; }
}
