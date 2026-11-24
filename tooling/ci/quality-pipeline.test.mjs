import assert from "node:assert/strict";
import test from "node:test";

import {
  parseJsonCommandResult,
  validateQualityMatrix,
  workspaceNamesFromPnpmInventory,
} from "./quality-pipeline.mjs";

const ROOT = "/fixture/repository";

function makeTask(packageName, taskName, overrides = {}) {
  const command = taskName === "lint"
    ? "eslint ."
    : taskName === "typecheck"
      ? "tsc --noEmit"
      : "node --test";
  return {
    package: packageName,
    task: taskName,
    command,
    dependencies: [],
    ...overrides,
  };
}

function completeTasks(workspaceNames) {
  return workspaceNames.flatMap((packageName) => [
    makeTask(packageName, "lint"),
    makeTask(packageName, "typecheck"),
    makeTask(packageName, "test"),
  ]);
}

test("accepts one complete workspace", () => {
  assert.deepEqual(
    validateQualityMatrix(["@fixture/a"], completeTasks(["@fixture/a"])),
    { workspaceCount: 1, taskCount: 3 },
  );
});

test("accepts twenty-two complete workspaces without a counter", () => {
  const workspaceNames = Array.from({ length: 22 }, (_, index) => `@fixture/${index}`);
  assert.deepEqual(
    validateQualityMatrix(workspaceNames, completeTasks(workspaceNames)),
    { workspaceCount: 22, taskCount: 66 },
  );
});

test("fails when an added workspace has no test task", () => {
  const workspaceNames = ["@fixture/a", "@fixture/b"];
  const tasks = completeTasks(workspaceNames).filter(
    (task) => !(task.package === "@fixture/b" && task.task === "test"),
  );
  assert.throws(
    () => validateQualityMatrix(workspaceNames, tasks),
    /missing quality tasks:.*@fixture\/b#test/u,
  );
});

test("fails a missing lint task and a duplicate task elsewhere", () => {
  const tasks = completeTasks(["@fixture/a", "@fixture/b"])
    .filter((task) => !(task.package === "@fixture/a" && task.task === "lint"));
  tasks.push(makeTask("@fixture/b", "test"));
  assert.throws(
    () => validateQualityMatrix(["@fixture/a", "@fixture/b"], tasks),
    /duplicate quality task @fixture\/b#test/u,
  );
});

test("rejects equal task counts when package identities differ", () => {
  const tasks = completeTasks(["@fixture/a", "@fixture/c"]);
  assert.throws(
    () => validateQualityMatrix(["@fixture/a", "@fixture/b"], tasks),
    /unexpected quality task @fixture\/c#/u,
  );
});

test("rejects duplicate or missing workspace names", () => {
  const tasks = completeTasks(["@fixture/a"]);
  assert.throws(
    () => validateQualityMatrix(["@fixture/a", "@fixture/a"], tasks),
    /duplicate package @fixture\/a/u,
  );
  assert.throws(
    () => validateQualityMatrix(["@fixture/a", ""], tasks),
    /workspace name at index 1 is missing or empty/u,
  );
});

test("rejects build tasks and build dependencies", () => {
  assert.throws(
    () => validateQualityMatrix(["@fixture/a"], [
      makeTask("@fixture/a", "build"),
      ...completeTasks(["@fixture/a"]),
    ]),
    /must not schedule build tasks/u,
  );
  assert.throws(
    () => validateQualityMatrix(["@fixture/a"], completeTasks(["@fixture/a"]).map(
      (task) => task.task === "test" ? { ...task, dependencies: ["@fixture/a#build"] } : task,
    )),
    /must not depend on build tasks/u,
  );
});

test("rejects empty and incorrect quality commands", () => {
  for (const task of [
    { task: "test", command: "" },
    { task: "test", command: "   " },
    { task: "lint", command: "eslint src" },
    { task: "lint", command: "tsc --noEmit" },
    { task: "typecheck", command: "node check-types.mjs" },
  ]) {
    assert.throws(
      () => validateQualityMatrix(["@fixture/a"], completeTasks(["@fixture/a"]).map(
        (candidate) => candidate.task === task.task ? { ...candidate, command: task.command } : candidate,
      )),
      /empty command|lint must run ESLint|lint must not run TypeScript|typecheck must run/u,
    );
  }
});

test("derives workspace names from paths and excludes the root by path", () => {
  assert.deepEqual(
    workspaceNamesFromPnpmInventory([
      { name: "renamed-root", path: ROOT },
      { name: "@fixture/z", path: `${ROOT}/packages/z` },
      { name: "@fixture/a", path: `${ROOT}/packages/a` },
    ], ROOT),
    ["@fixture/a", "@fixture/z"],
  );
});

test("rejects malformed, duplicate, or nameless workspace inventory entries", () => {
  assert.throws(
    () => workspaceNamesFromPnpmInventory({ packages: [] }, ROOT),
    /inventory must be an array/u,
  );
  assert.throws(
    () => workspaceNamesFromPnpmInventory([
      { name: "@fixture/a", path: `${ROOT}/packages/a` },
      { name: "@fixture/a", path: `${ROOT}/packages/other` },
    ], ROOT),
    /duplicate package @fixture\/a/u,
  );
  assert.throws(
    () => workspaceNamesFromPnpmInventory([
      { path: `${ROOT}/packages/a` },
    ], ROOT),
    /missing a package name/u,
  );
  assert.throws(
    () => workspaceNamesFromPnpmInventory([
      { path: ROOT },
    ], ROOT),
    /missing a package name/u,
  );
});

test("does not turn failed inventory or Turbo commands into empty success", () => {
  assert.throws(
    () => parseJsonCommandResult({ status: 1, stdout: "", stderr: "permission denied" }, "pnpm workspace inventory"),
    /failed \(status 1\): permission denied/u,
  );
  assert.throws(
    () => parseJsonCommandResult({ status: 0, stdout: "" }, "Turbo quality dry run"),
    /returned empty JSON output/u,
  );
  assert.deepEqual(
    parseJsonCommandResult({ status: 0, stdout: "[]" }, "pnpm workspace inventory"),
    [],
  );
});
