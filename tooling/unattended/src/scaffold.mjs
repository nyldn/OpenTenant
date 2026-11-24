// @ts-check

/**
 * Turning a sentence into a well-formed task.
 *
 * A task has thirteen fields and most of them are the same every time. Writing
 * them by hand is why nobody writes them, and an empty queue is the reason the
 * controller sat idle for a fortnight. This asks for the four things that
 * genuinely differ per task and derives the rest.
 *
 * The derived parts are conservative on purpose. Priority sits behind existing
 * work rather than ahead of it, the timeout is the low end of the permitted
 * range, and verification is the full sweep. A scaffold should be the least
 * surprising task that could satisfy the request; sharpening it is the author's
 * job, and the plan reviewer will say so if they have not.
 */

const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_VERIFICATION = [["pnpm", "turbo", "run", "typecheck", "lint", "test"]];
const ID_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * @typedef {object} ScaffoldInput
 * @property {string} id
 * @property {string} title
 * @property {string} objective
 * @property {string} source
 * @property {string[]} allowedPaths
 * @property {string[]} [acceptanceCriteria]
 * @property {string[]} [dependencies]
 * @property {"fix" | "spec"} [lane]
 * @property {number} [priority]
 * @property {number} [timeoutMinutes]
 * @property {string[][]} [verification]
 */

/**
 * @param {unknown} inputValue
 * @param {{ existingPriorities?: number[] }} [context]
 * @returns {import("./backlog.mjs").UnattendedTask}
 */
export function scaffoldTask(inputValue, context = {}) {
  if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
    throw new TypeError("scaffold input must be an object");
  }
  const input = /** @type {Record<string, unknown>} */ (inputValue);

  const id = requireNonEmptyString(input.id, "id");
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(`id ${id} must look like AREA-01, so the backlog stays scannable`);
  }

  const allowedPaths = Array.isArray(input.allowedPaths) ? input.allowedPaths : [];
  if (allowedPaths.length === 0) {
    // Refused rather than defaulted. A task that may write anywhere is exactly
    // the task the path scope exists to prevent, and a default would be the
    // widest possible one.
    throw new TypeError("allowedPaths must name at least one directory; there is no safe default");
  }

  const lane = input.lane === undefined ? "fix" : input.lane;
  if (lane !== "fix" && lane !== "spec") {
    throw new TypeError('lane must be "fix" or "spec"');
  }

  const existing = context.existingPriorities ?? [];
  const priority = input.priority === undefined
    ? (existing.length === 0 ? 100 : Math.max(...existing) + 10)
    : input.priority;

  const acceptanceCriteria = Array.isArray(input.acceptanceCriteria) && input.acceptanceCriteria.length > 0
    ? input.acceptanceCriteria
    : [
      // A placeholder that fails review is better than a placeholder that
      // passes it. This one is deliberately unsatisfiable as written.
      `REPLACE ME: state the observable behaviour that proves "${requireNonEmptyString(input.objective, "objective")}" is done`,
    ];

  return /** @type {import("./backlog.mjs").UnattendedTask} */ ({
    id,
    priority,
    title: requireNonEmptyString(input.title, "title"),
    lane,
    status: "pending",
    objective: requireNonEmptyString(input.objective, "objective"),
    source: requireNonEmptyString(input.source, "source"),
    acceptanceCriteria,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    ownerGate: false,
    allowedPaths,
    timeoutMinutes: input.timeoutMinutes === undefined ? DEFAULT_TIMEOUT_MINUTES : input.timeoutMinutes,
    verification: Array.isArray(input.verification) && input.verification.length > 0
      ? input.verification
      : DEFAULT_VERIFICATION,
  });
}
