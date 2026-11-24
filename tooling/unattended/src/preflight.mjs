// @ts-check

import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_FILES = [
  "AGENTS.md",
  "RTK.md",
  "docs/HANDOFF.md",
  "docs/SHIPLOG.md",
  "docs/OWNER-TASKS.md",
  "docs/plans/unattended-backlog.json",
  "graphify-out/graph.json",
];
const SECRET_SCAN_SKIPS = new Set([
  ".git",
  ".next",
  ".opentenant",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

/**
 * @typedef {object} PreflightInput
 * @property {string} branch
 * @property {string} nodeVersion
 * @property {string} pnpmVersion
 * @property {string[]} dirtyPaths
 * @property {string[]} secretFiles
 * @property {string[]} missingRequiredFiles
 * @property {"fresh" | "stale" | "skipped"} graphCheck
 * @property {boolean} codexAvailable
 * @property {string | null} gitOperation
 * @property {boolean} execute
 */

/** @param {PreflightInput} input */
export function evaluatePreflight(input) {
  /** @type {string[]} */
  const reasons = [];
  if (input.branch === "main") reasons.push("refusing to run on main");
  if (input.branch === "HEAD" || input.branch.trim() === "") {
    reasons.push("refusing to run from a detached HEAD");
  } else if (input.branch !== "main" && !input.branch.startsWith("codex/")) {
    reasons.push(`branch must use the codex/ prefix (found ${input.branch})`);
  }
  if (!/^v22\./u.test(input.nodeVersion)) {
    reasons.push(`Node.js 22 is required (found ${input.nodeVersion})`);
  }
  if (input.pnpmVersion !== "11.13.1") {
    reasons.push(`pnpm 11.13.1 is required (found ${input.pnpmVersion})`);
  }
  if (input.dirtyPaths.length > 0) {
    reasons.push(`worktree must be clean (${input.dirtyPaths.join(", ")})`);
  }
  if (input.secretFiles.length > 0) {
    reasons.push(`secret-bearing environment files are present (${input.secretFiles.join(", ")})`);
  }
  if (input.missingRequiredFiles.length > 0) {
    reasons.push(`required repository records are missing (${input.missingRequiredFiles.join(", ")})`);
  }
  // "skipped" is not a failure of its own. Graphify is deliberately not run
  // when secret-bearing files are present, and reporting that as staleness
  // reads as a second, unrelated problem: the operator goes looking for a stale
  // graph that is perfectly current. The secret-files reason above already
  // fails the run.
  if (input.graphCheck === "stale") {
    reasons.push("Graphify reports stale repository knowledge");
  }
  if (input.execute && !input.codexAvailable) reasons.push("Codex CLI is required for --execute");
  if (input.gitOperation) reasons.push(`unfinished Git operation detected (${input.gitOperation})`);
  return { ok: reasons.length === 0, reasons };
}

/** @param {string} executable @param {string[]} args @param {string} cwd */
function commandOutput(executable, args, cwd) {
  const environment = {
    GRAPHIFY_SKIP_HOOK: "1",
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
  };
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    shell: false,
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

/** @param {string} output */
export function parsePorcelainPaths(output) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
}

/** @param {string} root */
export function findSecretFiles(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SECRET_SCAN_SKIPS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        (entry.name === ".env" || entry.name.startsWith(".env.")) &&
        entry.name !== ".env.example"
      ) {
        found.push(relative(root, path));
      }
    }
  }
  visit(root);
  return found.sort();
}

/** @param {string} root @param {{execute: boolean}} options */
export function inspectPreflight(root, options) {
  const secretFiles = findSecretFiles(root);
  const branch = commandOutput("git", ["branch", "--show-current"], root).output || "HEAD";
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
    },
  );
  const dirtyPaths = parsePorcelainPaths(String(status.stdout ?? ""));
  const pnpm = commandOutput("pnpm", ["--version"], root);
  const graph = secretFiles.length === 0
    ? commandOutput("graphify", ["check-update", "."], root)
    : null;
  const missingRequiredFiles = REQUIRED_FILES.filter((file) => !existsSync(join(root, file)));
  const codex = commandOutput("codex", ["--version"], root);
  const gitOperations = /** @type {Array<[string, string]>} */ ([
    ["merge", "MERGE_HEAD"],
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
    ["revert", "REVERT_HEAD"],
    ["bisect", "BISECT_LOG"],
  ]);
  /** @type {string | null} */
  let gitOperation = null;
  for (const [name, marker] of gitOperations) {
    const path = commandOutput("git", ["rev-parse", "--git-path", marker], root);
    const markerPath = path.output.startsWith("/") ? path.output : join(root, path.output);
    if (path.code === 0 && existsSync(markerPath)) {
      gitOperation = name;
      break;
    }
  }
  const input = {
    branch,
    nodeVersion: process.version,
    pnpmVersion: pnpm.code === 0 ? pnpm.output : "unavailable",
    dirtyPaths,
    secretFiles,
    missingRequiredFiles,
    graphCheck: graph === null
      ? /** @type {const} */ ("skipped")
      : graph.code === 0 &&
          !existsSync(join(root, "graphify-out/needs_update")) &&
          !/stale|needs update/iu.test(graph.output)
        ? /** @type {const} */ ("fresh")
        : /** @type {const} */ ("stale"),
    codexAvailable: codex.code === 0,
    gitOperation,
    execute: options.execute,
  };
  return { root: basename(root), input, result: evaluatePreflight(input) };
}
