// @ts-check

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { validateBacklog } from "./backlog.mjs";
import { buildSanitizedEnvironment } from "./runner-agent.mjs";

/** @param {string[]} changedPaths @param {string[]} allowedPaths */
export function findOutOfScopePaths(changedPaths, allowedPaths) {
  return changedPaths.filter(
    (changedPath) =>
      ((changedPath.split("/").at(-1)?.startsWith(".env") ?? false) &&
        changedPath.split("/").at(-1) !== ".env.example") ||
      !allowedPaths.some((allowedPath) => {
        const scope = allowedPath.endsWith("/") ? allowedPath : `${allowedPath}/`;
        return changedPath === allowedPath || changedPath.startsWith(scope);
      }),
  );
}

/**
 * @param {object} input
 * @param {number} input.agentExitCode
 * @param {string} input.beforeHead
 * @param {string} input.afterHead
 * @param {string} input.taskStatus
 * @param {string[]} input.dirtyPaths
 * @param {number[]} input.verificationExitCodes
 * @param {string[]} [input.outOfScopePaths]
 * @param {string[]} [input.backlogTransitionReasons]
 */
export function evaluateTaskResult(input) {
  /** @type {string[]} */
  const reasons = [];
  if (input.agentExitCode !== 0) reasons.push(`agent exited with code ${input.agentExitCode}`);
  if (input.beforeHead === input.afterHead) reasons.push("task did not create a checkpoint commit");
  if (input.taskStatus !== "not_verified") {
    reasons.push(`task status is ${input.taskStatus}, not not_verified`);
  }
  if (input.dirtyPaths.length > 0) {
    reasons.push(`worktree is dirty after task (${input.dirtyPaths.join(", ")})`);
  }
  if ((input.outOfScopePaths ?? []).length > 0) {
    reasons.push(`task changed files outside its scope (${input.outOfScopePaths?.join(", ")})`);
  }
  reasons.push(...(input.backlogTransitionReasons ?? []));
  input.verificationExitCodes.forEach((code, index) => {
    if (code !== 0) reasons.push(`verification command ${index + 1} failed with code ${code}`);
  });
  return { ok: reasons.length === 0, reasons };
}

/** @param {string} path */
export function acquireRunLock(path) {
  mkdirSync(join(path, ".."), { recursive: true });
  const recoveryPath = `${path}.recovery`;
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    // Only one contender may inspect and replace a stale lock. A second
    // contender fails closed instead of unlinking the first one's new lock.
    mkdirSync(recoveryPath);
    try {
      let record;
      try {
        record = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw error;
      }
      if (!Number.isSafeInteger(record?.pid) || record.pid <= 0) throw error;
      try {
        process.kill(record.pid, 0);
        throw error;
      } catch (processError) {
        if (
          !(processError instanceof Error) ||
          !("code" in processError) ||
          processError.code !== "ESRCH"
        ) {
          throw processError;
        }
      }
      rmSync(path, { force: true });
      descriptor = openSync(path, "wx", 0o600);
    } finally {
      rmSync(recoveryPath, { recursive: true, force: true });
    }
  }
  writeFileSync(
    descriptor,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token }),
  );
  closeSync(descriptor);
  return () => {
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (record?.token === token) rmSync(path, { force: true });
    } catch {
      // Missing or replaced locks do not belong to this owner.
    }
  };
}

/** @param {string} root */
export function loadBacklog(root) {
  return validateBacklog(
    JSON.parse(readFileSync(join(root, "docs/plans/unattended-backlog.json"), "utf8")),
  );
}

/** @param {string} root @param {import("./backlog.mjs").UnattendedBacklog} backlog @param {string} taskId */
export function commitVerifiedBacklog(root, backlog, taskId, status = /** @type {"completed" | "blocked"} */ ("completed")) {
  const task = backlog.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status !== "not_verified") return { code: 1, reason: "task is not awaiting verification" };
  task.status = status;
  // Full ISO timestamp, not a bare date. Truncating to ten characters made
  // every completion rewrite updatedAt as "2026-08-02", which reads as the
  // backlog having been last updated a day before its own previous update, and
  // silently changed the field's format away from what every other writer and
  // proposeTask use. Two consecutive work reviews caught it on two different
  // tasks before it was traced here.
  backlog.updatedAt = new Date().toISOString();
  writeFileSync(
    join(root, "docs/plans/unattended-backlog.json"),
    `${JSON.stringify(backlog, null, 2)}\n`,
    { mode: 0o644 },
  );
  const environment = buildSanitizedEnvironment(process.env);
  const add = spawnSync("git", ["add", "--", "docs/plans/unattended-backlog.json"], {
    cwd: root,
    env: environment,
    shell: false,
  });
  if ((add.status ?? 1) !== 0) return { code: add.status ?? 1, reason: "failed to stage verified backlog" };
  const commit = spawnSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", status === "blocked" ? `chore(unattended): block ${taskId} after failed verification` : `chore: verify ${taskId}`],
    { cwd: root, env: environment, shell: false, stdio: "inherit" },
  );
  return {
    code: commit.status ?? 1,
    reason: (commit.status ?? 1) === 0 ? "verified backlog committed" : "failed to commit verified backlog",
  };
}

/** @param {string} root @param {string[]} paths @param {string} taskId */
export function commitTaskCheckpoint(root, paths, taskId) {
  const environment = buildSanitizedEnvironment(process.env);
  const add = spawnSync("git", ["add", "--", ...paths], {
    cwd: root,
    env: environment,
    shell: false,
  });
  if ((add.status ?? 1) !== 0) return { code: add.status ?? 1, reason: "failed to stage task checkpoint" };
  const commit = spawnSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      `chore(unattended): checkpoint ${taskId}`,
    ],
    { cwd: root, env: environment, shell: false, stdio: "inherit" },
  );
  return {
    code: commit.status ?? 1,
    reason: (commit.status ?? 1) === 0 ? "task checkpoint committed" : "failed to commit task checkpoint",
  };
}

/** @param {string} root */
export function gitHead(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? String(result.stdout).trim() : "";
}

/** @param {string} root */
export function dirtyPaths(root) {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"],
    {
    cwd: root,
    encoding: "utf8",
    shell: false,
    },
  );
  return String(result.stdout ?? "")
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
}

/** @param {string} root */
export function ignoredPaths(root) {
  const result = spawnSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--ignored=matching",
      "--untracked-files=all",
    ],
    { cwd: root, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) throw new Error("cannot inspect ignored workspace state");
  return String(result.stdout ?? "")
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .sort();
}

/** @param {string[]} before @param {string[]} after */
export function findIgnoredStateChanges(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...after.filter((path) => !beforeSet.has(path)).map((path) => `added ${path}`),
    ...before.filter((path) => !afterSet.has(path)).map((path) => `removed ${path}`),
  ].sort();
}

/** @param {string} root @param {string} revision */
export function loadBacklogAt(root, revision) {
  const result = spawnSync(
    "git",
    ["show", `${revision}:docs/plans/unattended-backlog.json`],
    { cwd: root, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) throw new Error(`cannot load trusted backlog at ${revision}`);
  return validateBacklog(JSON.parse(String(result.stdout)));
}


/** @param {string} root @param {string} beforeHead @param {string} afterHead */
export function changedPaths(root, beforeHead, afterHead) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", `${beforeHead}..${afterHead}`], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  return String(result.stdout ?? "").split("\0").filter(Boolean);
}
