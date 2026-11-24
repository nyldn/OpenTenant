import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { environmentReadExceptions } from "../config/environment-policy.mjs";
import { repositoryRoot, sourceInventory, inspectEnvironment } from "./runtime-env-inventory.mjs";

test("all repository environment access stays within reviewed per-file ceilings", () => {
  const budgets = new Map(environmentReadExceptions.map(entry => [entry.path, entry]));
  assert.equal(budgets.size, environmentReadExceptions.length);
  const paths = sourceInventory();
  for (const entry of environmentReadExceptions) {
    assert.equal(typeof entry.path, "string");
    assert.equal(typeof entry.maxReads, "number");
    assert.ok(entry.reason.length > 40);
    assert.equal(inspectEnvironment(entry.path).environmentReads, entry.maxReads, `lower the reviewed ceiling after removing a read: ${entry.path}`);
    assert.ok(paths.includes(String(entry.path)), `remove stale exception: ${entry.path}`);
  }
  for (const path of paths) {
    const { environmentReads } = inspectEnvironment(path);
    const budget = budgets.get(path);
    assert.ok(environmentReads <= Number(budget?.maxReads ?? 0), `${path}: ${environmentReads} environment accesses exceed reviewed ceiling ${budget?.maxReads ?? 0}`);
  }
});

test("AST inventory ignores comments and quoted probes but counts aliases and computed access", () => {
  assert.equal(inspectEnvironment("fixture.ts", '// process.env.KEY\nconst probe = "process.env.KEY";').environmentReads, 0);
  assert.equal(inspectEnvironment("fixture.ts", 'const { KEY } = process["env"]; const env = process.env; const copy = { ...process.env };').environmentReads, 3);
});

test("the only runtime exception reads exactly the two literal Next selectors", () => {
  const source = readFileSync(`${repositoryRoot}/apps/platform/instrumentation.ts`, "utf8");
  assert.equal(inspectEnvironment("instrumentation.ts", source).environmentReads, 2);
  assert.equal(source.match(/process\.env\.NEXT_RUNTIME/gu)?.length, 2);
});

test("reviewed environment exceptions can only shrink against the CI base", async () => {
  const { execFileSync } = await import("node:child_process");
  const { environmentBudgetSnapshot } = await import("./runtime-env-inventory.mjs");
  const requested = process.env.ENV_INVENTORY_BASE_REF;
  if (!requested || /^0{40}$/u.test(requested)) return;
  assert.match(requested, /^[a-f0-9]{40}$/u);
  const previous = execFileSync("git", ["show", `${requested}:tooling/config/environment-policy.mjs`], { cwd: repositoryRoot, encoding: "utf8" });
  const budgets = environmentBudgetSnapshot(previous);
  // The first adoption has no prior budget. Every following PR/push is bounded.
  if (budgets.size === 0) return;
  for (const entry of environmentReadExceptions) {
    assert.ok(budgets.has(entry.path), `new environment exception: ${entry.path}`);
    assert.ok(entry.maxReads <= budgets.get(entry.path), `increased environment ceiling: ${entry.path}`);
  }
});

test("previous-budget discovery cannot silently ignore a changed representation", async () => {
  const { environmentBudgetSnapshot } = await import("./runtime-env-inventory.mjs");
  assert.deepEqual([...environmentBudgetSnapshot('export const environmentReadExceptions = [...Object.entries({"fixture.mjs": 2}).map(([path, maxReads]) => ({path, maxReads}))];')], [["fixture.mjs", 2]]);
  assert.throws(() => environmentBudgetSnapshot("export const environmentReadExceptions = [];"), /Cannot parse/u);
});
