// @ts-check

/**
 * Bounded repetition of the single-task runner.
 *
 * The controller already does one task safely. Nothing ever called it twice,
 * so every session needed a human to start the next one. This closes that gap
 * and nothing else: it adds no authority, no new sandbox surface, and no
 * ability to continue past a failure.
 *
 * The decision to keep going is a pure function so the stop conditions can be
 * tested without launching an agent. A loop whose exit conditions are only
 * observable by running it is a loop nobody can reason about at three in the
 * morning, which is when this will be running.
 */

const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 20;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

/**
 * @typedef {object} LoopOptions
 * @property {boolean} execute
 * @property {boolean} review
 * @property {number} maxIterations
 * @property {number} budgetMinutes
 */
/**
 * @typedef {object} LoopState
 * @property {number} iterationsRun
 * @property {number} elapsedMinutes
 * @property {boolean} queueEmpty
 * @property {boolean | null} lastRunOk
 */
/** @typedef {{ action: "run" | "stop", reason: string }} LoopDecision */

/**
 * @param {string[]} args
 * @returns {LoopOptions}
 */
export function parseLoopOptions(args) {
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  /** @type {LoopOptions} */
  const options = { execute: false, review: false, maxIterations: 1, budgetMinutes: 60 };
  /** @type {boolean | null} */
  let reviewChoice = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--review") {
      reviewChoice = true;
    } else if (argument === "--no-review") {
      reviewChoice = false;
    } else if (argument === "--max-iterations" || argument === "--budget-minutes") {
      const raw = args[index + 1];
      index += 1;
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${argument} requires an integer`);
      }
      if (argument === "--max-iterations") {
        if (value < MIN_ITERATIONS || value > MAX_ITERATIONS) {
          throw new TypeError(`--max-iterations must be between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`);
        }
        options.maxIterations = value;
      } else {
        if (value < MIN_MINUTES || value > MAX_MINUTES) {
          throw new TypeError(`--budget-minutes must be between ${MIN_MINUTES} and ${MAX_MINUTES}`);
        }
        options.budgetMinutes = value;
      }
    } else {
      throw new TypeError(`unknown loop option ${String(argument)}`);
    }
  }

  // Running unattended without independent review is a defensible choice and a
  // deliberate one. It is not a default, in either direction: the deterministic
  // gates cannot see the class of defect review catches, and review costs model
  // calls. Make the caller say which they want.
  if (options.execute && reviewChoice === null) {
    throw new TypeError("--execute requires either --review or --no-review");
  }
  options.review = reviewChoice === true;

  return options;
}

/**
 * Whether to start another task, and why not when the answer is no.
 *
 * Order matters. A failure stops the loop before the iteration ceiling is
 * considered, so the reported reason is the interesting one rather than an
 * incidental one.
 *
 * @param {LoopOptions} options
 * @param {LoopState} state
 * @returns {LoopDecision}
 */
export function nextLoopAction(options, state) {
  if (state.lastRunOk === false) {
    return { action: "stop", reason: "previous task failed; evidence left for inspection" };
  }
  if (state.queueEmpty) {
    return { action: "stop", reason: "no selectable task remains" };
  }
  if (state.iterationsRun >= options.maxIterations) {
    return { action: "stop", reason: `iteration ceiling of ${options.maxIterations} reached` };
  }
  if (state.elapsedMinutes >= options.budgetMinutes) {
    return { action: "stop", reason: `time budget of ${options.budgetMinutes} minutes spent` };
  }
  return { action: "run", reason: "a selectable task remains within budget" };
}
