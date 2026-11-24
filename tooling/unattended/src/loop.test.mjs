import assert from "node:assert/strict";
import test from "node:test";

import { nextLoopAction, parseLoopOptions } from "./loop.mjs";

/** @param {Partial<import("./loop.mjs").LoopOptions>} overrides */
function options(overrides = {}) {
  return { execute: false, review: false, maxIterations: 5, budgetMinutes: 60, ...overrides };
}

/** @param {Partial<import("./loop.mjs").LoopState>} overrides */
function state(overrides = {}) {
  return { iterationsRun: 0, elapsedMinutes: 0, queueEmpty: false, lastRunOk: null, ...overrides };
}

test("defaults are the cautious ones", () => {
  const parsed = parseLoopOptions([]);
  assert.equal(parsed.execute, false);
  assert.equal(parsed.maxIterations, 1);
});

test("bounds are enforced rather than clamped", () => {
  assert.throws(() => parseLoopOptions(["--max-iterations", "0"]), /between 1 and 20/);
  assert.throws(() => parseLoopOptions(["--max-iterations", "21"]), /between 1 and 20/);
  assert.throws(() => parseLoopOptions(["--budget-minutes", "1"]), /between 5 and 480/);
  assert.throws(() => parseLoopOptions(["--budget-minutes", "999"]), /between 5 and 480/);
  assert.throws(() => parseLoopOptions(["--max-iterations", "many"]), /requires an integer/);
});

test("an unknown option stops the run rather than being ignored", () => {
  assert.throws(() => parseLoopOptions(["--yolo"]), /unknown loop option/);
});

test("it runs while work remains inside budget", () => {
  assert.equal(nextLoopAction(options(), state()).action, "run");
});

test("a failure stops the loop, and reports the failure rather than the ceiling", () => {
  const decision = nextLoopAction(
    options({ maxIterations: 1 }),
    state({ iterationsRun: 1, lastRunOk: false }),
  );
  assert.equal(decision.action, "stop");
  assert.match(decision.reason, /previous task failed/);
});

test("an empty queue stops the loop", () => {
  const decision = nextLoopAction(options(), state({ queueEmpty: true, lastRunOk: true }));
  assert.equal(decision.action, "stop");
  assert.match(decision.reason, /no selectable task/);
});

test("the iteration ceiling stops the loop", () => {
  const decision = nextLoopAction(options({ maxIterations: 3 }), state({ iterationsRun: 3, lastRunOk: true }));
  assert.equal(decision.action, "stop");
  assert.match(decision.reason, /iteration ceiling of 3/);
});

test("the time budget stops the loop even with iterations left", () => {
  const decision = nextLoopAction(
    options({ maxIterations: 20, budgetMinutes: 30 }),
    state({ iterationsRun: 2, elapsedMinutes: 31, lastRunOk: true }),
  );
  assert.equal(decision.action, "stop");
  assert.match(decision.reason, /time budget of 30 minutes/);
});

test("success alone never stops it; only a bound does", () => {
  assert.equal(
    nextLoopAction(options(), state({ iterationsRun: 1, lastRunOk: true })).action,
    "run",
  );
});

test("execute forces a deliberate choice about review", () => {
  assert.throws(() => parseLoopOptions(["--execute"]), /requires either --review or --no-review/);
  assert.equal(parseLoopOptions(["--execute", "--review"]).review, true);
  assert.equal(parseLoopOptions(["--execute", "--no-review"]).review, false);
});

test("a dry run does not need the choice, and does not review by default", () => {
  assert.equal(parseLoopOptions([]).review, false);
  assert.equal(parseLoopOptions(["--review"]).review, true);
});
