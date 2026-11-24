import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI pins every external action and uses the verified Node 24 artifact release", () => {
  const actions = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(match => match[1]);
  assert.ok(actions.length > 0);
  for (const action of actions) assert.match(action, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/u);
  for (const action of actions.filter(action => action.startsWith("actions/upload-artifact@"))) {
    // Official v7.0.0 tag verified with git ls-remote; action.yml uses node24.
    assert.equal(action, "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f");
  }
});

test("persona comparison is unconditional, uses the PR base, and uploads complete receipts", () => {
  const job = workflow.slice(workflow.indexOf("  a11y-ratchet:"), workflow.indexOf("  smtp-proof:"));
  assert.doesNotMatch(job, /continue-on-error|--candidate|--counts/gu);
  assert.doesNotMatch(job.split("    steps:")[0], /^ {4}if:/mu);
  assert.match(job, /fetch-depth: 0/u);
  assert.match(job, /A11Y_BASE_REF:.*github\.event\.pull_request\.base\.sha/u);
  assert.match(job, /run: node --test tooling\/e2e\/audit\/\*\.test\.mjs/u);
  assert.match(job, /run: pnpm a11y:scan\s/u);
  assert.match(job, /matrix\.json/u);
  assert.match(job, /comparison\.json/u);
  assert.match(job, /if-no-files-found: error/u);
});

test("the full authorized and denied persona matrix fails on any new violation", async () => {
  const inventoryPath = "../e2e/audit/inventory.mjs";
  const comparisonPath = "../e2e/audit/compare.mjs";
  const { CELLS, PERSONAS, VIEWPORTS, ROUTES } = await import(inventoryPath);
  const { baselineFor, compare } = await import(comparisonPath);
  assert.equal(CELLS.length, 702);
  assert.equal(PERSONAS.length, 6);
  assert.equal(VIEWPORTS.length, 3);
  assert.equal(ROUTES.length, 39);
  const records = CELLS.map(cell => ({ id: cell.id, tenant: "alpha", completed: true, status: cell.persona === "signed-out" ? 403 : 200, final: "/", kind: "product", violations: [] }));
  const baseline = baselineFor(records);
  assert.equal(compare(records, baseline).pass, true);
  for (const persona of PERSONAS) {
    const index = CELLS.findIndex(cell => cell.persona === persona);
    const changed = structuredClone(records);
    changed[index].violations.push({ rule: "color-contrast", impact: "minor", targets: [["#new-target"]] });
    assert.equal(compare(changed, baseline).pass, false, persona);
  }
  assert.throws(() => baselineFor(records.slice(1)), /Incomplete audit/u);
  const changed = structuredClone(records);
  changed[0].status = 200;
  assert.equal(compare(changed, baseline).pass, false);
});
