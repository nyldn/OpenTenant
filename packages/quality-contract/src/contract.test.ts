import { describe, expect, it } from "vitest";
import {
  contractWeakenings,
  effectiveContract,
  qualityContractDigest,
  validateQualityContract,
  type QualityContract,
} from "./contract";
import { syntheticBaselineContract } from "./synthetic";

function withOutcomes(
  contract: QualityContract,
  edit: (outcomes: QualityContract["outcomes"]) => QualityContract["outcomes"],
): QualityContract {
  return validateQualityContract({ ...contract, outcomes: edit(contract.outcomes) });
}

describe("contract validation", () => {
  it("refuses a journey asserting an outcome that does not exist", () => {
    const baseline = syntheticBaselineContract();
    expect(() =>
      validateQualityContract({
        ...baseline,
        journeys: [{ ...baseline.journeys[0]!, assertedOutcomeIds: ["outcome.absent"] }],
      }),
    ).toThrow(/asserts unknown outcome/);
  });

  it("refuses a guardrail that is declared but never applied", () => {
    const baseline = syntheticBaselineContract();
    expect(() =>
      validateQualityContract({
        ...baseline,
        comparison: { ...baseline.comparison, guardrailIds: ["guardrail.latency"] },
      }),
    ).toThrow(/declared but not applied by the comparison/);
  });

  it("refuses a comparison naming a guardrail that does not exist", () => {
    const baseline = syntheticBaselineContract();
    expect(() =>
      validateQualityContract({
        ...baseline,
        comparison: { ...baseline.comparison, guardrailIds: ["guardrail.absent"] },
      }),
    ).toThrow(/unknown guardrail/);
  });

  it("refuses a guardrail placed on the primary metric, which would guard nothing", () => {
    const baseline = syntheticBaselineContract();
    expect(() =>
      validateQualityContract({
        ...baseline,
        guardrails: [
          ...baseline.guardrails,
          {
            id: "guardrail.self",
            owner: "platform",
            metric: baseline.comparison.primaryMetric,
            direction: "higher_is_better",
            bound: 0,
            unacceptableTradeOff: "none",
          },
        ],
        comparison: {
          ...baseline.comparison,
          guardrailIds: [...baseline.comparison.guardrailIds, "guardrail.self"],
        },
      }),
    ).toThrow(/cannot guard the primary metric/);
  });

  it("refuses duplicate element ids", () => {
    const baseline = syntheticBaselineContract();
    expect(() =>
      validateQualityContract({ ...baseline, outcomes: [...baseline.outcomes, baseline.outcomes[0]!] }),
    ).toThrow(/duplicate outcome id/);
  });
});

describe("digest", () => {
  it("is stable across key order and unstable across content", () => {
    const baseline = syntheticBaselineContract();
    const reordered = validateQualityContract({
      version: baseline.version,
      moduleId: baseline.moduleId,
      contractId: baseline.contractId,
      comparison: baseline.comparison,
      evidence: baseline.evidence,
      guardrails: baseline.guardrails,
      benchmarks: baseline.benchmarks,
      journeys: baseline.journeys,
      outcomes: baseline.outcomes,
    });
    expect(qualityContractDigest(reordered)).toBe(qualityContractDigest(baseline));

    const edited = withOutcomes(baseline, (outcomes) => [
      { ...outcomes[0]!, statement: "A submitted cart becomes at least one order" },
      ...outcomes.slice(1),
    ]);
    expect(qualityContractDigest(edited)).not.toBe(qualityContractDigest(baseline));
  });
});

describe("weakening detection", () => {
  const baseline = syntheticBaselineContract();

  it("reports nothing when the proposal only adds", () => {
    const proposed = withOutcomes(baseline, (outcomes) => [
      ...outcomes,
      {
        id: "outcome.receipt.emailed",
        owner: "workspace",
        kind: "functional",
        statement: "A placed order emails a receipt",
        required: true,
      },
    ]);
    expect(contractWeakenings(baseline, proposed)).toEqual([]);
  });

  it("catches a removed platform outcome", () => {
    // The journey that asserted it has to go too, otherwise the proposal is not
    // a valid contract at all and never reaches weakening detection.
    const proposed = validateQualityContract({
      ...baseline,
      outcomes: baseline.outcomes.filter((outcome) => outcome.id !== "outcome.tenant.isolation"),
      journeys: baseline.journeys.filter((journey) => journey.id !== "journey.cross.tenant.probe"),
    });
    expect(contractWeakenings(baseline, proposed)).toContainEqual({
      element: "outcome",
      id: "outcome.tenant.isolation",
      owner: "platform",
      platformMandatory: true,
      reason: "outcome removed",
    });
  });

  it("catches a required outcome demoted to optional", () => {
    const proposed = withOutcomes(baseline, (outcomes) =>
      outcomes.map((outcome) =>
        outcome.id === "outcome.order.placed" ? { ...outcome, required: false } : outcome,
      ),
    );
    expect(contractWeakenings(baseline, proposed).map((item) => item.reason)).toContain(
      "required outcome demoted to optional",
    );
  });

  it("catches an outcome redefined under the same id", () => {
    const proposed = withOutcomes(baseline, (outcomes) =>
      outcomes.map((outcome) =>
        outcome.id === "outcome.order.placed"
          ? { ...outcome, statement: "A submitted cart usually becomes an order" }
          : outcome,
      ),
    );
    expect(contractWeakenings(baseline, proposed).map((item) => item.reason)).toContain(
      "outcome statement redefined under the same id",
    );
  });

  it("catches a removed regression benchmark even though it is workspace-owned nowhere", () => {
    const proposed = validateQualityContract({ ...baseline, benchmarks: [] });
    expect(contractWeakenings(baseline, proposed)).toContainEqual({
      element: "benchmark",
      id: "benchmark.no.duplicate.charge",
      owner: "platform",
      platformMandatory: true,
      reason: "regression benchmark removed",
    });
  });

  it("catches a loosened guardrail bound in the direction that matters", () => {
    const proposed = validateQualityContract({
      ...baseline,
      guardrails: baseline.guardrails.map((guardrail) =>
        guardrail.id === "guardrail.latency" ? { ...guardrail, bound: 2000 } : guardrail,
      ),
    });
    expect(contractWeakenings(baseline, proposed).map((item) => item.reason)).toContain(
      "guardrail bound loosened from 800 to 2000",
    );
  });

  it("does not mistake a tightened guardrail for a weakening", () => {
    const proposed = validateQualityContract({
      ...baseline,
      guardrails: baseline.guardrails.map((guardrail) =>
        guardrail.id === "guardrail.latency" ? { ...guardrail, bound: 400 } : guardrail,
      ),
    });
    expect(contractWeakenings(baseline, proposed)).toEqual([]);
  });

  it("catches a lowered minimum effect and a swapped primary metric", () => {
    const proposed = validateQualityContract({
      ...baseline,
      comparison: { ...baseline.comparison, minimumEffect: 0, primaryMetric: "clicks" },
    });
    const reasons = contractWeakenings(baseline, proposed).map((item) => item.reason);
    expect(reasons).toContain("minimum effect lowered from 0.02 to 0");
    expect(reasons).toContain(
      'primary metric changed from "task_completion_rate" to "clicks"',
    );
  });

  it("catches a guardrail dropped from both the declaration and the comparison", () => {
    const proposed = validateQualityContract({
      ...baseline,
      guardrails: baseline.guardrails.filter((guardrail) => guardrail.id !== "guardrail.accessibility"),
      comparison: { ...baseline.comparison, guardrailIds: ["guardrail.latency"] },
    });
    const reasons = contractWeakenings(baseline, proposed).map((item) => item.reason);
    expect(reasons).toContain("guardrail removed");
    expect(reasons).toContain('comparison no longer applies guardrail "guardrail.accessibility"');
  });
});

describe("effective contract", () => {
  const baseline = syntheticBaselineContract();

  it("is the baseline when nothing is proposed", () => {
    expect(qualityContractDigest(effectiveContract(baseline, undefined))).toBe(
      qualityContractDigest(baseline),
    );
  });

  it("keeps the baseline definition when an id collides, so a missed relaxation is inert", () => {
    const relaxed = validateQualityContract({
      ...baseline,
      guardrails: baseline.guardrails.map((guardrail) =>
        guardrail.id === "guardrail.latency" ? { ...guardrail, bound: 5000 } : guardrail,
      ),
    });
    const effective = effectiveContract(baseline, relaxed);
    expect(effective.guardrails.find((item) => item.id === "guardrail.latency")?.bound).toBe(800);
  });

  it("carries the proposal's additions", () => {
    const proposed = validateQualityContract({
      ...baseline,
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
    const effective = effectiveContract(baseline, proposed);
    expect(effective.outcomes.map((outcome) => outcome.id)).toContain("outcome.receipt.emailed");
  });
});
