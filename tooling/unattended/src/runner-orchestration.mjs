// @ts-check

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { latestFailure, failureDisposition, recordFailure } from "./failures.mjs";
import {
  evaluateBacklogTransition,
  selectNextTask,
  selectVerificationTask,
} from "./backlog.mjs";
import {
  buildAgentArgs,
  buildRuntimePath,
  buildSanitizedEnvironment,
  buildTaskPrompt,
  executablePath,
  managedPnpmExecutable,
  sandboxReadablePaths,
} from "./runner-agent.mjs";
import {
  acquireRunLock,
  changedPaths,
  commitTaskCheckpoint,
  commitVerifiedBacklog,
  dirtyPaths,
  evaluateTaskResult,
  findIgnoredStateChanges,
  findOutOfScopePaths,
  gitHead,
  ignoredPaths,
  loadBacklog,
  loadBacklogAt,
} from "./runner-git-state.mjs";
import {
  assertTrustedControllerCommitted,
  buildSequentialGraphifyInvocation,
  buildVerificationEnvironment,
  buildVerificationSandboxArgs,
  runPremiseVerification,
  runVerification,
} from "./runner-verification.mjs";

/** @param {string[]} args */
export function parseRunOptions(args) {
  let execute = false;
  let maxTasks = 1;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--max-tasks") {
      const value = args[index + 1];
      maxTasks = Number(value);
      index += 1;
      if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 10) {
        throw new TypeError("--max-tasks must be between 1 and 10");
      }
      continue;
    }
    throw new TypeError(`unknown option ${argument}`);
  }
  return { execute, maxTasks };
}


/** @param {string} root */
function refreshGraphify(root) {
  const stateDirectory = join(root, ".opentenant/unattended");
  mkdirSync(stateDirectory, { recursive: true });
  const home = mkdtempSync(join(stateDirectory, "graphify-home-"));
  try {
    const environment = buildVerificationEnvironment(process.env, home);
    const codex = executablePath("codex");
    const graphify = executablePath("graphify");
    const git = executablePath("git");
    const invocation = buildSequentialGraphifyInvocation(graphify);
    environment.PATH = buildRuntimePath([
      "/opt/homebrew/opt/node@22/bin",
      "/Library/Developer/CommandLineTools/usr/bin",
      dirname(graphify),
    ]);
    const writablePaths = [home, join(root, "graphify-out")];
    const result = spawnSync(
      codex,
      buildVerificationSandboxArgs(
        root,
        sandboxReadablePaths(root),
        writablePaths,
        invocation.executable,
        invocation.args,
        {
          graphify,
          git,
          node: realpathSync(process.execPath),
          pnpm: managedPnpmExecutable(root) || "pnpm",
        },
      ),
      {
        cwd: root,
        env: environment,
        stdio: "inherit",
        shell: false,
        timeout: 30 * 60 * 1000,
      },
    );
    return result.status ?? 1;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @param {{
 *   execute: boolean,
 *   maxTasks: number,
 *   reviewWork?: (task: import("./backlog.mjs").UnattendedTask) => { ok: boolean, reasons: string[] },
 * }} options
 */
export function runTasks(root, options) {
  assertTrustedControllerCommitted(root);
  const stateDirectory = join(root, ".opentenant/unattended");
  const releaseLock = acquireRunLock(join(stateDirectory, "run.lock"));
  const journal = join(stateDirectory, "runs.jsonl");
  try {
    for (let attempt = 1; attempt <= options.maxTasks; attempt += 1) {
      const backlog = loadBacklog(root);
      const verificationTask = selectVerificationTask(backlog);
      const task = verificationTask ?? selectNextTask(backlog);
      if (!task) return { ok: true, completed: attempt - 1, reason: "no ready local task" };
      const failure = latestFailure(root, task.id);
      if (failureDisposition(root, task.id) === "blocked") {
        if (options.execute) commitVerifiedBacklog(root, backlog, task.id, "blocked");
        return { ok: false, completed: attempt - 1, task: task.id, reasons: ["failure retry limit exhausted; task blocked"] };
      }
      const repair = verificationTask && failure?.checkpointHead === gitHead(root);
      if (!options.execute) {
        return {
          ok: true,
          completed: 0,
          reason: verificationTask ? "dry-run verification recovery" : "dry run",
          task,
          ...(!verificationTask || repair ? { prompt: buildTaskPrompt(task, false, failure) } : {}),
        };
      }

      let beforeHead;
      let agentExitCode = 0;
      let updated = backlog;
      if (verificationTask && !repair) {
        const subject = spawnSync("git", ["log", "-1", "--format=%s"], {
          cwd: root,
          encoding: "utf8",
          shell: false,
        });
        if (String(subject.stdout).trim() !== `chore(unattended): checkpoint ${task.id}`) {
          return {
            ok: false,
            completed: attempt - 1,
            task: task.id,
            reasons: ["verification recovery HEAD is not the controller task checkpoint"],
          };
        }
        const parent = spawnSync("git", ["rev-parse", "HEAD^"], {
          cwd: root,
          encoding: "utf8",
          shell: false,
        });
        beforeHead = parent.status === 0 ? String(parent.stdout).trim() : "";
        if (!beforeHead) {
          return {
            ok: false,
            completed: attempt - 1,
            task: task.id,
            reasons: ["verification recovery checkpoint has no trusted parent"],
          };
        }
        updated = backlog;
        writeFileSync(
          journal,
          `${JSON.stringify({ event: "verification_resumed", task: task.id, attempt, head: gitHead(root), at: new Date().toISOString() })}\n`,
          { flag: "a", mode: 0o600 },
        );
      } else {
        beforeHead = repair ? failure.baseHead : gitHead(root);
        const premiseExitCodes = runPremiseVerification(root, task, beforeHead);
        const premiseReasons = premiseExitCodes.flatMap((code, index) =>
          code === 0 ? [] : [`premise verification command ${index + 1} failed with code ${code}`]
        );
        if (premiseReasons.length > 0) {
          writeFileSync(
            journal,
            `${JSON.stringify({ event: "premise_failed", task: task.id, attempt, head: beforeHead, reasons: premiseReasons, verificationExitCodes: premiseExitCodes, at: new Date().toISOString() })}\n`,
            { flag: "a", mode: 0o600 },
          );
          return {
            ok: false,
            completed: attempt - 1,
            task: task.id,
            reasons: premiseReasons,
          };
        }
        if (premiseExitCodes.length > 0) {
          writeFileSync(
            journal,
            `${JSON.stringify({ event: "premise_verified", task: task.id, attempt, head: beforeHead, verificationExitCodes: premiseExitCodes, at: new Date().toISOString() })}\n`,
            { flag: "a", mode: 0o600 },
          );
        }
        const agentBase = gitHead(root);
        const ignoredBefore = ignoredPaths(root);
        writeFileSync(
          journal,
          `${JSON.stringify({ event: "started", task: task.id, attempt, head: beforeHead, at: new Date().toISOString() })}\n`,
          { flag: "a", mode: 0o600 },
        );
        const codex = executablePath("codex");
        const agentEnvironment = buildSanitizedEnvironment(process.env);
        const pnpm = managedPnpmExecutable(root);
        agentEnvironment.PATH = buildRuntimePath([
          "/opt/homebrew/opt/node@22/bin",
          pnpm ? dirname(pnpm) : "",
          "/Library/Developer/CommandLineTools/usr/bin",
          "/opt/homebrew/bin",
          dirname(executablePath("graphify")),
        ]);
        agentEnvironment.npm_config_manage_package_manager_versions = "false";
        const agent = spawnSync(
          codex,
          buildAgentArgs(
            root,
            sandboxReadablePaths(root),
            task.allowedPaths.map((path) => resolve(root, path)),
            ignoredBefore.map((path) => resolve(root, path)),
          ),
          {
          cwd: root,
          env: agentEnvironment,
          input: buildTaskPrompt(task, true, failure),
          stdio: ["pipe", "inherit", "inherit"],
          shell: false,
          timeout: task.timeoutMinutes * 60 * 1000,
          },
        );
        agentExitCode = agent.status ?? 1;
        updated = loadBacklog(root);
        const agentHead = gitHead(root);
        let agentDirtyPaths = dirtyPaths(root);
        const ignoredChanges = findIgnoredStateChanges(ignoredBefore, ignoredPaths(root));
        const updatedTask = updated.tasks.find((candidate) => candidate.id === task.id);
        const reasons = [];
        if (agentExitCode !== 0) reasons.push(`agent exited with code ${agentExitCode}`);
        if (agentHead !== agentBase) reasons.push("agent modified Git history");
        if (updatedTask?.status !== "not_verified") {
          reasons.push(`task status is ${updatedTask?.status ?? "missing"}, not not_verified`);
        }
        if (agentDirtyPaths.length === 0) reasons.push("agent produced no checkpoint changes");
        if (ignoredChanges.length > 0) {
          reasons.push(`agent changed ignored workspace state (${ignoredChanges.join(", ")})`);
        }
        const outOfScopePaths = findOutOfScopePaths(agentDirtyPaths, task.allowedPaths);
        if (outOfScopePaths.length > 0) {
          reasons.push(`task changed files outside its scope (${outOfScopePaths.join(", ")})`);
        }
        reasons.push(...evaluateBacklogTransition(backlog, updated, task.id).reasons);
        if (reasons.length > 0) {
          writeFileSync(
            journal,
            `${JSON.stringify({ event: "failed", task: task.id, attempt, head: agentHead, reasons, verificationExitCodes: [], at: new Date().toISOString() })}\n`,
            { flag: "a", mode: 0o600 },
          );
          return { ok: false, completed: attempt - 1, task: task.id, reasons };
        }
        if (task.verification.some(([executable]) => executable === "graphify")) {
          const graphifyExitCode = refreshGraphify(root);
          if (graphifyExitCode !== 0) {
            const graphifyReasons = [`controller Graphify refresh failed with code ${graphifyExitCode}`];
            writeFileSync(
              journal,
              `${JSON.stringify({ event: "failed", task: task.id, attempt, head: gitHead(root), reasons: graphifyReasons, verificationExitCodes: [graphifyExitCode], at: new Date().toISOString() })}\n`,
              { flag: "a", mode: 0o600 },
            );
            return { ok: false, completed: attempt - 1, task: task.id, reasons: graphifyReasons };
          }
          agentDirtyPaths = dirtyPaths(root);
          const refreshedOutOfScopePaths = findOutOfScopePaths(
            agentDirtyPaths,
            task.allowedPaths,
          );
          if (refreshedOutOfScopePaths.length > 0) {
            const graphifyReasons = [
              `controller Graphify refresh changed files outside task scope (${refreshedOutOfScopePaths.join(", ")})`,
            ];
            return { ok: false, completed: attempt - 1, task: task.id, reasons: graphifyReasons };
          }
        }
        const checkpoint = commitTaskCheckpoint(root, agentDirtyPaths, task.id);
        if (checkpoint.code !== 0) {
          const checkpointReasons = [checkpoint.reason];
          writeFileSync(
            journal,
            `${JSON.stringify({ event: "failed", task: task.id, attempt, head: gitHead(root), reasons: checkpointReasons, verificationExitCodes: [], at: new Date().toISOString() })}\n`,
            { flag: "a", mode: 0o600 },
          );
          return { ok: false, completed: attempt - 1, task: task.id, reasons: checkpointReasons };
        }
      }
      const updatedTask = updated.tasks.find((candidate) => candidate.id === task.id);
      const afterHead = gitHead(root);
      const trustedBacklog = verificationTask ? loadBacklogAt(root, beforeHead) : backlog;
      const preVerification = evaluateTaskResult({
        agentExitCode,
        beforeHead,
        afterHead,
        taskStatus: updatedTask?.status ?? "missing",
        dirtyPaths: dirtyPaths(root),
        verificationExitCodes: [],
        outOfScopePaths: findOutOfScopePaths(
          changedPaths(root, beforeHead, afterHead),
          task.allowedPaths,
        ),
        backlogTransitionReasons: evaluateBacklogTransition(trustedBacklog, updated, task.id).reasons,
      });
      if (!preVerification.ok) {
        writeFileSync(
          journal,
          `${JSON.stringify({ event: "failed", task: task.id, attempt, head: afterHead, reasons: preVerification.reasons, verificationExitCodes: [], at: new Date().toISOString() })}\n`,
          { flag: "a", mode: 0o600 },
        );
        return { ok: false, completed: attempt - 1, task: task.id, reasons: preVerification.reasons };
      }

      const verificationExitCodes = runVerification(root, task, beforeHead, afterHead);
      const result = evaluateTaskResult({
        agentExitCode: 0,
        beforeHead,
        afterHead,
        taskStatus: updatedTask?.status ?? "missing",
        dirtyPaths: dirtyPaths(root),
        verificationExitCodes,
      });
      if (result.ok && options.reviewWork) {
        // Blocking review runs after the deterministic gates and before the
        // task is recorded as completed. A block leaves the checkpoint at
        // not_verified, so the next run resumes verification and review
        // instead of building on rejected work.
        const review = options.reviewWork(task);
        if (!review.ok) {
          recordFailure(root, { taskId: task.id, stage: "review", command: ["unattended:review", "--work"], log: review.reasons.join("\n"), filesTouched: changedPaths(root, beforeHead, afterHead), baseHead: beforeHead, checkpointHead: afterHead });
          if (failureDisposition(root, task.id) === "blocked") commitVerifiedBacklog(root, updated, task.id, "blocked");
          writeFileSync(
            journal,
            `${JSON.stringify({ event: "review_blocked", task: task.id, attempt, head: gitHead(root), reasons: review.reasons, at: new Date().toISOString() })}\n`,
            { flag: "a", mode: 0o600 },
          );
          return {
            ok: false,
            completed: attempt - 1,
            task: task.id,
            reasons: ["work review blocked", ...review.reasons],
            workReview: review,
          };
        }
      }
      if (result.ok) {
        const finalized = commitVerifiedBacklog(root, updated, task.id);
        if (finalized.code !== 0) result.reasons.push(finalized.reason);
        result.ok = result.reasons.length === 0;
      }
      writeFileSync(
        journal,
        `${JSON.stringify({ event: result.ok ? "completed" : "failed", task: task.id, attempt, head: gitHead(root), reasons: result.reasons, verificationExitCodes, at: new Date().toISOString() })}\n`,
        { flag: "a", mode: 0o600 },
      );
      if (!result.ok && failureDisposition(root, task.id) === "blocked") commitVerifiedBacklog(root, updated, task.id, "blocked");
      if (!result.ok) return { ok: false, completed: attempt - 1, task: task.id, reasons: result.reasons };
    }
    return { ok: true, completed: options.maxTasks, reason: "task limit reached" };
  } finally {
    releaseLock();
  }
}
