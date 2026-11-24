import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  evaluateBacklogTransition,
  selectNextTask,
  selectNextSupervisedTask,
  selectVerificationTask,
  validateBacklog,
} from "./backlog.mjs";

/**
 * @param {Partial<import("./backlog.mjs").UnattendedTask>} overrides
 * @returns {import("./backlog.mjs").UnattendedTask}
 */
function task(overrides = {}) {
  return {
    id: "OPS-01",
    priority: 10,
    title: "Owner terminology",
    lane: "spec",
    status: "pending",
    objective: "Introduce installation-owner contracts.",
    source: "docs/architecture/multi-tenant-operations.md#18-delivery-sequence",
    acceptanceCriteria: ["Existing tenant behavior remains covered."],
    dependencies: [],
    ownerGate: false,
    allowedPaths: ["packages/auth/", "docs/"],
    timeoutMinutes: 60,
    verification: [["pnpm", "--filter", "@opentenant/platform", "test"]],
    ...overrides,
  };
}

/** @param {import("./backlog.mjs").UnattendedTask[]} tasks */
function backlog(tasks) {
  return { version: 1, updatedAt: "2026-07-21", tasks };
}

test("rejects malformed and duplicate task definitions", () => {
  assert.throws(
    () => validateBacklog(backlog([task(), task()])),
    /duplicate task id OPS-01/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ verification: [["bash", "-lc", "pnpm test"]] })])),
    /unsupported verification executable bash/,
  );
});

test("selects the lowest-priority ready local task", () => {
  const selected = selectNextTask(
    backlog([
      task({ id: "OPS-03", priority: 30, dependencies: ["OPS-01"] }),
      task({ id: "OPS-02", priority: 20 }),
      task({ id: "OPS-01", priority: 10, status: "completed" }),
    ]),
  );

  assert.equal(selected?.id, "OPS-02");
});

test("never selects owner-gated work or work with incomplete dependencies", () => {
  const selected = selectNextTask(
    backlog([
      task({ id: "OPS-01", priority: 10, ownerGate: true }),
      task({ id: "OPS-02", priority: 20, dependencies: ["OPS-03"] }),
      task({ id: "OPS-03", priority: 30, status: "blocked" }),
    ]),
  );

  assert.equal(selected, undefined);
});

test("never selects supervised work for unattended execution", () => {
  const value = backlog([
    task({
      id: "SELF-01",
      executionMode: "supervised",
      allowedPaths: ["tooling/unattended/src/runner.mjs"],
    }),
    task({ id: "AFTER-01", priority: 20, dependencies: ["SELF-01"] }),
  ]);

  assert.equal(selectNextTask(value), undefined);
  assert.equal(selectNextSupervisedTask(value)?.id, "SELF-01");
  const supervisedTask = value.tasks[0];
  assert.ok(supervisedTask);
  supervisedTask.status = "not_verified";
  assert.equal(selectNextSupervisedTask(value), undefined);
  assert.equal(selectVerificationTask(value), undefined);
});

test("resumes independent verification before selecting new work", () => {
  const value = backlog([
    task({ id: "OPS-01", status: "not_verified" }),
    task({ id: "OPS-02", priority: 20 }),
  ]);
  assert.equal(selectVerificationTask(value)?.id, "OPS-01");
  assert.equal(selectNextTask(value)?.id, "OPS-02");
});

test("rejects unknown dependency identifiers", () => {
  assert.throws(
    () => validateBacklog(backlog([task({ dependencies: ["MISSING"] })])),
    /unknown dependency MISSING/,
  );
});

test("rejects unsafe path scopes and unbounded timeouts", () => {
  assert.throws(
    () => validateBacklog(backlog([task({ allowedPaths: ["../outside"] })])),
    /unsafe allowed path/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ allowedPaths: [".env"] })])),
    /secret-bearing path/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ allowedPaths: ["tooling/unattended/src/"] })])),
    /controller-protected path/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ allowedPaths: ["tooling/ci/"] })])),
    /controller-protected path/,
  );
  assert.doesNotThrow(
    () => validateBacklog(backlog([task({ allowedPaths: ["tooling/unattended/verifiers/"] })])),
  );
  assert.doesNotThrow(
    () => validateBacklog(backlog([task({
      executionMode: "supervised",
      allowedPaths: ["tooling/unattended/src/runner.mjs", "tooling/ci/"],
    })])),
  );
  assert.throws(
    () => validateBacklog(backlog([task({
      executionMode: /** @type {any} */ ("automatic"),
    })])),
    /invalid executionMode/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ timeoutMinutes: 121 })])),
    /timeoutMinutes must be between 5 and 120/,
  );
});

test("bounds trusted premise verification to a prefix of verification commands", () => {
  assert.doesNotThrow(() => validateBacklog(backlog([
    task({ premiseVerificationCount: 1 }),
  ])));
  assert.throws(
    () => validateBacklog(backlog([task({ premiseVerificationCount: -1 })])),
    /premiseVerificationCount must be between 0 and 1/,
  );
  assert.throws(
    () => validateBacklog(backlog([task({ premiseVerificationCount: 2 })])),
    /premiseVerificationCount must be between 0 and 1/,
  );
});

test("allows only the active task status and backlog timestamp to change", () => {
  const before = backlog([task(), task({ id: "OPS-02", priority: 20 })]);
  const completed = structuredClone(before);
  completed.updatedAt = "2026-07-22";
  const activeTask = completed.tasks[0];
  assert.ok(activeTask);
  activeTask.status = "completed";
  assert.deepEqual(evaluateBacklogTransition(before, completed, "OPS-01"), {
    ok: true,
    reasons: [],
  });

  const widened = structuredClone(completed);
  const futureTask = widened.tasks[1];
  assert.ok(futureTask);
  futureTask.ownerGate = true;
  assert.deepEqual(evaluateBacklogTransition(before, widened, "OPS-01"), {
    ok: false,
    reasons: ["task OPS-02 contract changed during OPS-01"],
  });

  const commandChanged = structuredClone(completed);
  const changedActiveTask = commandChanged.tasks[0];
  assert.ok(changedActiveTask);
  changedActiveTask.verification = [["node", "malicious.mjs"]];
  assert.deepEqual(evaluateBacklogTransition(before, commandChanged, "OPS-01"), {
    ok: false,
    reasons: ["task OPS-01 contract changed outside status during OPS-01"],
  });
});

test("updatedAt is a full ISO timestamp, not a bare date", () => {
  // The controller truncated its completion timestamp to ten characters, so
  // every finished task rewrote updatedAt as "2026-08-02". That reads as the
  // backlog moving backwards in time and changes the field's format away from
  // what proposeTask and every other writer use. Two work reviews caught it on
  // two separate tasks before it was traced to one slice() call.
  const backlog = JSON.parse(
    readFileSync(new URL("../../../docs/plans/unattended-backlog.json", import.meta.url), "utf8"),
  );
  validateBacklog(backlog);
  assert.match(
    backlog.updatedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
    `updatedAt must be a full ISO timestamp, found ${backlog.updatedAt}`,
  );
});
