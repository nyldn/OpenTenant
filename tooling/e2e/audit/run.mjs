import { spawn, execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startTestStack } from "../../uat/test-stack.mjs";
import { BATCH_COUNT, SCHEMA_VERSION } from "./inventory.mjs";
import { assertBaselineShrinks, baselineFor, compare, summarize, validateCells } from "./compare.mjs";
const root = resolve(import.meta.dirname, "../../..");
const output = join(root, "tooling/e2e/test-results/a11y");
const candidate = process.argv.includes("--candidate");
if (process.argv.some(a => a.startsWith("--") && !["--candidate", "--counts"].includes(a))) throw new Error("Usage: pnpm a11y:scan [--counts|--candidate]");
await mkdir(output, { recursive: true });
await Promise.all(["comparison.json", "baseline-candidate.json"].map(name => rm(join(output, name), { force: true })));
await writeFile(join(output, "matrix.json"), JSON.stringify({ version: SCHEMA_VERSION, completed: false, records: [], timings: [] }, null, 2));
let stack, child, interrupted = false;
const stop = () => { interrupted = true; if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; } } };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
if (!candidate) {
  const requestedRef = process.env.A11Y_BASE_REF || "HEAD";
  const ref = /^0{40}$/.test(requestedRef) ? "HEAD" : requestedRef;
  if (!/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith("-")) throw new Error("Invalid baseline comparison ref");
  execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, stdio: "ignore" });
  const files = execFileSync("git", ["ls-tree", "--name-only", ref, "tooling/e2e/audit/baseline.json"], { cwd: root, encoding: "utf8" });
  if (files.trim()) {
    const previous = JSON.parse(execFileSync("git", ["show", `${ref}:tooling/e2e/audit/baseline.json`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
    const next = JSON.parse(await readFile(join(import.meta.dirname, "baseline.json"), "utf8"));
    assertBaselineShrinks(previous, next);
  }
}
const records = [], timings = [];
try {
  for (let batch = 0; batch < BATCH_COUNT; batch++) {
    if (interrupted) throw new Error("Audit interrupted");
    const path = join(output, `batch-${batch}.jsonl`);
    await writeFile(path, "");
    const start = Date.now();
    stack = await startTestStack(join(root, ".uat", `audit-${batch}.log`), { audit: true });
    child = spawn("pnpm", ["exec", "playwright", "test"], { cwd: join(root, "tooling/e2e"), stdio: "inherit", detached: true, env: { ...process.env, E2E_PHASE: "audit", E2E_APP_PORT: String(stack.manifest.ports.app), LOCAL_PUBLIC_ORIGIN: `http://workspace.localhost:${stack.manifest.ports.app}`, A11Y_CANDIDATE: candidate ? "1" : "0", A11Y_BATCH: String(batch), A11Y_OUTPUT: path } });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    await stack.dispose(); stack = undefined;
    records.push(...(await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
    timings.push({ batch, elapsedMs: Date.now()-start, ...JSON.parse(await readFile(join(root, ".uat/last-metrics.json"), "utf8")) });
    await writeFile(join(output, "matrix.json"), JSON.stringify({ version: SCHEMA_VERSION, records, timings, completed: false }, null, 2));
    if (code !== 0) throw new Error(`Audit batch ${batch} failed; no cells omitted or retried`);
  }
  validateCells(records);
  await writeFile(join(output, "matrix.json"), JSON.stringify({ version: SCHEMA_VERSION, completed: true, environment: { node: process.version, cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, hostMemoryBytes: totalmem(), mode: "dev", axePlaywright: "4.11.0", axeCore: "4.11.4", head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), workingTreeChanged: Boolean(execFileSync("git", ["status", "--porcelain", "--", ".", ":(exclude)graphify-out"], { cwd: root, encoding: "utf8" }).trim()) }, records, timings }, null, 2));
  console.log(JSON.stringify(summarize(records), null, 2));
  if (candidate) {
    // Deliberately never overwrite the reviewed baseline. Initial review and
    // removals are explicit source edits, with a normal git diff.
    await writeFile(join(output, "baseline-candidate.json"), JSON.stringify(baselineFor(records), null, 2) + "\n");
    console.log("Candidate only. Review test-results/a11y/baseline-candidate.json; no baseline changed.");
  } else {
    const baseline = JSON.parse(await readFile(join(import.meta.dirname, "baseline.json"), "utf8"));
    const result = compare(records, baseline);
    await writeFile(join(output, "comparison.json"), JSON.stringify(result, null, 2));
    if (!result.pass) throw new Error(`Accessibility comparison failed (${result.errors.length} differences); inspect test-results/a11y/comparison.json`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await stack?.dispose(); }
