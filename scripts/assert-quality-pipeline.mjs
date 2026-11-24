import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  parseJsonCommandResult,
  validateQualityMatrix,
  workspaceNamesFromPnpmInventory,
} from "../tooling/ci/quality-pipeline.mjs";

function runJsonCommand(args, commandName) {
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseJsonCommandResult(result, commandName);
}

const inventory = runJsonCommand(
  ["list", "--recursive", "--depth", "-1", "--json"],
  "pnpm workspace inventory",
);
const workspaceNames = workspaceNamesFromPnpmInventory(inventory, process.cwd());

const dryRun = runJsonCommand(
  ["turbo", "run", "lint", "typecheck", "test", "--dry=json"],
  "Turbo quality dry run",
);

assert.ok(dryRun && typeof dryRun === "object" && !Array.isArray(dryRun), "Turbo dry run did not return an object");
const report = /** @type {{ tasks?: unknown }} */ (dryRun);
const result = validateQualityMatrix(workspaceNames, report.tasks);

process.stdout.write(
  `Quality pipeline: ${result.workspaceCount} workspaces; ${result.taskCount} tasks; 0 builds.\n`,
);
