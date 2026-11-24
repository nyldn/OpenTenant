import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSequenceReport } from "./db-sequence.mjs";

export const SMTP_PROOFS = [
  { id: "smtp-transport", filter: "notifications", file: "src/mailpit.integration.test.ts", suites: 1, tests: 1, database: false },
  { id: "smtp-application", filter: "testing", file: "src/smtp.integration.test.ts", suites: 2, tests: 3, database: true },
];

function main() {
  if (process.env.MAILPIT_REQUIRED !== "1") throw new Error("SMTP proof requires MAILPIT_REQUIRED=1");
  const root = resolve(import.meta.dirname, "../..");
  const directory = resolve(process.env.DATABASE_STORE_REPORT_DIRECTORY ?? "artifacts/database-store-tests");
  mkdirSync(directory, { recursive: true });
  const summary = [];
  for (const proof of SMTP_PROOFS) {
    const report = resolve(directory, `${proof.id}.json`);
    rmSync(report, { force: true });
    const args = ["--filter", `@opentenant/${proof.filter}`, "exec", "vitest", "run", proof.file, "--hookTimeout=120000", "--testTimeout=120000", "--reporter=default", "--reporter=json", `--outputFile=${report}`];
    const result = spawnSync("pnpm", proof.database ? ["db:ephemeral", "--", "pnpm", ...args] : args, { cwd: root, stdio: "inherit", timeout: 600_000 });
    if (result.error || result.status !== 0) throw new Error(`SMTP proof failed: ${proof.id}`);
    const counts = validateSequenceReport(JSON.parse(readFileSync(report, "utf8")), { suites: proof.suites, files: { [`packages/${proof.filter}/${proof.file}`]: proof.tests } });
    summary.push({ id: proof.id, ...counts });
    console.log(`SMTP ${proof.id}: ${counts.tests} passed, 0 skipped`);
  }
  writeFileSync(resolve(directory, "smtp-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "SMTP proof failed"); process.exitCode = 1; }
}
