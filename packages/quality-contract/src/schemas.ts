/**
 * Phase 0 of the Module Improvement Lab: the six quality-contract schemas from
 * the PRD section 9, with the section 6.1 and 6.2 rules encoded as validation
 * rather than left as prose.
 *
 * Two properties matter more than the field lists and are enforced here:
 *
 * - Every element declares an owner. Platform-owned elements are the mandatory
 *   checks workspace code cannot weaken. Ownership is what makes the section
 *   6.1 rule checkable at all, so it is required, never inferred.
 * - Evidence declarations are restricted to the section 6.2 eligible kinds and
 *   refuse the prohibited ones by name. Unknown kinds fail closed.
 */

/**
 * Platform-owned elements are the mandatory checks. Workspace code may add its
 * own elements freely; it may never remove or relax a platform-owned one.
 */
export type ContractOwner = "platform" | "workspace";

/**
 * The assertion families section 6.1 requires a contract to carry. Functional
 * and business outcomes sit alongside the security, privacy, isolation,
 * authorization, accessibility and usability assertions, because they are all
 * pass-or-fail statements evaluated the same way.
 */
export type OutcomeKind =
  | "functional"
  | "business"
  | "security"
  | "privacy"
  | "tenant_isolation"
  | "authorization"
  | "accessibility"
  | "usability";

export interface OutcomeSchema {
  readonly id: string;
  readonly owner: ContractOwner;
  readonly kind: OutcomeKind;
  readonly statement: string;
  /** A required outcome must pass. Demoting one to optional is a weakening. */
  readonly required: boolean;
}

/** A simulated user journey and the synthetic fixture that drives it. */
export interface JourneySchema {
  readonly id: string;
  readonly owner: ContractOwner;
  readonly fixtureId: string;
  readonly steps: readonly string[];
  readonly assertedOutcomeIds: readonly string[];
}

export type MetricDirection = "higher_is_better" | "lower_is_better";

/**
 * A regression benchmark derived from an approved past failure. These are
 * permanent regardless of owner: the failure they encode already happened once,
 * so removing one is always a weakening, even by the party that added it.
 */
export interface BenchmarkSchema {
  readonly id: string;
  readonly owner: ContractOwner;
  readonly derivedFromFailureId: string;
  readonly metric: string;
  readonly direction: MetricDirection;
  readonly threshold: number;
}

/**
 * A guardrail metric and the trade-off it exists to refuse. The prose field is
 * required because a bound with no stated trade-off cannot be reviewed against
 * the risk in PRD section 11 that it was added to mitigate.
 */
export interface GuardrailSchema {
  readonly id: string;
  readonly owner: ContractOwner;
  readonly metric: string;
  readonly direction: MetricDirection;
  readonly bound: number;
  readonly unacceptableTradeOff: string;
}

/** Section 6.2 eligible inputs, exhaustively. */
export const ELIGIBLE_EVIDENCE_KINDS = [
  "structured_module_error",
  "module_health_signal",
  "redacted_interaction_trace",
  "support_issue_category",
  "confirmed_incident_summary",
  "explicit_user_feedback",
  "task_completion_outcome",
  "tenant_approved_business_outcome",
  "performance_measure",
  "accessibility_measure",
  "reliability_measure",
  "release_outcome",
  "rollback_outcome",
] as const;

export type EligibleEvidenceKind = (typeof ELIGIBLE_EVIDENCE_KINDS)[number];

/**
 * Section 6.2 prohibited inputs, named so the validator can refuse them with a
 * specific message instead of a generic "unknown kind". Anything not in the
 * eligible list is refused either way; naming these makes the refusal legible
 * to whoever wrote the contract.
 */
export const PROHIBITED_EVIDENCE_KINDS = [
  "raw_request_body",
  "free_form_tenant_content",
  "credential",
  "authentication_material",
  "database_row",
  "unrestricted_prompt",
] as const;

export type ProhibitedEvidenceKind = (typeof PROHIBITED_EVIDENCE_KINDS)[number];

export interface EvidenceSchema {
  readonly id: string;
  readonly owner: ContractOwner;
  readonly kind: EligibleEvidenceKind;
  /** Purpose limitation is stated per declaration, not per contract. */
  readonly purpose: string;
  readonly redactionPolicyVersion: string;
  readonly retentionDays: number;
}

/**
 * How a candidate is compared with its baseline. `minimumEffect` is the
 * threshold below which a difference is reported as no change rather than an
 * improvement, so a candidate cannot be accepted on noise.
 */
export interface ComparisonSchema {
  readonly primaryMetric: string;
  readonly direction: MetricDirection;
  readonly minimumEffect: number;
  readonly guardrailIds: readonly string[];
}

export class QualityContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityContractValidationError";
  }
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_TEXT_LENGTH = 2000;
const MAX_RETENTION_DAYS = 3650;

function fail(message: string): never {
  throw new QualityContractValidationError(message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail(`${field} must be a lowercase dotted identifier of 1 to 128 characters`);
  }
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(`${field} must not be empty`);
  if (trimmed.length > MAX_TEXT_LENGTH) fail(`${field} must be at most ${MAX_TEXT_LENGTH} characters`);
  return trimmed;
}

function owner(value: unknown, field: string): ContractOwner {
  if (value !== "platform" && value !== "workspace") {
    fail(`${field} must be "platform" or "workspace"`);
  }
  return value;
}

function direction(value: unknown, field: string): MetricDirection {
  if (value !== "higher_is_better" && value !== "lower_is_better") {
    fail(`${field} must be "higher_is_better" or "lower_is_better"`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${field} must be a finite number`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`${field} must be a boolean`);
  return value;
}

function list(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

const OUTCOME_KINDS: readonly OutcomeKind[] = [
  "functional",
  "business",
  "security",
  "privacy",
  "tenant_isolation",
  "authorization",
  "accessibility",
  "usability",
];

export function validateOutcome(input: unknown): OutcomeSchema {
  if (typeof input !== "object" || input === null) fail("outcome must be an object");
  const source = input as Record<string, unknown>;
  const kind = source["kind"];
  if (typeof kind !== "string" || !OUTCOME_KINDS.includes(kind as OutcomeKind)) {
    fail(`outcome.kind must be one of ${OUTCOME_KINDS.join(", ")}`);
  }
  return {
    id: identifier(source["id"], "outcome.id"),
    owner: owner(source["owner"], "outcome.owner"),
    kind: kind as OutcomeKind,
    statement: text(source["statement"], "outcome.statement"),
    required: boolean(source["required"], "outcome.required"),
  };
}

export function validateJourney(input: unknown): JourneySchema {
  if (typeof input !== "object" || input === null) fail("journey must be an object");
  const source = input as Record<string, unknown>;
  const steps = list(source["steps"], "journey.steps").map((step, index) =>
    text(step, `journey.steps[${index}]`),
  );
  if (steps.length === 0) fail("journey.steps must contain at least one step");
  const assertedOutcomeIds = list(
    source["assertedOutcomeIds"],
    "journey.assertedOutcomeIds",
  ).map((id, index) => identifier(id, `journey.assertedOutcomeIds[${index}]`));
  if (assertedOutcomeIds.length === 0) {
    fail("journey.assertedOutcomeIds must reference at least one outcome");
  }
  return {
    id: identifier(source["id"], "journey.id"),
    owner: owner(source["owner"], "journey.owner"),
    fixtureId: identifier(source["fixtureId"], "journey.fixtureId"),
    steps,
    assertedOutcomeIds,
  };
}

export function validateBenchmark(input: unknown): BenchmarkSchema {
  if (typeof input !== "object" || input === null) fail("benchmark must be an object");
  const source = input as Record<string, unknown>;
  return {
    id: identifier(source["id"], "benchmark.id"),
    owner: owner(source["owner"], "benchmark.owner"),
    derivedFromFailureId: identifier(
      source["derivedFromFailureId"],
      "benchmark.derivedFromFailureId",
    ),
    metric: identifier(source["metric"], "benchmark.metric"),
    direction: direction(source["direction"], "benchmark.direction"),
    threshold: finiteNumber(source["threshold"], "benchmark.threshold"),
  };
}

export function validateGuardrail(input: unknown): GuardrailSchema {
  if (typeof input !== "object" || input === null) fail("guardrail must be an object");
  const source = input as Record<string, unknown>;
  return {
    id: identifier(source["id"], "guardrail.id"),
    owner: owner(source["owner"], "guardrail.owner"),
    metric: identifier(source["metric"], "guardrail.metric"),
    direction: direction(source["direction"], "guardrail.direction"),
    bound: finiteNumber(source["bound"], "guardrail.bound"),
    unacceptableTradeOff: text(
      source["unacceptableTradeOff"],
      "guardrail.unacceptableTradeOff",
    ),
  };
}

export function validateEvidence(input: unknown): EvidenceSchema {
  if (typeof input !== "object" || input === null) fail("evidence must be an object");
  const source = input as Record<string, unknown>;
  const kind = source["kind"];
  if (typeof kind !== "string") fail("evidence.kind must be a string");
  if ((PROHIBITED_EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    fail(`evidence.kind "${kind}" is a prohibited input under PRD section 6.2`);
  }
  if (!(ELIGIBLE_EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    fail(`evidence.kind "${kind}" is not an eligible input under PRD section 6.2`);
  }
  const retentionDays = finiteNumber(source["retentionDays"], "evidence.retentionDays");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    fail(`evidence.retentionDays must be an integer between 1 and ${MAX_RETENTION_DAYS}`);
  }
  return {
    id: identifier(source["id"], "evidence.id"),
    owner: owner(source["owner"], "evidence.owner"),
    kind: kind as EligibleEvidenceKind,
    purpose: text(source["purpose"], "evidence.purpose"),
    redactionPolicyVersion: identifier(
      source["redactionPolicyVersion"],
      "evidence.redactionPolicyVersion",
    ),
    retentionDays,
  };
}

export function validateComparison(input: unknown): ComparisonSchema {
  if (typeof input !== "object" || input === null) fail("comparison must be an object");
  const source = input as Record<string, unknown>;
  const minimumEffect = finiteNumber(source["minimumEffect"], "comparison.minimumEffect");
  if (minimumEffect < 0) fail("comparison.minimumEffect must not be negative");
  const guardrailIds = list(source["guardrailIds"], "comparison.guardrailIds").map((id, index) =>
    identifier(id, `comparison.guardrailIds[${index}]`),
  );
  return {
    primaryMetric: identifier(source["primaryMetric"], "comparison.primaryMetric"),
    direction: direction(source["direction"], "comparison.direction"),
    minimumEffect,
    guardrailIds,
  };
}
