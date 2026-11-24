import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanReviewPrompt,
  buildWorkReviewPrompt,
  evaluateReviewGate,
  parseReviewVerdict,
  reviewerCommand,
  runReviewers,
  summariseReview,
} from "./review.mjs";

/** @returns {import("./backlog.mjs").UnattendedTask} */
function task() {
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
  };
}

test("the plan prompt carries the whole contract the reviewer must judge", () => {
  const prompt = buildPlanReviewPrompt(task());
  for (const fragment of [
    "TASK-01",
    "Make the thing correct.",
    "The thing is correct.",
    "pnpm turbo run test",
    "packages/platform-core/src",
  ]) {
    assert.ok(prompt.includes(fragment), `expected the prompt to include ${fragment}`);
  }
});

test("both prompts tell the reviewer it cannot approve", () => {
  for (const prompt of [buildPlanReviewPrompt(task()), buildWorkReviewPrompt(task(), "diff")]) {
    assert.match(prompt, /You cannot approve/);
    assert.match(prompt, /default[\s\S]*uncertain|not certain/);
  }
});

test("the work prompt asks for what deterministic checks cannot see", () => {
  const prompt = buildWorkReviewPrompt(task(), "diff --git a/x b/x");
  assert.match(prompt, /do not re-run them/);
  assert.match(prompt, /assert something/);
  assert.match(prompt, /assert the implementation rather than the behaviour/);
  assert.ok(prompt.includes("diff --git a/x b/x"));
});

test("a clean verdict parses and does not block", () => {
  const verdict = parseReviewVerdict("codex", '{"blocking": false, "findings": [], "note": "nothing found"}');
  assert.equal(verdict.blocking, false);
  assert.equal(verdict.note, "nothing found");
  assert.equal(evaluateReviewGate([verdict]).ok, true);
});

test("a blocking verdict reports its findings", () => {
  const verdict = parseReviewVerdict(
    "fable",
    '{"blocking": true, "findings": [{"summary": "claims a file exists", "evidence": "line 12"}]}',
  );
  const gate = evaluateReviewGate([verdict]);
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.reasons, ["fable: claims a file exists"]);
});

test("prose around the JSON object is tolerated", () => {
  const verdict = parseReviewVerdict("codex", 'Here is my verdict:\n{"blocking": false}\nHope that helps.');
  assert.equal(verdict.blocking, false);
});

test("anything unparseable blocks rather than passing", () => {
  const cases = [
    ["", /returned nothing/],
    ["   ", /returned nothing/],
    ["I could not review this.", /no JSON object/],
    ["{not json}", /invalid JSON/],
    ["[1,2,3]", /no JSON object/],
    ['{"findings": []}', /omitted a boolean blocking field/],
    ['{"blocking": "yes"}', /omitted a boolean blocking field/],
  ];
  for (const [raw, expected] of cases) {
    const verdict = parseReviewVerdict("codex", String(raw));
    assert.equal(verdict.blocking, true, `expected ${JSON.stringify(raw)} to block`);
    assert.match(String(verdict.note), /** @type {RegExp} */ (expected));
  }
});

test("a non-string reply blocks", () => {
  assert.equal(parseReviewVerdict("codex", undefined).blocking, true);
  assert.equal(parseReviewVerdict("codex", { blocking: false }).blocking, true);
});

test("malformed findings are dropped without weakening the verdict", () => {
  const verdict = parseReviewVerdict(
    "codex",
    '{"blocking": true, "findings": [{"summary": ""}, "nope", {"summary": "real one"}]}',
  );
  assert.equal(verdict.blocking, true);
  assert.deepEqual(verdict.findings, [{ summary: "real one" }]);
});

test("a block with no findings still blocks", () => {
  const verdict = parseReviewVerdict("fable", '{"blocking": true, "findings": []}');
  const gate = evaluateReviewGate([verdict]);
  assert.equal(gate.ok, false);
  assert.match(String(gate.reasons[0]), /no detail given/);
});

test("one block outvotes any number of passes", () => {
  const gate = evaluateReviewGate([
    parseReviewVerdict("codex", '{"blocking": false}'),
    parseReviewVerdict("fable", '{"blocking": true, "findings": [{"summary": "unverified claim"}]}'),
  ]);
  assert.equal(gate.ok, false);
  assert.equal(gate.reasons.length, 1);
});

test("no verdicts at all blocks, so a missing CLI cannot silently disable review", () => {
  const gate = evaluateReviewGate([]);
  assert.equal(gate.ok, false);
  assert.match(String(gate.reasons[0]), /no reviewer produced a verdict/);
});

test("reviewers run read-only and fable gets no tools", () => {
  assert.deepEqual(reviewerCommand("codex"), ["codex", "exec", "--sandbox", "read-only"]);

  const fable = reviewerCommand("fable");
  assert.equal(fable[0], "claude");
  assert.ok(fable.includes("--allowedTools"));
  assert.equal(fable[fable.indexOf("--allowedTools") + 1], "");
  assert.equal(fable[fable.indexOf("--model") + 1], "claude-fable-5");
});

test("the prompt is never an argument, so no flag can swallow it", () => {
  // The first live run passed the prompt in argv, where `--allowedTools ""`
  // took it as its own value and the reviewer exited without seeing the task.
  const prompt = buildPlanReviewPrompt(task());
  for (const reviewer of /** @type {const} */ (["codex", "fable"])) {
    const argv = reviewerCommand(reviewer);
    assert.ok(
      argv.every((argument) => !argument.includes("TASK-01")),
      `${reviewer} must not carry the prompt in argv`,
    );
    assert.ok(!argv.includes(prompt));
  }
});

test("an unknown reviewer is refused", () => {
  assert.throws(() => reviewerCommand(/** @type {any} */ ("gpt")), /unknown reviewer/);
});

test("an empty prompt is refused before any reviewer is launched", () => {
  assert.throws(() => runReviewers("  ", { cwd: process.cwd() }), /non-empty string/);
});

test("work review blocks, because the diff is fixed and uncertainty should stop it", () => {
  const blocked = summariseReview("work", [
    parseReviewVerdict("codex", '{"blocking": true, "findings": [{"summary": "unverified claim"}]}'),
  ]);
  assert.equal(blocked.blocking, true);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.reasons, ["codex: unverified claim"]);
});

test("plan review advises, because a spec can always be criticised further", () => {
  const advised = summariseReview("plan", [
    parseReviewVerdict("codex", '{"blocking": true, "findings": [{"summary": "criteria could be sharper"}]}'),
  ]);
  assert.equal(advised.blocking, false);
  assert.equal(advised.ok, true);
  // Advisory means it does not stop the run, not that nobody hears it.
  assert.deepEqual(advised.reasons, ["codex: criteria could be sharper"]);
});

test("a clean review is clean at either stage", () => {
  for (const stage of /** @type {const} */ (["plan", "work"])) {
    const summary = summariseReview(stage, [parseReviewVerdict("codex", '{"blocking": false}')]);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.reasons, []);
  }
});

test("a dead reviewer still stops finished work, and still cannot stop a plan", () => {
  const dead = [{ reviewer: "fable", blocking: true, findings: [], note: "reviewer did not complete" }];
  assert.equal(summariseReview("work", dead).ok, false);
  assert.equal(summariseReview("plan", dead).ok, true);
  assert.match(String(summariseReview("plan", dead).reasons[0]), /did not complete/);
});

test("an unknown stage is refused rather than defaulting to the permissive one", () => {
  assert.throws(() => summariseReview(/** @type {any} */ ("maybe"), []), /unknown review stage/);
});
