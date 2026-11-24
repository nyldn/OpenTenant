import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "@opentenant/security";
import { effectiveContract, qualityContractDigest, validateQualityContract } from "./contract";
import { evaluateCandidate, type EvaluationRun } from "./evaluate";
import { QualityContractValidationError } from "./schemas";

export const QUALITY_EVALUATOR_VERSION = "quality-contract.phase0.v1";
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function invalid(): never {
  throw new QualityContractValidationError("Invalid quality persistence evidence");
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}

function bounded(value: unknown, bytes: number): void {
  const json = canonicalJsonStringify(value);
  if (json === undefined || Buffer.byteLength(json) > bytes) invalid();
}

function digest(value: unknown): string {
  const canonical = canonicalJsonStringify(value);
  if (canonical === undefined) invalid();
  return createHash("sha256").update(canonical).digest("hex");
}

/** Normalize before hashing; reject duplicate results and non-finite metrics. */
export function validateEvaluationRun(input: unknown): EvaluationRun {
  bounded(input, 2 * 1024 * 1024);
  const source = object(input);
  exact(source, ["contractDigest", "outcomes", "journeys", "metrics"]);
  if (typeof source.contractDigest !== "string" || !SHA256.test(source.contractDigest)) invalid();
  const results = (key: "outcomes" | "journeys" | "metrics", idKey: string, valueKey: string) => {
    const values = source[key];
    if (!Array.isArray(values) || values.length > 10_000) invalid();
    const seen = new Set<string>();
    return values.map(value => {
      const item = object(value);
      exact(item, [idKey, valueKey]);
      const id = item[idKey];
      const result = item[valueKey];
      if (typeof id !== "string" || !ID.test(id) || seen.has(id)) invalid();
      if (valueKey === "value" ? typeof result !== "number" || !Number.isFinite(result) : typeof result !== "boolean") invalid();
      seen.add(id);
      return { [idKey]: id, [valueKey]: result };
    });
  };
  // Each array has been checked against its exact result shape above.
  return {
    contractDigest: source.contractDigest,
    outcomes: results("outcomes", "outcomeId", "passed"),
    journeys: results("journeys", "journeyId", "passed"),
    metrics: results("metrics", "metric", "value"),
  } as unknown as EvaluationRun;
}

export interface QualityArtifactBinding {
  readonly tenantId: string;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly artifactDigest: string;
}

function artifactBinding(input: QualityArtifactBinding): QualityArtifactBinding {
  return { tenantId: input.tenantId, moduleKey: input.moduleKey, moduleVersion: input.moduleVersion, artifactDigest: input.artifactDigest };
}

export interface QualityEvaluationSource {
  readonly baselineContract: unknown;
  readonly candidateContract: unknown;
  readonly baselineRun: unknown;
  readonly candidateRun: unknown;
  readonly baseline: QualityArtifactBinding;
  readonly candidate: QualityArtifactBinding;
}

/** Trusted host dependency for PgQualityContractStore, never request-supplied. */
export const qualityContractPersistenceCodec = Object.freeze({
  contract(input: unknown) {
    bounded(input, 1024 * 1024);
    const body = validateQualityContract(input);
    return { body, contractId: body.contractId, moduleId: body.moduleId, version: body.version, digest: qualityContractDigest(body) };
  },
  run: validateEvaluationRun,
  evaluation(input: QualityEvaluationSource) {
    const baselineContract = validateQualityContract(input.baselineContract);
    const candidateContract = validateQualityContract(input.candidateContract);
    for (const binding of [input.baseline, input.candidate]) {
      if (!SHA256.test(binding.artifactDigest) || !binding.tenantId || !binding.moduleVersion
        || binding.moduleKey !== baselineContract.moduleId || binding.moduleKey !== candidateContract.moduleId) invalid();
    }
    if (input.baseline.tenantId !== input.candidate.tenantId
      || input.baseline.moduleVersion === input.candidate.moduleVersion
      || input.baseline.artifactDigest === input.candidate.artifactDigest) invalid();
    const baselineRun = validateEvaluationRun(input.baselineRun);
    const candidateRun = validateEvaluationRun(input.candidateRun);
    const proposedContract = qualityContractDigest(baselineContract) === qualityContractDigest(candidateContract) ? undefined : candidateContract;
    const result = evaluateCandidate({ baselineContract, ...(proposedContract ? { proposedContract } : {}), baselineRun, candidateRun });
    const effective = result.effectiveContractDigest === null ? null : effectiveContract(baselineContract, proposedContract);
    if (effective && qualityContractDigest(effective) !== result.effectiveContractDigest) invalid();
    const body = {
      evaluatorVersion: QUALITY_EVALUATOR_VERSION,
      baseline: artifactBinding(input.baseline), candidate: artifactBinding(input.candidate),
      baselineContractDigest: qualityContractDigest(baselineContract),
      candidateContractDigest: qualityContractDigest(candidateContract),
      baselineRun, candidateRun,
      baselineRunDigest: digest(baselineRun), candidateRunDigest: digest(candidateRun),
      effectiveContract: effective, effectiveContractDigest: result.effectiveContractDigest,
      result, resultDigest: digest(result),
    };
    bounded(body, 7 * 1024 * 1024);
    return { body, digest: digest(body), verdict: result.verdict, evaluatorVersion: QUALITY_EVALUATOR_VERSION };
  },
});
