import { describe, expect, it } from "vitest";
import { effectiveContract, qualityContractDigest, validateQualityContract } from "./contract";
import { evaluateCandidate, type MetricSample } from "./evaluate";
import {
  SYNTHETIC_BASELINE_METRICS,
  syntheticBaselineContract,
  syntheticPassingRun,
} from "./synthetic";

const baseline = syntheticBaselineContract();
const baselineRun = syntheticPassingRun(baseline, SYNTHETIC_BASELINE_METRICS);

function candidateMetrics(overrides: Record<string, number>): readonly MetricSample[] {
  return SYNTHETIC_BASELINE_METRICS.map((sample) =>
    sample.metric in overrides ? { metric: sample.metric, value: overrides[sample.metric]! } : sample,
  );
}

describe("baseline versus candidate", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects a non-finite primary metric (%s)", (value) => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: value })),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("missing_result");
  });

  it("accepts a candidate that improves the primary metric with every check passing", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.78 })),
    });
    expect(result.verdict).toBe("accepted");
    expect(result.primaryEffect).toBeCloseTo(0.08, 10);
    expect(result.failures).toEqual([]);
  });

  it("reports no change when the effect is inside the contract's minimum effect", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.71 })),
    });
    expect(result.verdict).toBe("no_change");
    expect(result.primaryEffect).toBeCloseTo(0.01, 10);
  });

  it("rejects a candidate that moves the primary metric backwards", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.6 })),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("primary_metric_regressed");
  });

  it("rejects a guardrail breach however good the primary metric looks", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(
        baseline,
        candidateMetrics({ task_completion_rate: 0.95, p95_latency_ms: 2400 }),
      ),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.id)).toContain("guardrail.latency");
    expect(result.primaryEffect).toBeCloseTo(0.25, 10);
  });

  it("rejects a regression against a benchmark derived from an approved past failure", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: syntheticPassingRun(
        baseline,
        candidateMetrics({ task_completion_rate: 0.9, duplicate_charge_rate: 0.01 }),
      ),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("benchmark_regressed");
  });

  it("rejects a failed required outcome and ignores a failed optional one", () => {
    const passing = syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.9 }));

    const requiredFailed = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: {
        ...passing,
        outcomes: passing.outcomes.map((outcome) =>
          outcome.outcomeId === "outcome.tenant.isolation" ? { ...outcome, passed: false } : outcome,
        ),
      },
    });
    expect(requiredFailed.verdict).toBe("rejected");
    expect(requiredFailed.failures.map((failure) => failure.id)).toContain("outcome.tenant.isolation");

    const optionalFailed = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: {
        ...passing,
        outcomes: passing.outcomes.map((outcome) =>
          outcome.outcomeId === "outcome.cart.badge" ? { ...outcome, passed: false } : outcome,
        ),
      },
    });
    expect(optionalFailed.verdict).toBe("accepted");
  });

  it("fails closed on a missing result rather than reading absence as a pass", () => {
    const passing = syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.9 }));
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: {
        ...passing,
        outcomes: passing.outcomes.filter((outcome) => outcome.outcomeId !== "outcome.order.placed"),
        metrics: passing.metrics.filter((sample) => sample.metric !== "p95_latency_ms"),
      },
    });
    expect(result.verdict).toBe("rejected");
    const missing = result.failures.filter((failure) => failure.kind === "missing_result");
    expect(missing.map((failure) => failure.id)).toEqual(
      expect.arrayContaining(["outcome.order.placed", "guardrail.latency"]),
    );
  });

  it("rejects a run that was not produced against the contract it claims", () => {
    const result = evaluateCandidate({
      baselineContract: baseline,
      baselineRun,
      candidateRun: {
        ...syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.9 })),
        contractDigest: "0".repeat(64),
      },
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("run_contract_mismatch");
  });
});

describe("a candidate cannot relax the rules it is judged by", () => {
  it("rejects a proposal that drops a platform outcome, before looking at any result", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      outcomes: baseline.outcomes.filter((outcome) => outcome.id !== "outcome.keyboard.reachable"),
      journeys: baseline.journeys.map((journey) => ({
        ...journey,
        assertedOutcomeIds: journey.assertedOutcomeIds.filter(
          (id) => id !== "outcome.keyboard.reachable",
        ),
      })),
    });

    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      // Results good enough to be accepted on their own terms.
      candidateRun: syntheticPassingRun(
        proposedContract,
        candidateMetrics({ task_completion_rate: 0.99 }),
      ),
    });

    expect(result.verdict).toBe("rejected");
    expect(result.weakenings.map((weakening) => weakening.reason)).toEqual(
      expect.arrayContaining(["outcome removed"]),
    );
    expect(result.failures.every((failure) => failure.kind === "weakened_contract")).toBe(true);
    // No result was consulted, so no effect was computed.
    expect(result.primaryEffect).toBeNull();
  });

  it("rejects a proposal that loosens the guardrail it is about to breach", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      guardrails: baseline.guardrails.map((guardrail) =>
        guardrail.id === "guardrail.latency" ? { ...guardrail, bound: 5000 } : guardrail,
      ),
    });

    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: syntheticPassingRun(
        proposedContract,
        candidateMetrics({ task_completion_rate: 0.95, p95_latency_ms: 4000 }),
      ),
    });

    expect(result.verdict).toBe("rejected");
    expect(result.weakenings.map((weakening) => weakening.reason)).toContain(
      "guardrail bound loosened from 800 to 5000",
    );
  });

  it("evaluates an additive proposal against the union of both contracts", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      version: 2,
      outcomes: [
        ...baseline.outcomes,
        {
          id: "outcome.receipt.emailed",
          owner: "workspace",
          kind: "functional",
          statement: "A placed order emails a receipt",
          required: true,
        },
      ],
    });
    const effective = effectiveContract(baseline, proposedContract);
    const passing = syntheticPassingRun(effective, candidateMetrics({ task_completion_rate: 0.9 }));

    expect(
      evaluateCandidate({ baselineContract: baseline, proposedContract, baselineRun, candidateRun: passing })
        .verdict,
    ).toBe("accepted");

    // The added check is enforced, not merely recorded.
    const failingTheAddition = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: {
        ...passing,
        outcomes: passing.outcomes.map((outcome) =>
          outcome.outcomeId === "outcome.receipt.emailed" ? { ...outcome, passed: false } : outcome,
        ),
      },
    });
    expect(failingTheAddition.verdict).toBe("rejected");
    expect(failingTheAddition.failures.map((failure) => failure.id)).toContain(
      "outcome.receipt.emailed",
    );
  });

  it("rejects a proposal aimed at a different module", () => {
    const proposedContract = validateQualityContract({ ...baseline, moduleId: "synthetic.other" });
    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: syntheticPassingRun(
        proposedContract,
        candidateMetrics({ task_completion_rate: 0.9 }),
      ),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("incoherent_proposal");
  });

  it("rejects a candidate run produced against the baseline when the proposal adds checks", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      version: 2,
      outcomes: [
        ...baseline.outcomes,
        {
          id: "outcome.receipt.emailed",
          owner: "workspace",
          kind: "functional",
          statement: "A placed order emails a receipt",
          required: true,
        },
      ],
    });
    // Produced against the baseline, so it never exercised the added outcome.
    const staleRun = syntheticPassingRun(baseline, candidateMetrics({ task_completion_rate: 0.9 }));
    expect(staleRun.contractDigest).not.toBe(
      qualityContractDigest(effectiveContract(baseline, proposedContract)),
    );

    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: staleRun,
    });
    expect(result.verdict).toBe("rejected");
    expect(result.failures.map((failure) => failure.kind)).toContain("run_contract_mismatch");
  });

  it("honours a tightened minimum effect instead of discarding it", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      version: 2,
      comparison: { ...baseline.comparison, minimumEffect: 0.1 },
    });
    const effective = effectiveContract(baseline, proposedContract);
    expect(effective.comparison.minimumEffect).toBe(0.1);

    // An effect of 0.05 clears the baseline's 0.02 and not the proposal's 0.1.
    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: syntheticPassingRun(effective, candidateMetrics({ task_completion_rate: 0.75 })),
    });
    expect(result.verdict).toBe("no_change");
  });

  it("does not reject a proposal that merely reorders its elements", () => {
    const proposedContract = validateQualityContract({
      ...baseline,
      outcomes: [...baseline.outcomes].reverse(),
      guardrails: [...baseline.guardrails].reverse(),
    });
    expect(qualityContractDigest(proposedContract)).toBe(qualityContractDigest(baseline));

    const result = evaluateCandidate({
      baselineContract: baseline,
      proposedContract,
      baselineRun,
      candidateRun: syntheticPassingRun(
        effectiveContract(baseline, proposedContract),
        candidateMetrics({ task_completion_rate: 0.9 }),
      ),
    });
    expect(result.verdict).toBe("accepted");
  });
});
