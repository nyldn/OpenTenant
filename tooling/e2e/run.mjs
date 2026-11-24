import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep the original local-identity journeys intact. The production identity
// journeys use a separate server/database, so sessions and fixtures cannot leak.
const phases = ["legacy", "journeys", "reset", ...(process.argv.includes("--list") ? ["audit"] : [])];
let child;
let interrupted = false;
const forward = signal => { interrupted = true; if (child?.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } } };
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
const reports = [];
const listing = process.argv.slice(2).includes("--list");
for (const phase of phases) {
  if (interrupted) { process.exitCode = 1; break; }
  child = ["reset", "audit"].includes(phase) ? spawn("pnpm", ["exec", "playwright", "test", "--pass-with-no-tests", ...process.argv.slice(2)], { cwd: import.meta.dirname, env: { ...process.env, E2E_PHASE: phase, E2E_FILTERED: process.argv.length > 2 && !listing ? "1" : "0", A11Y_LIST_ALL: listing ? "1" : "0", E2E_APP_PORT: "39999", LOCAL_PUBLIC_ORIGIN: "http://localhost:39999" }, stdio: "inherit", detached: true }) : spawn(process.execPath, [join(import.meta.dirname, "run-phase.mjs"), ...process.argv.slice(2)], {
    env: { ...process.env, E2E_PHASE: phase, E2E_FILTERED: process.argv.length > 2 && !listing ? "1" : "0" }, stdio: "inherit", detached: true,
  });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  if (listing) {
    if (code !== 0) { process.exitCode = 1; break; }
    continue;
  }
  const report = JSON.parse(await readFile(join(import.meta.dirname, "test-results", phase, "results.json"), "utf8"));
  reports.push({ phase, stats: report.stats, suites: report.suites });
  if (code !== 0) { process.exitCode = 1; break; }
}
if (listing) {
  console.log("E2E listing complete; no tests executed.");
} else {
await mkdir(join(import.meta.dirname, "test-results"), { recursive: true });
await writeFile(join(import.meta.dirname, "test-results", "summary.json"), JSON.stringify(reports, null, 2));
const total = key => reports.reduce((count, report) => count + report.stats[key], 0);
console.log(`E2E total: ${total("expected")} passed, ${total("unexpected")} failed, ${total("skipped")} skipped across ${reports.length} phases.`);
if (total("unexpected") || total("skipped") || !total("expected")) process.exitCode = 1;

}

if (!listing && !process.exitCode && process.argv.length === 2 && !process.env.CI) {
  child = spawn("pnpm", ["a11y:scan"], { cwd: join(import.meta.dirname, "../.."), stdio: "inherit", detached: true });
  process.exitCode = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
}
