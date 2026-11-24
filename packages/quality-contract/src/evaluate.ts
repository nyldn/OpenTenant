import {
  contractWeakenings,
  effectiveContract,
  qualityContractDigest,
  validateQualityContract,
  type ContractWeakening,
  type QualityContract,
} from "./contract";
import { QualityContractValidationError, type MetricDirection } from "./schemas";

export interface OutcomeResult {
  readonly outcomeId: string;
  readonly passed: boolean;
}

export interface JourneyResult {
  readonly journeyId: string;
  readonly passed: boolean;
}

export interface MetricSample {
  readonly metric: string;
  readonly value: number;
}

/**
 * One side of a comparison. `contractDigest` binds the results to the contract
 * they were produced under, so a run cannot be presented as evidence for a
 * contract it never executed against.
 */
export interface EvaluationRun {
  readonly contractDigest: string;
  readonly outcomes: readonly OutcomeResult[];
  readonly journeys: readonly JourneyResult[];
  readonly metrics: readonly MetricSample[];
}

export type EvaluationFailureKind =
  | "incoherent_proposal"
  | "weakened_contract"
  | "run_contract_mismatch"
  | "missing_result"
  | "required_outcome_failed"
  | "journey_failed"
  | "benchmark_regressed"
  | "guardrail_breached"
  | "primary_metric_regressed";

export interface EvaluationFailure {
  readonly kind: EvaluationFailureKind;
  readonly id: string;
  readonly detail: string;
}

/**
 * `no_change` is a first-class outcome, not a soft rejection. A candidate whose
 * effect is inside the contract's minimum effect has not been shown to do
 * anything, and reporting that as an improvement is the churn risk in PRD
 * section 11.
 */
export type EvaluationVerdict = "accepted" | "rejected" | "no_change";

export interface CandidateEvaluation {
  readonly verdict: EvaluationVerdict;
  readonly effectiveContractDigest: string | null;
  readonly weakenings: readonly ContractWeakening[];
  readonly failures: readonly EvaluationFailure[];
  readonly primaryEffect: number | null;
}

export interface CandidateEvaluationInput {
  readonly baselineContract: QualityContract;
  /** Present when the candidate proposes a contract change alongside its code. */
  readonly proposedContract?: QualityContract;
  readonly baselineRun: EvaluationRun;
  readonly candidateRun: EvaluationRun;
}

function rejected(
  failures: readonly EvaluationFailure[],
  weakenings: readonly ContractWeakening[] = [],
  effectiveContractDigest: string | null = null,
): CandidateEvaluation {
  return { verdict: "rejected", effectiveContractDigest, weakenings, failures, primaryEffect: null };
}

/**
 * A non-finite sample is treated as missing. NaN compares false against
 * every bound, so letting it through would turn a broken harness into an
 * "accepted" verdict.
 */
function metricValue(run: EvaluationRun, metric: string): number | undefined {
  const value = run.metrics.find((sample) => sample.metric === metric)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function satisfies(direction: MetricDirection, value: number, limit: number): boolean {
  return direction === "higher_is_better" ? value >= limit : value <= limit;
}

/**
 * Baseline versus candidate evaluation, PRD section 9 phase 0.
 *
 * The order of the checks is the point. A proposed contract change is assessed
 * before any result is looked at, so a candidate can never buy acceptance by
 * relaxing the rules it is about to be judged by. Everything after that runs
 * against the union of the baseline contract and the proposal's additions.
 *
 * Deterministic and side-effect free. No model is consulted, and none should
 * be: this is the mechanical half of the quality contract.
 */
export function evaluateCandidate(input: CandidateEvaluationInput): CandidateEvaluation {
  const baseline = validateQualityContract(input.baselineContract);
  const proposed = input.proposedContract ? validateQualityContract(input.proposedContract) : undefined;

  if (proposed && proposed.moduleId !== baseline.moduleId) {
    return rejected([
      {
        kind: "incoherent_proposal",
        id: proposed.contractId,
        detail: `proposed contract targets module "${proposed.moduleId}", baseline targets "${baseline.moduleId}"`,
      },
    ]);
  }

  const weakenings = proposed ? contractWeakenings(baseline, proposed) : [];
  if (weakenings.length > 0) {
    return rejected(
      weakenings.map((weakening) => ({
        kind: "weakened_contract" as const,
        id: `${weakening.element}:${weakening.id}`,
        detail: weakening.reason,
      })),
      weakenings,
    );
  }

  let effective: QualityContract;
  try {
    effective = effectiveContract(baseline, proposed);
  } catch (error) {
    if (!(error instanceof QualityContractValidationError)) throw error;
    return rejected([
      {
        kind: "incoherent_proposal",
        id: proposed?.contractId ?? baseline.contractId,
        detail: `baseline and proposal do not compose into an evaluable contract: ${error.message}`,
      },
    ]);
  }

  const effectiveDigest = qualityContractDigest(effective);
  const baselineDigest = qualityContractDigest(baseline);
  const failures: EvaluationFailure[] = [];

  if (input.baselineRun.contractDigest !== baselineDigest) {
    failures.push({
      kind: "run_contract_mismatch",
      id: "baseline",
      detail: "baseline run was not produced against the baseline contract",
    });
  }
  if (input.candidateRun.contractDigest !== effectiveDigest) {
    failures.push({
      kind: "run_contract_mismatch",
      id: "candidate",
      detail: "candidate run was not produced against the effective contract",
    });
  }
  if (failures.length > 0) return rejected(failures, weakenings, effectiveDigest);

  for (const outcome of effective.outcomes) {
    if (!outcome.required) continue;
    const result = input.candidateRun.outcomes.find((item) => item.outcomeId === outcome.id);
    if (!result) {
      failures.push({ kind: "missing_result", id: outcome.id, detail: "required outcome has no result in the candidate run" });
      continue;
    }
    if (!result.passed) {
      failures.push({ kind: "required_outcome_failed", id: outcome.id, detail: outcome.statement });
    }
  }

  for (const journey of effective.journeys) {
    const result = input.candidateRun.journeys.find((item) => item.journeyId === journey.id);
    if (!result) {
      failures.push({ kind: "missing_result", id: journey.id, detail: "journey has no result in the candidate run" });
      continue;
    }
    if (!result.passed) {
      failures.push({ kind: "journey_failed", id: journey.id, detail: `journey "${journey.id}" failed on fixture "${journey.fixtureId}"` });
    }
  }

  for (const benchmark of effective.benchmarks) {
    const value = metricValue(input.candidateRun, benchmark.metric);
    if (value === undefined) {
      failures.push({ kind: "missing_result", id: benchmark.id, detail: `candidate run reports no value for benchmark metric "${benchmark.metric}"` });
      continue;
    }
    if (!satisfies(benchmark.direction, value, benchmark.threshold)) {
      failures.push({
        kind: "benchmark_regressed",
        id: benchmark.id,
        detail: `${benchmark.metric} is ${value}, threshold is ${benchmark.threshold} (${benchmark.direction}), from failure "${benchmark.derivedFromFailureId}"`,
      });
    }
  }

  // Guardrails are evaluated whatever the primary metric did. A candidate that
  // improves the headline number by breaching a guardrail is the metric-gaming
  // failure the contract exists to catch.
  for (const guardrailId of effective.comparison.guardrailIds) {
    const guardrail = effective.guardrails.find((item) => item.id === guardrailId);
    if (!guardrail) continue;
    const value = metricValue(input.candidateRun, guardrail.metric);
    if (value === undefined) {
      failures.push({ kind: "missing_result", id: guardrail.id, detail: `candidate run reports no value for guardrail metric "${guardrail.metric}"` });
      continue;
    }
    if (!satisfies(guardrail.direction, value, guardrail.bound)) {
      failures.push({
        kind: "guardrail_breached",
        id: guardrail.id,
        detail: `${guardrail.metric} is ${value}, bound is ${guardrail.bound} (${guardrail.direction}); unacceptable trade-off: ${guardrail.unacceptableTradeOff}`,
      });
    }
  }

  const primary = effective.comparison.primaryMetric;
  const baselineValue = metricValue(input.baselineRun, primary);
  const candidateValue = metricValue(input.candidateRun, primary);
  if (baselineValue === undefined || candidateValue === undefined) {
    failures.push({
      kind: "missing_result",
      id: primary,
      detail: "the primary metric is missing from the baseline run, the candidate run, or both",
    });
    return rejected(failures, weakenings, effectiveDigest);
  }

  const primaryEffect =
    effective.comparison.direction === "higher_is_better"
      ? candidateValue - baselineValue
      : baselineValue - candidateValue;

  if (failures.length > 0) {
    return { verdict: "rejected", effectiveContractDigest: effectiveDigest, weakenings, failures, primaryEffect };
  }

  if (Math.abs(primaryEffect) < effective.comparison.minimumEffect) {
    return { verdict: "no_change", effectiveContractDigest: effectiveDigest, weakenings, failures, primaryEffect };
  }

  if (primaryEffect < 0) {
    return {
      verdict: "rejected",
      effectiveContractDigest: effectiveDigest,
      weakenings,
      failures: [
        {
          kind: "primary_metric_regressed",
          id: primary,
          detail: `${primary} moved ${primaryEffect} against the contract's direction`,
        },
      ],
      primaryEffect,
    };
  }

  return { verdict: "accepted", effectiveContractDigest: effectiveDigest, weakenings, failures, primaryEffect };
}
