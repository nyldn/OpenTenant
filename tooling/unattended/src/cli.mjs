#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { readFailures, latestFailure, failureDisposition } from "./failures.mjs";
import { commitVerifiedBacklog } from "./runner-git-state.mjs";
import { inspectPreflight } from "./preflight.mjs";
import {
  buildTaskPrompt,
  loadBacklog,
  parseRunOptions,
  runTasks,
  runVerification,
} from "./runner.mjs";
import {
  selectNextSupervisedTask,
  selectNextTask,
  selectVerificationTask,
} from "./backlog.mjs";
import { nextLoopAction, parseLoopOptions } from "./loop.mjs";
import {
  buildPlanReviewPrompt,
  buildWorkReviewPrompt,
  runReviewers,
  summariseReview,
} from "./review.mjs";
import { scaffoldTask } from "./scaffold.mjs";
import { graduateFog, proposeTask, recordFog } from "./proposal.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKLOG_PATH = join("docs", "plans", "unattended-backlog.json");

/** @param {string[]} argv @param {string} flag */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    throw new TypeError(`${flag} requires a value`);
  }
  return String(argv[index + 1]);
}

/**
 * Proposals arrive as a file rather than on the command line, so the exact
 * bytes that were reviewed are the bytes that are appended.
 *
 * @param {string} path
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} rootDir @param {unknown} backlog */
function writeBacklog(rootDir, backlog) {
  writeFileSync(join(rootDir, BACKLOG_PATH), `${JSON.stringify(backlog, null, 2)}\n`);
}

/**
 * The whole diff a task produced, not its last commit.
 *
 * The controller writes two commits per task, a checkpoint and a verification,
 * so `HEAD~1..HEAD` is the backlog metadata edit and none of the work. The
 * first two-commit run blocked on exactly that: both reviewers correctly
 * reported that the diff contained none of the required implementation, because
 * the diff they were shown did not. Anchor on the merge base instead, which is
 * what runVerification already does.
 *
 * @param {string} rootDir
 */
function taskDiff(rootDir) {
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", base, "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const [command = "status", ...args] = process.argv.slice(2);
const root = process.cwd();

/** @param {unknown} value */
function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === "status") {
    const backlog = loadBacklog(root);
    print({
      awaitingVerification: selectVerificationTask(backlog) ?? null,
      next: selectNextTask(backlog) ?? null,
      nextSupervised: selectNextSupervisedTask(backlog) ?? null,
      taskCount: backlog.tasks.length,
      failures: readFailures(root),
    });
  } else if (command === "failures") {
    print(readFailures(root));
  } else if (command === "preflight") {
    const result = inspectPreflight(root, { execute: args.includes("--execute") });
    print(result);
    if (!result.result.ok) process.exitCode = 1;
  } else if (command === "prompt") {
    const backlog = loadBacklog(root);
    const task = selectVerificationTask(backlog) ?? selectNextTask(backlog);
    if (!task) throw new Error("no ready local task");
    if (failureDisposition(root, task.id) === "blocked") throw new Error("task blocked after two repair retries");
    process.stdout.write(`${buildTaskPrompt(task, false, latestFailure(root, task.id))}\n`);
  } else if (command === "verify") {
    const preflight = inspectPreflight(root, { execute: true });
    if (!preflight.result.ok) {
      print(preflight);
      process.exitCode = 1;
    } else {
      const backlog = loadBacklog(root);
      const task = selectVerificationTask(backlog) ?? selectNextTask(backlog);
      if (!task) throw new Error("no ready local task");
      const afterHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const beforeHead = task.status === "not_verified"
        ? execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim()
        : execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim();
      const exitCodes = runVerification(root, task, beforeHead, afterHead);
      print({ task: task.id, exitCodes, ok: exitCodes.every((code) => code === 0) });
      if (exitCodes.some((code) => code !== 0)) {
        if (failureDisposition(root, task.id) === "blocked") commitVerifiedBacklog(root, backlog, task.id, "blocked");
        process.exitCode = 1;
      }
    }
  } else if (command === "run") {
    const options = parseRunOptions(args);
    const preflight = inspectPreflight(root, { execute: options.execute });
    if (!preflight.result.ok) {
      print(preflight);
      process.exitCode = 1;
    } else {
      const result = runTasks(root, options);
      print(result);
      if (!result.ok) process.exitCode = 1;
    }
  } else if (command === "scaffold") {
    // The whole point is that you do not hand-write thirteen fields. Give it a
    // sentence and the paths, get a task you can review as a diff.
    const backlog = loadBacklog(root);
    const draft = scaffoldTask(readJson(flagValue(args, "--file")), {
      existingPriorities: backlog.tasks.map((task) => task.priority),
    });
    process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
  } else if (command === "review") {
    const backlog = loadBacklog(root);
    const task = args.includes("--work")
      ? selectVerificationTask(backlog) ?? selectNextTask(backlog)
      : selectNextTask(backlog);
    if (!task) throw new Error("no ready local task");
    const prompt = args.includes("--work")
      ? buildWorkReviewPrompt(task, taskDiff(root))
      : buildPlanReviewPrompt(task);
    const stage = args.includes("--work") ? "work" : "plan";
    const summary = summariseReview(stage, runReviewers(prompt, { cwd: root }));
    print({ task: task.id, ...summary });
    if (!summary.ok) process.exitCode = 1;
  } else if (command === "propose" || command === "fog" || command === "graduate") {
    // The timestamp is supplied rather than read from the clock so the same
    // input always produces the same backlog, which is what makes a proposal
    // reviewable as a diff.
    const updatedAt = flagValue(args, "--updated-at");
    const backlog = loadBacklog(root);
    const next = command === "propose"
      ? proposeTask(backlog, readJson(flagValue(args, "--file")), updatedAt)
      : command === "fog"
        ? recordFog(backlog, readJson(flagValue(args, "--file")), updatedAt)
        : graduateFog(backlog, flagValue(args, "--fog"), readJson(flagValue(args, "--file")), updatedAt);
    if (args.includes("--write")) {
      writeBacklog(root, next);
      print({ command, written: BACKLOG_PATH, taskCount: next.tasks.length, fogCount: (next.fog ?? []).length });
    } else {
      print({ command, dryRun: true, taskCount: next.tasks.length, fogCount: (next.fog ?? []).length });
    }
  } else if (command === "loop") {
    const options = parseLoopOptions(args);
    const startedAt = Date.now();
    /** @type {{ iterationsRun: number, elapsedMinutes: number, queueEmpty: boolean, lastRunOk: boolean | null }} */
    const state = { iterationsRun: 0, elapsedMinutes: 0, queueEmpty: false, lastRunOk: null };
    /** @type {unknown[]} */
    const iterations = [];
    let decision = nextLoopAction(options, state);

    while (decision.action === "run") {
      const backlog = loadBacklog(root);
      if (!selectVerificationTask(backlog) && !selectNextTask(backlog)) {
        state.queueEmpty = true;
        decision = nextLoopAction(options, state);
        break;
      }
      // Preflight runs every iteration, not once. The tree it is checking is
      // the tree the previous iteration just committed to.
      const preflight = inspectPreflight(root, { execute: options.execute });
      if (!preflight.result.ok) {
        state.lastRunOk = false;
        iterations.push({ iteration: state.iterationsRun + 1, preflight: preflight.result });
        state.iterationsRun += 1;
        decision = nextLoopAction(options, state);
        break;
      }
      // runTasks resumes a task awaiting verification before starting new
      // work, so review must target the same task it will run.
      const pending = selectVerificationTask(backlog) ?? selectNextTask(backlog);
      /** @type {unknown} */
      let planReview = null;
      if (options.review && pending) {
        // Advisory. Findings are carried into the run record so they reach a
        // human, and the agent proceeds. See summariseReview for why the plan
        // stage does not block.
        planReview = summariseReview("plan", runReviewers(buildPlanReviewPrompt(pending), { cwd: root }));
      }

      const result = runTasks(root, {
        execute: options.execute,
        maxTasks: 1,
        ...(options.review && options.execute
          ? {
              // Blocking, and run inside the controller after its
              // deterministic gates but before the task is committed as
              // completed. It can only withhold completion.
              /** @param {import("./backlog.mjs").UnattendedTask} task */
              reviewWork: (task) => summariseReview(
                "work",
                runReviewers(buildWorkReviewPrompt(task, taskDiff(root)), { cwd: root }),
              ),
            }
          : {}),
      });
      state.iterationsRun += 1;
      state.lastRunOk = result.ok;
      iterations.push({ iteration: state.iterationsRun, ok: result.ok, planReview, result });
      state.elapsedMinutes = (Date.now() - startedAt) / 60_000;
      decision = nextLoopAction(options, state);
    }

    const ok = state.lastRunOk !== false;
    print({
      execute: options.execute,
      iterationsRun: state.iterationsRun,
      stoppedBecause: decision.reason,
      ok,
      iterations,
    });
    if (!ok) process.exitCode = 1;
  } else {
    throw new TypeError(`unknown command ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
