import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "@opentenant/security";
import {
  QualityContractValidationError,
  validateBenchmark,
  validateComparison,
  validateEvidence,
  validateGuardrail,
  validateJourney,
  validateOutcome,
  type BenchmarkSchema,
  type ComparisonSchema,
  type ContractOwner,
  type EvidenceSchema,
  type GuardrailSchema,
  type JourneySchema,
  type OutcomeSchema,
} from "./schemas";

/**
 * An immutable, versioned quality contract. PRD section 6.1: every module
 * version references one of these, and a proposed change to it is reviewed
 * alongside the code rather than trusted on its own terms.
 */
export interface QualityContract {
  readonly contractId: string;
  readonly moduleId: string;
  readonly version: number;
  readonly outcomes: readonly OutcomeSchema[];
  readonly journeys: readonly JourneySchema[];
  readonly benchmarks: readonly BenchmarkSchema[];
  readonly guardrails: readonly GuardrailSchema[];
  readonly evidence: readonly EvidenceSchema[];
  readonly comparison: ComparisonSchema;
}

/**
 * Why a proposed contract is weaker than the one it replaces.
 *
 * `platformMandatory` marks the cases workspace code is never permitted to
 * make, as opposed to the ones that are merely not self-approvable. Phase 0
 * rejects both, because a candidate is never evaluated only against its own
 * newly relaxed rules. The distinction is recorded so the Phase 2 review
 * bundle can present them differently.
 */
export interface ContractWeakening {
  readonly element: "outcome" | "journey" | "benchmark" | "guardrail" | "comparison";
  readonly id: string;
  readonly owner: ContractOwner;
  readonly platformMandatory: boolean;
  readonly reason: string;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_VERSION = 2_147_483_647;

function fail(message: string): never {
  throw new QualityContractValidationError(message);
}

function uniqueById<T extends { readonly id: string }>(
  items: readonly T[],
  element: string,
): ReadonlyMap<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (byId.has(item.id)) fail(`duplicate ${element} id "${item.id}"`);
    byId.set(item.id, item);
  }
  return byId;
}

/**
 * Validates structure, then the cross-references that make the contract
 * coherent. A journey asserting an outcome that does not exist, or a comparison
 * naming a guardrail that does not exist, is a contract that cannot be
 * evaluated, so it is refused rather than silently under-enforced.
 */
export function validateQualityContract(input: unknown): QualityContract {
  if (typeof input !== "object" || input === null) fail("quality contract must be an object");
  const source = input as Record<string, unknown>;

  const contractId = source["contractId"];
  if (typeof contractId !== "string" || !IDENTIFIER.test(contractId)) {
    fail("contractId must be a lowercase dotted identifier of 1 to 128 characters");
  }
  const moduleId = source["moduleId"];
  if (typeof moduleId !== "string" || !IDENTIFIER.test(moduleId)) {
    fail("moduleId must be a lowercase dotted identifier of 1 to 128 characters");
  }
  const version = source["version"];
  if (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > MAX_VERSION) {
    fail("version must be a positive integer no greater than 2147483647");
  }

  const arrayOf = (key: string): readonly unknown[] => {
    const value = source[key];
    if (!Array.isArray(value)) fail(`${key} must be an array`);
    return value;
  };

  const outcomes = arrayOf("outcomes").map(validateOutcome);
  const journeys = arrayOf("journeys").map(validateJourney);
  const benchmarks = arrayOf("benchmarks").map(validateBenchmark);
  const guardrails = arrayOf("guardrails").map(validateGuardrail);
  const evidence = arrayOf("evidence").map(validateEvidence);
  const comparison = validateComparison(source["comparison"]);

  if (outcomes.length === 0) fail("a quality contract must declare at least one outcome");
  if (journeys.length === 0) fail("a quality contract must declare at least one journey");

  const outcomesById = uniqueById(outcomes, "outcome");
  uniqueById(journeys, "journey");
  uniqueById(benchmarks, "benchmark");
  const guardrailsById = uniqueById(guardrails, "guardrail");
  uniqueById(evidence, "evidence");

  for (const journey of journeys) {
    for (const outcomeId of journey.assertedOutcomeIds) {
      if (!outcomesById.has(outcomeId)) {
        fail(`journey "${journey.id}" asserts unknown outcome "${outcomeId}"`);
      }
    }
  }
  for (const guardrailId of comparison.guardrailIds) {
    if (!guardrailsById.has(guardrailId)) {
      fail(`comparison names unknown guardrail "${guardrailId}"`);
    }
  }

  // Every declared guardrail is applied. A guardrail that is written down but
  // left out of the comparison enforces nothing while reading like a control,
  // which is the same failure as a stored setting that silently does nothing.
  for (const guardrail of guardrails) {
    if (!comparison.guardrailIds.includes(guardrail.id)) {
      fail(`guardrail "${guardrail.id}" is declared but not applied by the comparison`);
    }
  }

  // A metric cannot guard itself. Allowing it would let a contract claim a
  // guardrail while leaving the primary metric unbounded in the only direction
  // that matters, which is the metric-gaming risk in PRD section 11.
  for (const guardrailId of comparison.guardrailIds) {
    const guardrail = guardrailsById.get(guardrailId);
    if (guardrail && guardrail.metric === comparison.primaryMetric) {
      fail(`guardrail "${guardrailId}" cannot guard the primary metric "${comparison.primaryMetric}"`);
    }
  }

  // Element order is canonicalised by id. Without this the digest is
  // order-sensitive, and a proposal that merely lists its outcomes in a
  // different order would produce an effective contract whose digest no longer
  // matches the run, rejecting a candidate for a formatting difference.
  const byId = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] =>
    [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return {
    contractId,
    moduleId,
    version: version as number,
    outcomes: byId(outcomes),
    journeys: byId(journeys),
    benchmarks: byId(benchmarks),
    guardrails: byId(guardrails),
    evidence: byId(evidence),
    comparison: { ...comparison, guardrailIds: [...comparison.guardrailIds].sort() },
  };
}

/**
 * Stable digest over the validated contract. Runs record the digest they were
 * produced against so a result set cannot be presented as evidence for a
 * contract it never ran under.
 */
export function qualityContractDigest(contract: QualityContract): string {
  const canonical = canonicalJsonStringify(validateQualityContract(contract));
  if (canonical === undefined) fail("quality contract could not be canonicalized");
  return createHash("sha256").update(canonical).digest("hex");
}

function relaxed(direction: "higher_is_better" | "lower_is_better", from: number, to: number): boolean {
  return direction === "higher_is_better" ? to < from : to > from;
}

/**
 * Every way `proposed` is weaker than `baseline`.
 *
 * Adding elements is never a weakening. Removing or relaxing one is, and so is
 * redefining one in place: an element that keeps its id but changes its
 * statement, metric or direction is a different check wearing an old name, and
 * treating it as unchanged is how a relaxation hides.
 *
 * Benchmarks are permanent regardless of owner. Each one encodes a failure that
 * already happened, so dropping it re-opens a known regression.
 */
export function contractWeakenings(
  baseline: QualityContract,
  proposed: QualityContract,
): readonly ContractWeakening[] {
  const weakenings: ContractWeakening[] = [];
  const isPlatform = (owner: ContractOwner): boolean => owner === "platform";

  const proposedOutcomes = new Map(proposed.outcomes.map((item) => [item.id, item]));
  for (const outcome of baseline.outcomes) {
    const next = proposedOutcomes.get(outcome.id);
    const base = { element: "outcome" as const, id: outcome.id, owner: outcome.owner, platformMandatory: isPlatform(outcome.owner) };
    if (!next) {
      weakenings.push({ ...base, reason: "outcome removed" });
      continue;
    }
    if (outcome.required && !next.required) {
      weakenings.push({ ...base, reason: "required outcome demoted to optional" });
    }
    if (next.statement !== outcome.statement) {
      weakenings.push({ ...base, reason: "outcome statement redefined under the same id" });
    }
    if (next.kind !== outcome.kind) {
      weakenings.push({ ...base, reason: "outcome kind redefined under the same id" });
    }
  }

  const proposedJourneys = new Map(proposed.journeys.map((item) => [item.id, item]));
  for (const journey of baseline.journeys) {
    const next = proposedJourneys.get(journey.id);
    const base = { element: "journey" as const, id: journey.id, owner: journey.owner, platformMandatory: isPlatform(journey.owner) };
    if (!next) {
      weakenings.push({ ...base, reason: "journey removed" });
      continue;
    }
    if (next.fixtureId !== journey.fixtureId) {
      weakenings.push({ ...base, reason: "journey fixture replaced under the same id" });
    }
    const droppedAssertions = journey.assertedOutcomeIds.filter(
      (id) => !next.assertedOutcomeIds.includes(id),
    );
    for (const dropped of droppedAssertions) {
      weakenings.push({ ...base, reason: `journey no longer asserts outcome "${dropped}"` });
    }
  }

  const proposedBenchmarks = new Map(proposed.benchmarks.map((item) => [item.id, item]));
  for (const benchmark of baseline.benchmarks) {
    const next = proposedBenchmarks.get(benchmark.id);
    const base = { element: "benchmark" as const, id: benchmark.id, owner: benchmark.owner, platformMandatory: true };
    if (!next) {
      weakenings.push({ ...base, reason: "regression benchmark removed" });
      continue;
    }
    if (next.metric !== benchmark.metric || next.direction !== benchmark.direction) {
      weakenings.push({ ...base, reason: "regression benchmark redefined under the same id" });
      continue;
    }
    if (relaxed(benchmark.direction, benchmark.threshold, next.threshold)) {
      weakenings.push({ ...base, reason: `regression benchmark threshold relaxed from ${benchmark.threshold} to ${next.threshold}` });
    }
  }

  const proposedGuardrails = new Map(proposed.guardrails.map((item) => [item.id, item]));
  for (const guardrail of baseline.guardrails) {
    const next = proposedGuardrails.get(guardrail.id);
    const base = { element: "guardrail" as const, id: guardrail.id, owner: guardrail.owner, platformMandatory: isPlatform(guardrail.owner) };
    if (!next) {
      weakenings.push({ ...base, reason: "guardrail removed" });
      continue;
    }
    if (next.metric !== guardrail.metric || next.direction !== guardrail.direction) {
      weakenings.push({ ...base, reason: "guardrail redefined under the same id" });
      continue;
    }
    if (relaxed(guardrail.direction, guardrail.bound, next.bound)) {
      weakenings.push({ ...base, reason: `guardrail bound loosened from ${guardrail.bound} to ${next.bound}` });
    }
  }

  const comparisonBase = {
    element: "comparison" as const,
    id: baseline.comparison.primaryMetric,
    owner: "platform" as ContractOwner,
    platformMandatory: true,
  };
  if (proposed.comparison.primaryMetric !== baseline.comparison.primaryMetric) {
    weakenings.push({ ...comparisonBase, reason: `primary metric changed from "${baseline.comparison.primaryMetric}" to "${proposed.comparison.primaryMetric}"` });
  }
  if (proposed.comparison.direction !== baseline.comparison.direction) {
    weakenings.push({ ...comparisonBase, reason: "comparison direction reversed" });
  }
  if (proposed.comparison.minimumEffect < baseline.comparison.minimumEffect) {
    weakenings.push({ ...comparisonBase, reason: `minimum effect lowered from ${baseline.comparison.minimumEffect} to ${proposed.comparison.minimumEffect}` });
  }
  for (const guardrailId of baseline.comparison.guardrailIds) {
    if (!proposed.comparison.guardrailIds.includes(guardrailId)) {
      weakenings.push({ ...comparisonBase, reason: `comparison no longer applies guardrail "${guardrailId}"` });
    }
  }

  return weakenings;
}

/**
 * The contract a candidate is actually evaluated against: everything the
 * baseline required, plus everything the proposal adds.
 *
 * Where an id exists in both, the baseline definition wins. That is deliberate
 * belt and braces. `contractWeakenings` already rejects relaxations, and this
 * makes a missed relaxation harmless rather than load-bearing, which is what
 * PRD section 6.1 means by "never evaluated only against its own newly relaxed
 * rules".
 */
export function effectiveContract(
  baseline: QualityContract,
  proposed: QualityContract | undefined,
): QualityContract {
  if (!proposed) return baseline;

  const merge = <T extends { readonly id: string }>(
    base: readonly T[],
    next: readonly T[],
  ): readonly T[] => {
    const ids = new Set(base.map((item) => item.id));
    return [...base, ...next.filter((item) => !ids.has(item.id))];
  };

  const guardrails = merge(baseline.guardrails, proposed.guardrails);
  const guardrailIds = [
    ...baseline.comparison.guardrailIds,
    ...proposed.comparison.guardrailIds.filter((id) => !baseline.comparison.guardrailIds.includes(id)),
  ];
  const knownGuardrails = new Set(guardrails.map((item) => item.id));

  return validateQualityContract({
    contractId: baseline.contractId,
    moduleId: baseline.moduleId,
    version: Math.max(baseline.version, proposed.version),
    outcomes: merge(baseline.outcomes, proposed.outcomes),
    journeys: merge(baseline.journeys, proposed.journeys),
    benchmarks: merge(baseline.benchmarks, proposed.benchmarks),
    guardrails,
    evidence: merge(baseline.evidence, proposed.evidence),
    comparison: {
      ...baseline.comparison,
      // A proposal may only raise the minimum effect, since lowering it is a
      // weakening. Take the stricter of the two so a tightening is honoured
      // rather than silently discarded by the baseline-wins rule.
      minimumEffect: Math.max(baseline.comparison.minimumEffect, proposed.comparison.minimumEffect),
      guardrailIds: guardrailIds.filter((id) => knownGuardrails.has(id)),
    },
  });
}
