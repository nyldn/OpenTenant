import assert from "node:assert/strict";
import { test } from "node:test";
import { CELLS } from "./inventory.mjs";
import { baselineFor, compare } from "./compare.mjs";
const records = () => CELLS.map(c => ({ id: c.id, tenant: "alpha", completed: true, status: 200, final: "/", kind: "product", violations: [] }));
test("comparison rejects missing, duplicate, unexecuted and unexpected cells", () => {
  const rows = records(); assert.throws(() => baselineFor(rows.slice(1)));
  assert.throws(() => baselineFor([...rows, rows[0]]));
  assert.throws(() => baselineFor(rows.map((r,i) => i ? r : { ...r, completed: false })));
  assert.throws(() => baselineFor(rows.map((r,i) => i ? r : { ...r, id: "unknown" })));
});
test("new targets, worse impact/count and stale fixed entries fail; disposable IDs remain stable", () => {
  const rows = records(); rows[0].violations = [{ rule: "color-contrast", impact: "serious", targets: [["#ticket-12345678-abcd-4abc-8def-123456789abc"]] }];
  const baseline = baselineFor(rows); assert.equal(compare(rows, baseline).pass, true);
  rows[0].violations[0].targets[0] = ["#ticket-87654321-abcd-4abc-8def-123456789abc"];
  assert.equal(compare(rows, baseline).pass, true);
  rows[0].violations[0].impact = "critical"; assert.equal(compare(rows, baseline).pass, false);
  rows[0].violations[0].impact = "serious"; rows[0].violations[0].targets.push(["new-target"]);
  assert.equal(compare(rows, baseline).pass, false);
  rows[0].violations = []; assert.match(compare(rows, baseline).errors.join(), /Remove fixed/);
  rows[0].status = 403; assert.match(compare(rows, baseline).errors.join(), /Authorization/);
});
test("source edits cannot increase the reviewed baseline", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  const empty = baselineFor(records()), rows = records();
  rows[0].violations = [{ rule: "color-contrast", impact: "serious", targets: [["new"]] }];
  const larger = baselineFor(rows);
  assert.throws(() => assertBaselineShrinks(empty, larger), /only shrink|Unknown baseline/);
  assert.doesNotThrow(() => assertBaselineShrinks(larger, empty));
});

const moveFixture = () => {
  const rows = records();
  rows[0].violations = [{ rule: "color-contrast", impact: "serious", targets: [["main>p"]] }];
  const previous = baselineFor(rows), next = structuredClone(previous);
  next.violations[0].target = ["div>main>p"];
  const value = previous.violations[0];
  const manifest = { targets: [{ cell: value.cell, tenant: value.tenant, rule: value.rule,
    old: value.target, new: next.violations[0].target, reason: "Same paragraph within the host shell." }], headings: [] };
  return { previous, next, manifest };
};
test("reviewed target moves preserve identity, severity and count", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  const { previous, next, manifest } = moveFixture();
  assert.doesNotThrow(() => assertBaselineShrinks(previous, next, [manifest]));
  assert.throws(() => assertBaselineShrinks(previous, next, []), /only shrink/);
  next.violations[0].count = 2;
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest]), /only shrink/);
  next.violations[0].count = 1; next.violations[0].impact = "critical";
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest]), /only shrink/);
});
test("rejects duplicate, unused, wrong-cell, wrong-rule and unknown-target mappings", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  for (const patch of [{ old: ["unknown"] }, { new: ["unknown"] }, { cell: CELLS[1].id }, { cell: "unknown" }, { rule: "unknown" }, { reason: "" }]) {
    const { previous, next, manifest } = moveFixture();
    Object.assign(manifest.targets[0], patch);
    assert.throws(() => assertBaselineShrinks(previous, next, [manifest]));
  }
  const { previous, next, manifest } = moveFixture();
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest, manifest]), /Duplicate/);
  assert.throws(() => assertBaselineShrinks(previous, previous, [manifest]), /unused/);
  next.violations.push({ ...next.violations[0], target: ["another"], count: 1 });
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest]));
});
test("reviews only intentional heading changes while preserving document authorization", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  const previous = baselineFor(records()), next = structuredClone(previous);
  next.cells[0].headings = ["Workspace"];
  const manifest = { targets: [], headings: [{ cell: next.cells[0].id, old: [], new: ["Workspace"], reason: "Add the signed-out page heading." }] };
  assert.doesNotThrow(() => assertBaselineShrinks(previous, next, [manifest]));
  assert.throws(() => assertBaselineShrinks(previous, next, []), /Unreviewed/);
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest, manifest]), /Duplicate/);
  assert.throws(() => assertBaselineShrinks(previous, previous, [manifest]), /unused/);
  next.cells[0].status = 403;
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest]), /Unreviewed/);
});
test("reviews document moves of final path and heading but never authorization fields", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  const previous = baselineFor(records()), next = structuredClone(previous);
  next.cells[0].final = "/auth/login";
  next.cells[0].headings = ["Sign in"];
  const move = { cell: next.cells[0].id, old: { final: "/", headings: [] }, new: { final: "/auth/login", headings: ["Sign in"] }, reason: "Login moved to the host page." };
  const manifest = { targets: [], headings: [], documents: [move] };
  assert.doesNotThrow(() => assertBaselineShrinks(previous, next, [manifest]));
  assert.throws(() => assertBaselineShrinks(previous, next, []), /Unreviewed/);
  assert.throws(() => assertBaselineShrinks(previous, previous, [manifest]), /unused/);
  assert.throws(() => assertBaselineShrinks(previous, next, [manifest, manifest]), /Duplicate/);
  assert.throws(() => assertBaselineShrinks(previous, next, [{ documents: [{ ...move, reason: " " }] }]), /unused/);
  const headingOnly = { headings: [{ cell: move.cell, old: [], new: ["Sign in"], reason: "Heading." }] };
  assert.throws(() => assertBaselineShrinks(previous, next, [headingOnly]), /Unreviewed/);
  assert.throws(() => assertBaselineShrinks(previous, next, [headingOnly, manifest]), /Duplicate/);
  const denied = structuredClone(next); denied.cells[0].status = 403;
  assert.throws(() => assertBaselineShrinks(previous, denied, [manifest]), /Unreviewed/);
  const statusMove = { documents: [{ cell: move.cell, old: { status: 200 }, new: { status: 403 }, reason: "Deny." }] };
  const onlyStatus = structuredClone(previous); onlyStatus.cells[0].status = 403;
  assert.throws(() => assertBaselineShrinks(previous, onlyStatus, [statusMove]), /unused/);
});
test("rejects unknown cells/rules and duplicate violation entries", async () => {
  const { assertBaselineShrinks } = await import("./compare.mjs");
  const { previous } = moveFixture();
  for (const mutate of [b => b.cells[0].id = "unknown", b => b.violations[0].rule = "unknown", b => b.violations[0].cell = "unknown", b => b.violations.push(b.violations[0])]) {
    const next = structuredClone(previous); mutate(next);
    assert.throws(() => assertBaselineShrinks(previous, next, []));
  }
});

test("loads every working and committed remap, including historical removals and unused mappings", async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { execFileSync } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "f2-remap-test-"));
  const audit = join(directory, "tooling/e2e/audit");
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    await mkdir(audit, { recursive: true });
    for (const file of ["compare.mjs", "inventory.mjs"]) await copyFile(new URL(file, import.meta.url), join(audit, file));
    const { previous, next, manifest } = moveFixture();
    previous.violations.push({ ...previous.violations[0], cell: CELLS[1].id });
    next.violations.push({ ...next.violations[0], cell: CELLS[1].id });
    const second = { targets: [{ ...manifest.targets[0], cell: CELLS[1].id }], headings: [] };
    await writeFile(join(audit, "baseline.json"), JSON.stringify(previous));
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
    git("add", "."); git("commit", "-qm", "fixture baseline");
    await writeFile(join(audit, "baseline.json"), JSON.stringify(next));
    await writeFile(join(audit, "remap-fixture.json"), JSON.stringify(manifest));
    await writeFile(join(audit, "remap-second.json"), JSON.stringify(second));
    const { assertBaselineShrinks } = await import(pathToFileURL(join(audit, "compare.mjs")));
    assert.doesNotThrow(() => assertBaselineShrinks(previous, next));
    git("add", "."); git("commit", "-qm", "review same-element move");
    assert.doesNotThrow(() => assertBaselineShrinks(previous, next));
    assert.doesNotThrow(() => assertBaselineShrinks(next, next));
    assert.doesNotThrow(() => assertBaselineShrinks(previous, { ...next, violations: [] }));
    await writeFile(join(audit, "remap-unused.json"), JSON.stringify(manifest));
    assert.throws(() => assertBaselineShrinks(previous, next), /Duplicate/);
    git("add", "."); git("commit", "-qm", "unused mapping");
    assert.throws(() => assertBaselineShrinks(next, next), /unused/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
