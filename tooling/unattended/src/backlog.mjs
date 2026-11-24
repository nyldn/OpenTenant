// @ts-check

import { isDeepStrictEqual } from "node:util";

const TASK_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "not_verified",
]);
const TASK_LANES = new Set(["fix", "spec", "owner"]);
const TASK_EXECUTION_MODES = new Set(["unattended", "supervised"]);
const VERIFICATION_EXECUTABLES = new Set(["git", "graphify", "node", "pnpm"]);
const CONTROLLER_PROTECTED_PATHS = ["tooling/unattended/src", "tooling/ci", "tooling/db-ephemeral"];

/** @typedef {"pending" | "in_progress" | "completed" | "blocked" | "not_verified"} TaskStatus */
/** @typedef {"fix" | "spec" | "owner"} TaskLane */
/** @typedef {"unattended" | "supervised"} TaskExecutionMode */
/**
 * @typedef {object} UnattendedTask
 * @property {string} id
 * @property {number} priority
 * @property {string} title
 * @property {TaskLane} lane
 * @property {TaskExecutionMode} [executionMode]
 * @property {TaskStatus} status
 * @property {string} objective
 * @property {string} source
 * @property {string[]} acceptanceCriteria
 * @property {string[]} dependencies
 * @property {boolean} ownerGate
 * @property {string[]} allowedPaths
 * @property {number} timeoutMinutes
 * @property {number} [premiseVerificationCount]
 * @property {string[][]} verification
 */
/**
 * A question that is in scope but not yet sharp enough to be a task.
 *
 * Borrowed from the wayfinder skill's "fog of war". Without somewhere to put
 * these they end up in prose handoffs, which is how this repository ended up
 * with an open-work list that advertised four already-merged pull requests.
 * Fog is never selectable and carries no verification, because a question you
 * cannot phrase sharply cannot be checked either.
 *
 * @typedef {object} UnattendedFog
 * @property {string} id
 * @property {string} question
 * @property {string} raisedAt
 * @property {string[]} notes
 */
/**
 * @typedef {object} UnattendedBacklog
 * @property {1} version
 * @property {string} updatedAt
 * @property {UnattendedTask[]} tasks
 * @property {UnattendedFog[]} [fog]
 */

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/** @param {unknown} value @param {string} label */
function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  for (const item of value) requireNonEmptyString(item, `${label} item`);
}

/** @param {unknown} value @returns {UnattendedBacklog} */
export function validateBacklog(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("backlog must be an object");
  }

  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.version !== 1) throw new TypeError("backlog version must be 1");
  requireNonEmptyString(record.updatedAt, "updatedAt");
  if (!Array.isArray(record.tasks)) throw new TypeError("tasks must be an array");

  /** @type {UnattendedTask[]} */
  const tasks = [];
  const ids = new Set();
  for (const [index, raw] of record.tasks.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new TypeError(`task ${index + 1} must be an object`);
    }
    const candidate = /** @type {Record<string, unknown>} */ (raw);
    requireNonEmptyString(candidate.id, `task ${index + 1} id`);
    const id = /** @type {string} */ (candidate.id);
    if (ids.has(id)) throw new TypeError(`duplicate task id ${id}`);
    ids.add(id);

    if (!Number.isSafeInteger(candidate.priority) || Number(candidate.priority) < 0) {
      throw new TypeError(`${id} priority must be a non-negative integer`);
    }
    requireNonEmptyString(candidate.title, `${id} title`);
    requireNonEmptyString(candidate.objective, `${id} objective`);
    requireNonEmptyString(candidate.source, `${id} source`);
    requireStringArray(candidate.acceptanceCriteria, `${id} acceptanceCriteria`);
    if (!Array.isArray(candidate.dependencies)) {
      throw new TypeError(`${id} dependencies must be an array`);
    }
    for (const dependency of candidate.dependencies) {
      requireNonEmptyString(dependency, `${id} dependency`);
    }
    if (!TASK_LANES.has(String(candidate.lane))) {
      throw new TypeError(`${id} has invalid lane ${String(candidate.lane)}`);
    }
    const executionMode = candidate.executionMode ?? "unattended";
    if (!TASK_EXECUTION_MODES.has(String(executionMode))) {
      throw new TypeError(`${id} has invalid executionMode ${String(executionMode)}`);
    }
    if (!TASK_STATUSES.has(String(candidate.status))) {
      throw new TypeError(`${id} has invalid status ${String(candidate.status)}`);
    }
    if (typeof candidate.ownerGate !== "boolean") {
      throw new TypeError(`${id} ownerGate must be boolean`);
    }
    requireStringArray(candidate.allowedPaths, `${id} allowedPaths`);
    const allowedPaths = /** @type {string[]} */ (candidate.allowedPaths);
    for (const allowedPath of allowedPaths) {
      const segments = allowedPath.split("/");
      const normalizedPath = allowedPath.replace(/\/+$/u, "");
      if (
        allowedPath.startsWith("/") ||
        allowedPath.includes("\\") ||
        segments.includes("..") ||
        segments.includes(".git")
      ) {
        throw new TypeError(`${id} has unsafe allowed path ${allowedPath}`);
      }
      if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
        throw new TypeError(`${id} has secret-bearing path ${allowedPath}`);
      }
      if (executionMode !== "supervised" && CONTROLLER_PROTECTED_PATHS.some((protectedPath) =>
        protectedPath === normalizedPath
        || protectedPath.startsWith(`${normalizedPath}/`)
        || normalizedPath.startsWith(`${protectedPath}/`)
      )) {
        throw new TypeError(`${id} has controller-protected path ${allowedPath}`);
      }
    }
    if (
      !Number.isSafeInteger(candidate.timeoutMinutes) ||
      Number(candidate.timeoutMinutes) < 5 ||
      Number(candidate.timeoutMinutes) > 120
    ) {
      throw new TypeError(`${id} timeoutMinutes must be between 5 and 120`);
    }
    if (!Array.isArray(candidate.verification) || candidate.verification.length === 0) {
      throw new TypeError(`${id} verification must be a non-empty array`);
    }
    for (const command of candidate.verification) {
      if (!Array.isArray(command) || command.length === 0) {
        throw new TypeError(`${id} verification command must be a non-empty argv array`);
      }
      for (const argument of command) {
        requireNonEmptyString(argument, `${id} verification argument`);
        if (argument.includes("\0") || argument.includes("\n") || argument.includes("\r")) {
          throw new TypeError(`${id} verification arguments cannot contain control characters`);
        }
      }
      if (!VERIFICATION_EXECUTABLES.has(command[0])) {
        throw new TypeError(`unsupported verification executable ${command[0]}`);
      }
    }
    const premiseVerificationCount = candidate.premiseVerificationCount ?? 0;
    if (
      !Number.isSafeInteger(premiseVerificationCount)
      || Number(premiseVerificationCount) < 0
      || Number(premiseVerificationCount) > candidate.verification.length
    ) {
      throw new TypeError(
        `${id} premiseVerificationCount must be between 0 and ${candidate.verification.length}`,
      );
    }

    tasks.push(/** @type {UnattendedTask} */ (raw));
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new TypeError(`${task.id} has unknown dependency ${dependency}`);
      if (dependency === task.id) throw new TypeError(`${task.id} cannot depend on itself`);
    }
    if (task.lane === "owner" && !task.ownerGate) {
      throw new TypeError(`${task.id} owner-lane work must be owner-gated`);
    }
  }

  if (record.fog !== undefined) {
    if (!Array.isArray(record.fog)) throw new TypeError("fog must be an array");
    const fogIds = new Set();
    for (const [index, raw] of record.fog.entries()) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new TypeError(`fog ${index + 1} must be an object`);
      }
      const entry = /** @type {Record<string, unknown>} */ (raw);
      requireNonEmptyString(entry.id, `fog ${index + 1} id`);
      const fogId = /** @type {string} */ (entry.id);
      if (fogIds.has(fogId)) throw new TypeError(`duplicate fog id ${fogId}`);
      // One namespace for both, so a graduated question keeps its identity and
      // cannot silently coexist with the task it became.
      if (ids.has(fogId)) throw new TypeError(`fog ${fogId} collides with a task id`);
      fogIds.add(fogId);
      requireNonEmptyString(entry.question, `${fogId} question`);
      requireNonEmptyString(entry.raisedAt, `${fogId} raisedAt`);
      if (!Array.isArray(entry.notes)) throw new TypeError(`${fogId} notes must be an array`);
      for (const note of entry.notes) requireNonEmptyString(note, `${fogId} note`);
    }
  }

  return /** @type {UnattendedBacklog} */ (value);
}

/** @param {unknown} value @returns {UnattendedTask | undefined} */
export function selectNextTask(value) {
  const backlog = validateBacklog(value);
  const completed = new Set(
    backlog.tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );

  return backlog.tasks
    .filter(
      (task) =>
        task.status === "pending" &&
        task.executionMode !== "supervised" &&
        task.lane !== "owner" &&
        !task.ownerGate &&
        task.dependencies.every((dependency) => completed.has(dependency)),
    )
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
}

/** @param {unknown} value @returns {UnattendedTask | undefined} */
export function selectNextSupervisedTask(value) {
  const backlog = validateBacklog(value);
  const completed = new Set(
    backlog.tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );

  return backlog.tasks
    .filter(
      (task) =>
        task.status === "pending" &&
        task.executionMode === "supervised" &&
        task.lane !== "owner" &&
        !task.ownerGate &&
        task.dependencies.every((dependency) => completed.has(dependency)),
    )
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
}

/** @param {unknown} value @returns {UnattendedTask | undefined} */
export function selectVerificationTask(value) {
  return validateBacklog(value).tasks
    .filter(
      (task) =>
        task.status === "not_verified" &&
        task.executionMode !== "supervised" &&
        task.lane !== "owner" &&
        !task.ownerGate,
    )
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
}

/** @param {unknown} beforeValue @param {unknown} afterValue @param {string} activeTaskId */
export function evaluateBacklogTransition(beforeValue, afterValue, activeTaskId) {
  const before = validateBacklog(beforeValue);
  const after = validateBacklog(afterValue);
  /** @type {string[]} */
  const reasons = [];
  if (
    before.tasks.length !== after.tasks.length ||
    before.tasks.some((task, index) => after.tasks[index]?.id !== task.id)
  ) {
    reasons.push(`task set or order changed during ${activeTaskId}`);
    return { ok: false, reasons };
  }

  before.tasks.forEach((beforeTask, index) => {
    const afterTask = after.tasks[index];
    if (!afterTask) return;
    if (beforeTask.id !== activeTaskId) {
      if (!isDeepStrictEqual(beforeTask, afterTask)) {
        reasons.push(`task ${beforeTask.id} contract changed during ${activeTaskId}`);
      }
      return;
    }
    const { status: beforeStatus, ...beforeContract } = beforeTask;
    const { status: afterStatus, ...afterContract } = afterTask;
    void beforeStatus;
    void afterStatus;
    if (!isDeepStrictEqual(beforeContract, afterContract)) {
      reasons.push(`task ${beforeTask.id} contract changed outside status during ${activeTaskId}`);
    }
  });

  return { ok: reasons.length === 0, reasons };
}
