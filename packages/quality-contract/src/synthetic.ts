/**
 * Synthetic modules only. PRD section 9 phase 0 proves baseline-versus-candidate
 * evaluation without any tenant signal, and phases 1 to 4 are gated on Developer
 * MCP tenant binding and a production-approved sandbox adapter. Nothing here may
 * be pointed at a real module.
 */
import { qualityContractDigest, validateQualityContract, type QualityContract } from "./contract";
import type { EvaluationRun, MetricSample } from "./evaluate";

export const SYNTHETIC_MODULE_ID = "synthetic.checkout";

/**
 * A baseline contract for a synthetic checkout module. Platform-owned elements
 * are the ones workspace code cannot weaken; the workspace-owned outcome shows
 * the difference is real and not decorative.
 */
export function syntheticBaselineContract(): QualityContract {
  return validateQualityContract({
    contractId: "synthetic.checkout.v1",
    moduleId: SYNTHETIC_MODULE_ID,
    version: 1,
    outcomes: [
      {
        id: "outcome.order.placed",
        owner: "platform",
        kind: "functional",
        statement: "A submitted cart becomes exactly one order",
        required: true,
      },
      {
        id: "outcome.tenant.isolation",
        owner: "platform",
        kind: "tenant_isolation",
        statement: "An order is never readable by another tenant",
        required: true,
      },
      {
        id: "outcome.keyboard.reachable",
        owner: "platform",
        kind: "accessibility",
        statement: "Every checkout control is reachable by keyboard",
        required: true,
      },
      {
        id: "outcome.cart.badge",
        owner: "workspace",
        kind: "usability",
        statement: "The cart badge shows the current item count",
        required: false,
      },
    ],
    journeys: [
      {
        id: "journey.happy.path",
        owner: "platform",
        fixtureId: "fixture.cart.two.items",
        steps: ["open cart", "submit order", "read confirmation"],
        assertedOutcomeIds: ["outcome.order.placed", "outcome.keyboard.reachable"],
      },
      {
        id: "journey.cross.tenant.probe",
        owner: "platform",
        fixtureId: "fixture.two.tenants",
        steps: ["place order as tenant a", "read order as tenant b"],
        assertedOutcomeIds: ["outcome.tenant.isolation"],
      },
    ],
    benchmarks: [
      {
        id: "benchmark.no.duplicate.charge",
        owner: "platform",
        derivedFromFailureId: "failure.duplicate.charge",
        metric: "duplicate_charge_rate",
        direction: "lower_is_better",
        threshold: 0,
      },
    ],
    guardrails: [
      {
        id: "guardrail.latency",
        owner: "platform",
        metric: "p95_latency_ms",
        direction: "lower_is_better",
        bound: 800,
        unacceptableTradeOff: "Completion rate bought with checkout latency users abandon",
      },
      {
        id: "guardrail.accessibility",
        owner: "platform",
        metric: "accessibility_violations",
        direction: "lower_is_better",
        bound: 0,
        unacceptableTradeOff: "Completion rate bought by removing accessible controls",
      },
    ],
    evidence: [
      {
        id: "evidence.errors",
        owner: "platform",
        kind: "structured_module_error",
        purpose: "Cluster checkout failures into opportunities",
        redactionPolicyVersion: "redaction.v1",
        retentionDays: 30,
      },
      {
        id: "evidence.completion",
        owner: "platform",
        kind: "task_completion_outcome",
        purpose: "Measure the primary metric",
        redactionPolicyVersion: "redaction.v1",
        retentionDays: 90,
      },
    ],
    comparison: {
      primaryMetric: "task_completion_rate",
      direction: "higher_is_better",
      minimumEffect: 0.02,
      guardrailIds: ["guardrail.latency", "guardrail.accessibility"],
    },
  });
}

/** Results in which every check passes, as the starting point for a fixture. */
export function syntheticPassingRun(contract: QualityContract, metrics: readonly MetricSample[]): EvaluationRun {
  return {
    contractDigest: qualityContractDigest(contract),
    outcomes: contract.outcomes.map((outcome) => ({ outcomeId: outcome.id, passed: true })),
    journeys: contract.journeys.map((journey) => ({ journeyId: journey.id, passed: true })),
    metrics,
  };
}

export const SYNTHETIC_BASELINE_METRICS: readonly MetricSample[] = [
  { metric: "task_completion_rate", value: 0.7 },
  { metric: "p95_latency_ms", value: 640 },
  { metric: "accessibility_violations", value: 0 },
  { metric: "duplicate_charge_rate", value: 0 },
];
