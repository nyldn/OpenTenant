// @ts-check

import { validateBacklog } from "./backlog.mjs";

/**
 * Appending work to the backlog, under rules an agent cannot talk its way past.
 *
 * The controller already refuses to let an agent edit a task contract mid-run.
 * This is the other end of the same problem: how work gets into the queue at
 * all. Today that is a human writing JSON by hand, which is why the queue runs
 * dry and stays dry.
 *
 * A proposal is deliberately weaker than a task. It cannot create an owner
 * gate, cannot start in any state but `pending`, and cannot arrive without
 * verification commands, because a task with nothing to check is a task the
 * controller can never promote.
 */

const PROPOSABLE_LANES = new Set(["fix", "spec"]);

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/**
 * Rules a proposal must satisfy beyond ordinary task validity.
 *
 * @param {Record<string, unknown>} draft
 */
function assertProposable(draft) {
  if (draft.ownerGate !== false) {
    throw new TypeError("a proposal cannot create an owner gate");
  }
  if (!PROPOSABLE_LANES.has(String(draft.lane))) {
    throw new TypeError(`a proposal must be lane ${[...PROPOSABLE_LANES].join(" or ")}`);
  }
  if (draft.status !== "pending") {
    throw new TypeError("a proposal must start pending");
  }
}

/**
 * Appends one proposed task to a backlog and returns the new backlog.
 *
 * Validation runs over the whole result rather than the draft alone, so a
 * proposal that is individually well formed but breaks the backlog, by
 * colliding with an existing id or naming a dependency that does not exist,
 * fails here rather than at selection time.
 *
 * @param {unknown} backlogValue
 * @param {unknown} draftValue
 * @param {string} updatedAt
 * @returns {import("./backlog.mjs").UnattendedBacklog}
 */
export function proposeTask(backlogValue, draftValue, updatedAt) {
  const backlog = validateBacklog(backlogValue);
  if (typeof draftValue !== "object" || draftValue === null || Array.isArray(draftValue)) {
    throw new TypeError("proposal must be an object");
  }
  const draft = /** @type {Record<string, unknown>} */ (draftValue);
  requireNonEmptyString(draft.id, "proposal id");
  requireNonEmptyString(updatedAt, "updatedAt");
  assertProposable(draft);

  if (backlog.tasks.some((task) => task.id === draft.id)) {
    throw new TypeError(`task ${String(draft.id)} already exists`);
  }

  return validateBacklog({
    ...backlog,
    updatedAt,
    tasks: [...backlog.tasks, draft],
  });
}

/**
 * Records a question that is in scope but not yet sharp enough to be a task.
 *
 * @param {unknown} backlogValue
 * @param {unknown} entryValue
 * @param {string} updatedAt
 * @returns {import("./backlog.mjs").UnattendedBacklog}
 */
export function recordFog(backlogValue, entryValue, updatedAt) {
  const backlog = validateBacklog(backlogValue);
  if (typeof entryValue !== "object" || entryValue === null || Array.isArray(entryValue)) {
    throw new TypeError("fog entry must be an object");
  }
  requireNonEmptyString(updatedAt, "updatedAt");
  const fog = backlog.fog ?? [];
  return validateBacklog({ ...backlog, updatedAt, fog: [...fog, entryValue] });
}

/**
 * Turns a fog entry into a task, removing the question in the same operation.
 *
 * Doing both at once is the point. Wayfinder's rule is that a decision lives in
 * exactly one place; a graduation that left the question behind would create a
 * second copy that drifts from the task it became.
 *
 * @param {unknown} backlogValue
 * @param {string} fogId
 * @param {unknown} draftValue
 * @param {string} updatedAt
 * @returns {import("./backlog.mjs").UnattendedBacklog}
 */
export function graduateFog(backlogValue, fogId, draftValue, updatedAt) {
  const backlog = validateBacklog(backlogValue);
  requireNonEmptyString(fogId, "fogId");
  const fog = backlog.fog ?? [];
  if (!fog.some((entry) => entry.id === fogId)) {
    throw new TypeError(`unknown fog entry ${fogId}`);
  }
  const withoutEntry = { ...backlog, fog: fog.filter((entry) => entry.id !== fogId) };
  return proposeTask(withoutEntry, draftValue, updatedAt);
}
