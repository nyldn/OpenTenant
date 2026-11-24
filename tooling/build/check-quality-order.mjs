import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { validateQualityMatrix, workspaceNamesFromPnpmInventory } from "../ci/quality-pipeline.mjs";

const run = args => JSON.parse(execFileSync("pnpm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const inventory = run(["list", "--recursive", "--depth", "-1", "--json"]);
const names = workspaceNamesFromPnpmInventory(inventory, process.cwd());
const report = run(["turbo", "run", "lint", "typecheck", "test", "--dry=json"]);
const builds = report.tasks.filter(t => t.task === "build");
const buildIds = new Set(builds.filter(t => t.command !== "<NONEXISTENT>").map(t => t.taskId));
for (const task of report.tasks) {
  if (task.task === "test" || task.task === "typecheck") {
    const ownBuild = `${task.package}#build`;
    if (buildIds.has(ownBuild)) assert(task.dependencies.includes(ownBuild), `${task.taskId} must wait for its build`);
  }
}
// Retain the existing workspace/command checks. Build ordering is checked above;
// the original validator still guards independent lint/typecheck/test commands.
const quality = report.tasks.filter(t => t.task !== "build").map(t => ({ ...t, dependencies: t.dependencies.filter(d => !d.endsWith("#build")) }));
const result = validateQualityMatrix(names, quality);
console.log(`Quality pipeline: ${result.workspaceCount} workspaces; ${result.taskCount} quality tasks; ${builds.length} prerequisite builds.`);
