// @ts-check

import { execFileSync } from "node:child_process";

/**
 * Independent model review of a plan before it runs, and of the work after.
 *
 * The controller's existing gates are deterministic and catch the things
 * determinism catches: dirty worktrees, out-of-scope paths, failed commands, a
 * task contract edited mid-run. On 2026-08-02 two real defects passed all of
 * them. One was a false claim committed into a handoff, asserting no prompt
 * assembly existed in a repository that has one. The other was a citation
 * boundary hole that let a cited span be truncated so it asserted the opposite
 * of its source. Both were found by a second model reading the work. No
 * verification command in the backlog would ever have found either.
 *
 * The rule this module enforces is narrow and deliberate: **a reviewer can only
 * ever block.** It cannot approve, cannot promote a task, and cannot shorten
 * any existing check. Passing review means the deterministic gates still have
 * to pass afterwards. This mirrors the standing prohibition on a model acting
 * as a certifying gate, from the AI Support Agent PRD: a model may rank or
 * comment, it may not be the gate. A veto is not a certification.
 *
 * Everything here is pure. Invoking a reviewer is a separate adapter, so the
 * gate semantics can be tested without a model, a network, or an API key.
 */

/**
 * @typedef {object} ReviewFinding
 * @property {string} summary
 * @property {string} [evidence]
 */
/**
 * @typedef {object} ReviewVerdict
 * @property {string} reviewer
 * @property {boolean} blocking
 * @property {ReviewFinding[]} findings
 * @property {string} [note]
 */

const MAX_FINDINGS = 20;

/**
 * The response contract, stated to the reviewer verbatim.
 *
 * Reviewers are asked to default to blocking when uncertain. The cost of a
 * false block is a human looking at a task; the cost of a false pass is
 * unreviewed work compounding overnight.
 */
const RESPONSE_CONTRACT = [
  "Reply with one JSON object and nothing else:",
  '{"blocking": boolean, "findings": [{"summary": string, "evidence": string}], "note": string}',
  "",
  "Set blocking true when you find a defect that should stop this work, when a",
  "claim in it is unverified, or when you are not certain. You cannot approve",
  "anything; a non-blocking verdict only means you found no reason to stop.",
  "Deterministic checks run after you regardless.",
].join("\n");

/**
 * @param {import("./backlog.mjs").UnattendedTask} task
 * @returns {string}
 */
export function buildPlanReviewPrompt(task) {
  return [
    "You are reviewing a task specification before an autonomous agent executes it.",
    "You are not writing code and you have no access to the repository.",
    "",
    "Judge only these questions:",
    "1. Do the acceptance criteria actually determine whether the objective was met,",
    "   or could work satisfy them while missing the point?",
    "2. Do the verification commands check the behaviour the criteria describe, or do",
    "   they merely check that something ran?",
    "3. Does the objective assert anything as established fact that the agent would",
    "   have to take on trust rather than verify?",
    "4. Are the allowed paths sufficient for the objective, and no wider?",
    "",
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Source: ${task.source}`,
    `Allowed paths: ${task.allowedPaths.join(", ")}`,
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "Verification commands:",
    ...task.verification.map((command) => `- ${command.join(" ")}`),
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}

/**
 * @param {import("./backlog.mjs").UnattendedTask} task
 * @param {string} diff
 * @returns {string}
 */
export function buildWorkReviewPrompt(task, diff) {
  return [
    "You are reviewing completed work by an autonomous agent, before it is accepted.",
    "Deterministic checks have already passed, so do not re-run them or report their",
    "absence. Look for what they cannot see.",
    "",
    "Judge only these questions:",
    "1. Does any comment, commit message, or document in this diff assert something",
    "   about the repository that the diff itself does not establish?",
    "2. Does any test assert the implementation rather than the behaviour, so that it",
    "   would pass against a broken implementation?",
    "3. Does the change do something the task did not ask for?",
    "4. Is there a defect here that passing tests would not reveal?",
    "",
    `Task id: ${task.id}`,
    `Objective: ${task.objective}`,
    "",
    "Diff:",
    diff,
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}

/**
 * Parses a reviewer's reply into a verdict.
 *
 * Anything unparseable is a blocking verdict rather than an error, because a
 * reviewer that produced noise has not reviewed anything, and treating silence
 * as assent is exactly the failure this module exists to prevent.
 *
 * @param {string} reviewer
 * @param {unknown} raw
 * @returns {ReviewVerdict}
 */
export function parseReviewVerdict(reviewer, raw) {
  if (typeof reviewer !== "string" || reviewer.trim() === "") {
    throw new TypeError("reviewer must be a non-empty string");
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return { reviewer, blocking: true, findings: [], note: "reviewer returned nothing" };
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { reviewer, blocking: true, findings: [], note: "reviewer returned no JSON object" };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { reviewer, blocking: true, findings: [], note: "reviewer returned invalid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { reviewer, blocking: true, findings: [], note: "reviewer verdict was not an object" };
  }

  const record = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof record.blocking !== "boolean") {
    return { reviewer, blocking: true, findings: [], note: "reviewer omitted a boolean blocking field" };
  }

  /** @type {ReviewFinding[]} */
  const findings = [];
  if (Array.isArray(record.findings)) {
    for (const entry of record.findings.slice(0, MAX_FINDINGS)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const finding = /** @type {Record<string, unknown>} */ (entry);
      if (typeof finding.summary !== "string" || finding.summary.trim() === "") continue;
      findings.push(
        typeof finding.evidence === "string" && finding.evidence.trim() !== ""
          ? { summary: finding.summary, evidence: finding.evidence }
          : { summary: finding.summary },
      );
    }
  }

  // A reviewer that says "blocking" and names nothing has still blocked. The
  // missing detail is a note, not a reason to discard the veto.
  const verdict = { reviewer, blocking: record.blocking, findings };
  return typeof record.note === "string" && record.note.trim() !== ""
    ? { ...verdict, note: record.note }
    : verdict;
}

/**
 * Combines reviewer verdicts into a gate result.
 *
 * Any single block stops the work. Reviewers are not polled for a majority,
 * because they are looking for different things and a defect one finds is not
 * made less real by another missing it.
 *
 * An empty verdict set blocks. That case means every reviewer failed to run,
 * and a review stage that silently becomes a no-op when the CLI is missing is
 * worse than no review stage at all.
 *
 * @param {ReviewVerdict[]} verdicts
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateReviewGate(verdicts) {
  if (!Array.isArray(verdicts)) throw new TypeError("verdicts must be an array");
  if (verdicts.length === 0) {
    return { ok: false, reasons: ["no reviewer produced a verdict"] };
  }

  /** @type {string[]} */
  const reasons = [];
  for (const verdict of verdicts) {
    if (!verdict.blocking) continue;
    const detail = verdict.findings.length > 0
      ? verdict.findings.map((finding) => finding.summary).join("; ")
      : verdict.note ?? "no detail given";
    reasons.push(`${verdict.reviewer}: ${detail}`);
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Applies a stage's gate policy to its verdicts.
 *
 * The two stages are not symmetric, and treating them as if they were is what
 * five consecutive blocked rounds on one small task demonstrated.
 *
 * **Work review blocks.** The diff is fixed, the question is whether it is
 * sound, and "I am not certain" is a good reason to stop before accepting it.
 *
 * **Plan review advises.** A specification is not a finished artefact, every
 * spec can be criticised, and each fix exposes a fresh seam, so a reviewer told
 * to block on uncertainty will block indefinitely. Findings are recorded and
 * surfaced; they do not stop the run. This is a deliberate weakening of the
 * plan stage and not of the work stage: no unreviewed diff is ever accepted,
 * which is the property that matters.
 *
 * @param {"plan" | "work"} stage
 * @param {ReviewVerdict[]} verdicts
 * @returns {{ stage: "plan" | "work", blocking: boolean, ok: boolean, reasons: string[] }}
 */
export function summariseReview(stage, verdicts) {
  if (stage !== "plan" && stage !== "work") {
    throw new TypeError(`unknown review stage ${String(stage)}`);
  }
  const gate = evaluateReviewGate(verdicts);
  if (stage === "work") {
    return { stage, blocking: true, ok: gate.ok, reasons: gate.reasons };
  }
  // Reasons are still reported. Advisory means it does not stop the run, not
  // that nobody hears it.
  return { stage, blocking: false, ok: true, reasons: gate.reasons };
}

/**
 * The reviewer commands, as argv arrays. The prompt is never an argument.
 *
 * Both CLIs read instructions from stdin, and that is the only safe way to pass
 * them. The first live run of this module put the prompt in argv, where
 * `--allowedTools ""` consumed it as its own value and the reviewer exited
 * without ever seeing the task. It blocked, correctly, but on a defect in this
 * file rather than in the work under review. Stdin also removes an argv length
 * limit that a large diff would eventually hit.
 *
 * Both run read-only and neither is given repository write access. Plan review
 * needs no repository at all: its entire input is the prompt.
 *
 * @param {"codex" | "fable"} reviewer
 * @returns {string[]}
 */
export function reviewerCommand(reviewer) {
  if (reviewer === "codex") {
    return ["codex", "exec", "--sandbox", "read-only"];
  }
  if (reviewer === "fable") {
    // No tools at all. The reviewer reads the prompt and answers; it does not
    // go looking, so it cannot edit, fetch, or run anything.
    return ["claude", "-p", "--model", "claude-fable-5", "--allowedTools", ""];
  }
  throw new TypeError(`unknown reviewer ${String(reviewer)}`);
}

const REVIEWERS = /** @type {const} */ (["codex", "fable"]);
const REVIEW_TIMEOUT_MS = 10 * 60_000;
const MAX_REVIEW_OUTPUT = 2_000_000;

/**
 * Runs every reviewer and collects verdicts. The only impure function here.
 *
 * A reviewer that crashes, times out, or is not installed yields a blocking
 * verdict rather than an exception. The gate must never fail open because a CLI
 * is missing from the machine that happens to be running the loop.
 *
 * @param {string} prompt
 * @param {{ cwd: string, timeoutMs?: number }} options
 * @returns {ReviewVerdict[]}
 */
export function runReviewers(prompt, options) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new TypeError("prompt must be a non-empty string");
  }
  /** @type {ReviewVerdict[]} */
  const verdicts = [];
  for (const reviewer of REVIEWERS) {
    const [command, ...args] = reviewerCommand(reviewer);
    try {
      const output = execFileSync(/** @type {string} */ (command), args, {
        cwd: options.cwd,
        encoding: "utf8",
        input: prompt,
        timeout: options.timeoutMs ?? REVIEW_TIMEOUT_MS,
        maxBuffer: MAX_REVIEW_OUTPUT,
        stdio: ["pipe", "pipe", "pipe"],
      });
      verdicts.push(parseReviewVerdict(reviewer, output));
    } catch (error) {
      verdicts.push({
        reviewer,
        blocking: true,
        findings: [],
        note: `reviewer did not complete: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return verdicts;
}
