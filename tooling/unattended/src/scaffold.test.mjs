import assert from "node:assert/strict";
import test from "node:test";

import { scaffoldTask } from "./scaffold.mjs";
import { validateBacklog } from "./backlog.mjs";
import { proposeTask } from "./proposal.mjs";

const minimal = {
  id: "FEAT-01",
  title: "Add a thing",
  objective: "Add the thing users keep asking for.",
  source: "docs/plans/example.md",
  allowedPaths: ["packages/platform-core/src"],
};

test("four fields and a path produce a task the backlog accepts", () => {
  const draft = scaffoldTask(minimal);
  const backlog = proposeTask(
    { version: 1, updatedAt: "2026-08-02T00:00:00Z", tasks: [] },
    draft,
    "2026-08-02T01:00:00Z",
  );
  assert.equal(validateBacklog(backlog).tasks[0]?.id, "FEAT-01");
});

test("an owner lane is refused outright, not quietly downgraded", () => {
  assert.throws(() => scaffoldTask({ ...minimal, lane: "owner" }), /lane must be/);
});

test("owner gates and pre-set statuses are ignored, whatever the caller asks for", () => {
  const draft = scaffoldTask({ ...minimal, ownerGate: true, status: "completed" });
  assert.equal(draft.ownerGate, false);
  assert.equal(draft.status, "pending");
});

test("an unusable id is refused rather than normalised", () => {
  for (const id of ["feat-01", "FEAT", "FEAT_01", "1-FEAT"]) {
    assert.throws(() => scaffoldTask({ ...minimal, id }), /must look like AREA-01/);
  }
});

test("there is no default path scope, because the widest one is the only candidate", () => {
  assert.throws(() => scaffoldTask({ ...minimal, allowedPaths: [] }), /no safe default/);
  assert.throws(() => scaffoldTask({ ...minimal, allowedPaths: undefined }), /no safe default/);
});

test("priority lands behind existing work rather than ahead of it", () => {
  assert.equal(scaffoldTask(minimal).priority, 100);
  assert.equal(scaffoldTask(minimal, { existingPriorities: [100, 930] }).priority, 940);
  assert.equal(scaffoldTask({ ...minimal, priority: 5 }).priority, 5);
});

test("the placeholder criterion is unsatisfiable, so it cannot be left in by accident", () => {
  const draft = scaffoldTask(minimal);
  assert.match(String(draft.acceptanceCriteria[0]), /^REPLACE ME/);
  assert.ok(String(draft.acceptanceCriteria[0]).includes(minimal.objective));
});

test("supplied criteria and verification win over the defaults", () => {
  const draft = scaffoldTask({
    ...minimal,
    acceptanceCriteria: ["The endpoint returns 404 for an unknown tenant."],
    verification: [["pnpm", "--filter", "@opentenant/platform-core", "test"]],
  });
  assert.deepEqual(draft.acceptanceCriteria, ["The endpoint returns 404 for an unknown tenant."]);
  assert.deepEqual(draft.verification, [["pnpm", "--filter", "@opentenant/platform-core", "test"]]);
});

test("missing prose is refused rather than invented", () => {
  for (const field of ["title", "objective", "source"]) {
    assert.throws(() => scaffoldTask({ ...minimal, [field]: "  " }), new RegExp(`${field} must be`));
  }
});
