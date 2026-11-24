import { describe, expect, it } from "vitest";
import { qualityContractPersistenceCodec as codec, validateEvaluationRun } from "./persistence";
import { effectiveContract, qualityContractDigest } from "./contract";
import { syntheticBaselineContract, syntheticPassingRun, SYNTHETIC_BASELINE_METRICS } from "./synthetic";

const contract = syntheticBaselineContract();
const run = syntheticPassingRun(contract, SYNTHETIC_BASELINE_METRICS);
const baseline = { tenantId: "ten_a", moduleKey: contract.moduleId, moduleVersion: "1", artifactDigest: "a".repeat(64) };
const candidate = { ...baseline, moduleVersion: "2", artifactDigest: "b".repeat(64) };
const input = { baselineContract: contract, candidateContract: contract, baselineRun: run, candidateRun: run, baseline, candidate };
describe("quality persistence codec", () => {
  it("pins evaluator output and complete artifact lineage", () => {
    const result = codec.evaluation(input);
    expect(result.body.result.verdict).toBe("no_change");
    expect(result.body.baseline).toEqual(baseline);
    expect(result.body.candidate).toEqual(candidate);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(codec.evaluation(input)).toEqual(result);
    expect(codec.evaluation({ ...input, candidate: { ...candidate, artifactDigest: "c".repeat(64) } }).digest).not.toBe(result.digest);
  });
  it("rejects malformed, duplicate, non-finite and oversized runs", () => {
    for (const bad of [null, {}, { ...run, verdict: "accepted" }, { ...run, contractDigest: "weak" },
      { ...run, metrics: [{ metric: "x", value: NaN }] }, { ...run, metrics: [{ metric: "x", value: Infinity }] },
      { ...run, outcomes: [run.outcomes[0], run.outcomes[0]] },
      { ...run, journeys: [{ journeyId: "x", passed: "true" }] },
      { ...run, metrics: [{ metric: "x", value: 1 }, { metric: "x", value: 2 }] },
      { ...run, extra: "x".repeat(2 * 1024 * 1024) }]) {
      expect(() => validateEvaluationRun(bad)).toThrow();
    }
  });
  it("retains mismatched runs as rejected evidence and rejects relational mismatch", () => {
    const result = codec.evaluation({ ...input, candidateRun: { ...run, contractDigest: "f".repeat(64) } });
    expect(result.verdict).toBe("rejected");
    expect(result.body.result.failures[0]?.kind).toBe("run_contract_mismatch");
    expect(result.body.candidateRun.contractDigest).toBe("f".repeat(64));
    for (const bad of [{ ...candidate, tenantId: "ten_b" }, { ...candidate, artifactDigest: baseline.artifactDigest },
      { ...candidate, moduleVersion: baseline.moduleVersion }, { ...candidate, artifactDigest: "weak" },
      { ...candidate, moduleKey: "other" }]) expect(() => codec.evaluation({ ...input, candidate: bad })).toThrow();
  });
  it("retains weakening with no effective contract and composes additions", () => {
    const weak = { ...contract, version: 2, comparison: { ...contract.comparison, minimumEffect: 0.001 } };
    const rejected = codec.evaluation({ ...input, candidateContract: weak });
    expect(rejected.verdict).toBe("rejected");
    expect(rejected.body.effectiveContract).toBeNull();
    const proposed = { ...contract, version: 2, outcomes: [...contract.outcomes, { ...contract.outcomes[0]!, id: "outcome.extra" }] };
    const effective = effectiveContract(contract, proposed);
    const result = codec.evaluation({ ...input, candidateContract: proposed, candidateRun: syntheticPassingRun(effective, SYNTHETIC_BASELINE_METRICS) });
    expect(result.body.effectiveContractDigest).toBe(qualityContractDigest(effective));
    expect(result.body.effectiveContract?.outcomes).toHaveLength(contract.outcomes.length + 1);
  });
});
