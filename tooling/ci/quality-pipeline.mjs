import { resolve } from "node:path";

const REQUIRED_TASKS = Object.freeze(["lint", "typecheck", "test"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one of the JSON-producing pnpm commands used by the quality matrix.
 *
 * @param {unknown} result
 * @param {string} commandName
 * @returns {unknown}
 */
export function parseJsonCommandResult(result, commandName) {
  if (!isRecord(result)) {
    throw new Error(`${commandName} did not return a process result`);
  }

  if (result.error !== undefined && result.error !== null) {
    const detail = result.error instanceof Error
      ? result.error.message
      : isRecord(result.error) && typeof result.error.message === "string"
        ? result.error.message
        : String(result.error);
    throw new Error(`${commandName} failed to start: ${detail}`);
  }

  if (typeof result.status !== "number" || result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const detail = stderr || stdout || "no output";
    throw new Error(`${commandName} failed (status ${String(result.status)}): ${detail}`);
  }

  if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
    throw new Error(`${commandName} returned empty JSON output`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${commandName} returned invalid JSON: ${detail}`, { cause: error });
  }
}

/**
 * Derive package identities from pnpm's recursive workspace inventory.
 * The root is identified by its resolved filesystem path, so a root package
 * rename cannot accidentally change the quality scope.
 *
 * @param {unknown} inventory
 * @param {string} rootDirectory
 * @returns {string[]}
 */
export function workspaceNamesFromPnpmInventory(inventory, rootDirectory) {
  if (!Array.isArray(inventory)) {
    throw new Error("pnpm workspace inventory must be an array");
  }
  if (typeof rootDirectory !== "string" || rootDirectory.trim() === "") {
    throw new Error("workspace root directory is required");
  }

  const rootPath = resolve(rootDirectory);
  const names = [];
  const seenNames = new Set();
  const seenPaths = new Set();

  for (const [index, entry] of inventory.entries()) {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.path.trim() === "") {
      throw new Error(`pnpm workspace inventory entry ${index} must include a path`);
    }

    const packagePath = resolvePath(entry.path, rootDirectory);
    if (seenPaths.has(packagePath)) {
      throw new Error(`pnpm workspace inventory contains duplicate path ${packagePath}`);
    }
    seenPaths.add(packagePath);

    if (
      typeof entry.name !== "string"
      || entry.name.trim() === ""
      || entry.name !== entry.name.trim()
    ) {
      throw new Error(`pnpm workspace inventory entry ${index} is missing a package name`);
    }
    if (packagePath === rootPath) {
      continue;
    }

    if (seenNames.has(entry.name)) {
      throw new Error(`pnpm workspace inventory contains duplicate package ${entry.name}`);
    }
    seenNames.add(entry.name);
    names.push(entry.name);
  }

  if (names.length === 0) {
    throw new Error("pnpm workspace inventory contains no workspaces outside the repository root");
  }

  return names.sort();
}

/**
 * Resolve a path without requiring fixture paths to exist on disk.
 *
 * @param {string} pathValue
 * @param {string} baseDirectory
 * @returns {string}
 */
function resolvePath(pathValue, baseDirectory) {
  return resolve(baseDirectory, pathValue);
}

/**
 * Validate that Turbo covers every discovered workspace with exactly one
 * lint, typecheck, and test task, while retaining the command safeguards.
 *
 * @param {unknown} workspaceNames
 * @param {unknown} tasks
 * @returns {{ workspaceCount: number, taskCount: number }}
 */
export function validateQualityMatrix(workspaceNames, tasks) {
  if (!Array.isArray(workspaceNames) || workspaceNames.length === 0) {
    throw new Error("workspace names must be a non-empty array");
  }

  const expectedWorkspaces = new Set();
  for (const [index, name] of workspaceNames.entries()) {
    if (typeof name !== "string" || name.trim() === "" || name !== name.trim()) {
      throw new Error(`workspace name at index ${index} is missing or empty`);
    }
    if (expectedWorkspaces.has(name)) {
      throw new Error(`workspace names contain duplicate package ${name}`);
    }
    expectedWorkspaces.add(name);
  }

  if (!Array.isArray(tasks)) {
    throw new Error("Turbo quality report must contain a tasks array");
  }

  const expectedPairs = new Set();
  for (const name of expectedWorkspaces) {
    for (const taskName of REQUIRED_TASKS) {
      expectedPairs.add(`${name}\u0000${taskName}`);
    }
  }

  const actualPairs = new Set();
  for (const [index, task] of tasks.entries()) {
    if (!isRecord(task)) {
      throw new Error(`Turbo task at index ${index} is malformed`);
    }
    if (
      typeof task.package !== "string"
      || task.package.trim() === ""
      || task.package !== task.package.trim()
    ) {
      throw new Error(`Turbo task at index ${index} is missing a package`);
    }
    if (typeof task.task !== "string" || task.task.trim() === "") {
      throw new Error(`Turbo task at index ${index} is missing a task name`);
    }
    if (task.task === "build") {
      throw new Error("quality pipeline must not schedule build tasks");
    }

    const pair = `${task.package}\u0000${task.task}`;
    if (!expectedPairs.has(pair)) {
      throw new Error(`unexpected quality task ${task.package}#${task.task}`);
    }
    if (actualPairs.has(pair)) {
      throw new Error(`duplicate quality task ${task.package}#${task.task}`);
    }
    actualPairs.add(pair);

    if (!Array.isArray(task.dependencies)) {
      throw new Error(`Turbo task ${task.package}#${task.task} has malformed dependencies`);
    }
    for (const dependency of task.dependencies) {
      if (typeof dependency !== "string") {
        throw new Error(`Turbo task ${task.package}#${task.task} has malformed dependencies`);
      }
      if (dependency.endsWith("#build")) {
        throw new Error("quality tasks must not depend on build tasks");
      }
    }

    if (typeof task.command !== "string" || task.command.trim() === "") {
      throw new Error(`quality task ${task.package}#${task.task} has an empty command`);
    }
    if (task.task === "lint" && task.command !== "eslint .") {
      throw new Error(`${task.package} lint must run ESLint exactly once`);
    }
    if (task.task === "lint" && /\btsc\b/u.test(task.command)) {
      throw new Error(`${task.package} lint must not run TypeScript`);
    }
    if (task.task === "typecheck" && !/^tsc --noEmit(?:\s|$)/u.test(task.command)) {
      throw new Error(`${task.package} typecheck must run one explicit tsc --noEmit command`);
    }
  }

  const missing = [...expectedPairs].filter((pair) => !actualPairs.has(pair));
  if (missing.length > 0) {
    throw new Error(`missing quality tasks: ${formatPairs(missing)}`);
  }

  return {
    workspaceCount: expectedWorkspaces.size,
    taskCount: tasks.length,
  };
}

/**
 * @param {string[]} pairs
 * @returns {string}
 */
function formatPairs(pairs) {
  return pairs.map((pair) => pair.replace("\u0000", "#")).join(", ");
}
