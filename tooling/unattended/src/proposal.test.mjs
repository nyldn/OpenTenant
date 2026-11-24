import assert from "node:assert/strict";
import test from "node:test";

import { graduateFog, proposeTask, recordFog } from "./proposal.mjs";
import { selectNextTask, validateBacklog } from "./backlog.mjs";

/** @param {Partial<import("./backlog.mjs").UnattendedTask>} overrides */
function task(overrides = {}) {
  return {
    id: "TASK-01",
    priority: 100,
    title: "Do the thing",
    lane: "fix",
    status: "pending",
    objective: "Make the thing correct.",
    source: "docs/plans/example.md",
    acceptanceCriteria: ["The thing is correct."],
    dependencies: [],
    ownerGate: false,
    allowedPaths: ["packages/platform-core/src"],
    timeoutMinutes: 30,
    verification: [["pnpm", "turbo", "run", "test"]],
    ...overrides,
  };
}

function backlog(tasks = [task({ id: "DONE-01", status: "completed" })], fog = undefined) {
  const value = { version: 1, updatedAt: "2026-08-02T00:00:00Z", tasks };
  return fog ? { ...value, fog } : value;
}

test("a proposal appends a selectable task", () => {
  const next = proposeTask(backlog(), task({ id: "NEW-01" }), "2026-08-02T01:00:00Z");
  assert.equal(next.tasks.length, 2);
  assert.equal(next.updatedAt, "2026-08-02T01:00:00Z");
  assert.equal(selectNextTask(next)?.id, "NEW-01");
});

test("a proposal cannot create an owner gate", () => {
  assert.throws(
    () => proposeTask(backlog(), task({ id: "NEW-01", ownerGate: true }), "2026-08-02T01:00:00Z"),
    /cannot create an owner gate/,
  );
  assert.throws(
    () => proposeTask(backlog(), task({ id: "NEW-01", lane: "owner", ownerGate: true }), "2026-08-02T01:00:00Z"),
    /cannot create an owner gate/,
  );
});

test("a proposal cannot start in a state that skips work", () => {
  /** @type {import("./backlog.mjs").TaskStatus[]} */
  const statuses = ["completed", "not_verified", "in_progress", "blocked"];
  for (const status of statuses) {
    assert.throws(
      () => proposeTask(backlog(), task({ id: "NEW-01", status }), "2026-08-02T01:00:00Z"),
      /must start pending/,
    );
  }
});

test("a proposal is rejected for colliding with an existing task", () => {
  assert.throws(
    () => proposeTask(backlog(), task({ id: "DONE-01" }), "2026-08-02T01:00:00Z"),
    /already exists/,
  );
});

test("a proposal is validated against the whole backlog, not itself", () => {
  assert.throws(
    () => proposeTask(backlog(), task({ id: "NEW-01", dependencies: ["ABSENT-01"] }), "2026-08-02T01:00:00Z"),
    /unknown dependency/,
  );
});

test("a proposal inherits every task rule that already existed", () => {
  /** @type {Array<{ draft: unknown, expected: RegExp }>} */
  const cases = [
    { draft: task({ id: "NEW-01", verification: [["curl", "https://example.com"]] }), expected: /unsupported verification executable/ },
    { draft: task({ id: "NEW-01", verification: [] }), expected: /verification must be a non-empty array/ },
    { draft: task({ id: "NEW-01", allowedPaths: ["../elsewhere"] }), expected: /unsafe allowed path/ },
    { draft: task({ id: "NEW-01", allowedPaths: [".env.local"] }), expected: /secret-bearing path/ },
    { draft: task({ id: "NEW-01", timeoutMinutes: 600 }), expected: /timeoutMinutes must be between/ },
  ];
  for (const { draft, expected } of cases) {
    assert.throws(() => proposeTask(backlog(), draft, "2026-08-02T01:00:00Z"), expected);
  }
});

test("fog records a question that is not yet a task", () => {
  const next = recordFog(
    backlog(),
    { id: "FOG-01", question: "Should composed replies replace concatenation?", raisedAt: "2026-08-02", notes: [] },
    "2026-08-02T01:00:00Z",
  );
  assert.equal(next.fog?.length, 1);
  assert.equal(next.tasks.length, 1);
});

test("fog is never selectable, however it is written", () => {
  const next = recordFog(
    backlog([]),
    { id: "FOG-01", question: "Unknown unknown", raisedAt: "2026-08-02", notes: ["dim"] },
    "2026-08-02T01:00:00Z",
  );
  assert.equal(selectNextTask(next), undefined);
});

test("fog cannot collide with a task id", () => {
  assert.throws(
    () => recordFog(
      backlog(),
      { id: "DONE-01", question: "Same name as a task", raisedAt: "2026-08-02", notes: [] },
      "2026-08-02T01:00:00Z",
    ),
    /collides with a task id/,
  );
});

test("graduating a question removes it in the same operation", () => {
  const withFog = recordFog(
    backlog(),
    { id: "FOG-01", question: "Sharpen me", raisedAt: "2026-08-02", notes: [] },
    "2026-08-02T01:00:00Z",
  );
  const graduated = graduateFog(withFog, "FOG-01", task({ id: "NEW-01" }), "2026-08-02T02:00:00Z");
  assert.equal(graduated.fog?.length, 0);
  assert.equal(selectNextTask(graduated)?.id, "NEW-01");
});

test("graduating an unknown question fails rather than inventing one", () => {
  assert.throws(
    () => graduateFog(backlog(), "FOG-404", task({ id: "NEW-01" }), "2026-08-02T02:00:00Z"),
    /unknown fog entry/,
  );
});

test("a rejected graduation leaves the backlog untouched", () => {
  const withFog = recordFog(
    backlog(),
    { id: "FOG-01", question: "Sharpen me", raisedAt: "2026-08-02", notes: [] },
    "2026-08-02T01:00:00Z",
  );
  assert.throws(
    () => graduateFog(withFog, "FOG-01", task({ id: "NEW-01", ownerGate: true }), "2026-08-02T02:00:00Z"),
    /cannot create an owner gate/,
  );
  assert.equal(validateBacklog(withFog).fog?.length, 1);
});
