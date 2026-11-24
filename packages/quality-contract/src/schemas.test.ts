import { describe, expect, it } from "vitest";
import {
  PROHIBITED_EVIDENCE_KINDS,
  QualityContractValidationError,
  validateComparison,
  validateEvidence,
  validateGuardrail,
  validateJourney,
  validateOutcome,
} from "./schemas";

const outcome = {
  id: "outcome.order.placed",
  owner: "platform",
  kind: "functional",
  statement: "A submitted cart becomes exactly one order",
  required: true,
};

describe("outcome", () => {
  it("accepts a well-formed outcome", () => {
    expect(validateOutcome(outcome).id).toBe("outcome.order.placed");
  });

  it("refuses an outcome with no owner, because ownership is what makes weakening checkable", () => {
    expect(() => validateOutcome({ ...outcome, owner: undefined })).toThrow(
      QualityContractValidationError,
    );
  });

  it("refuses an unknown assertion kind rather than filing it as functional", () => {
    expect(() => validateOutcome({ ...outcome, kind: "vibes" })).toThrow(
      /outcome.kind must be one of/,
    );
  });

  it("refuses an empty statement", () => {
    expect(() => validateOutcome({ ...outcome, statement: "   " })).toThrow(/must not be empty/);
  });
});

describe("journey", () => {
  const journey = {
    id: "journey.happy.path",
    owner: "platform",
    fixtureId: "fixture.cart.two.items",
    steps: ["open cart", "submit order"],
    assertedOutcomeIds: ["outcome.order.placed"],
  };

  it("accepts a well-formed journey", () => {
    expect(validateJourney(journey).steps).toHaveLength(2);
  });

  it("refuses a journey with no steps", () => {
    expect(() => validateJourney({ ...journey, steps: [] })).toThrow(/at least one step/);
  });

  it("refuses a journey that asserts nothing, which would pass by doing nothing", () => {
    expect(() => validateJourney({ ...journey, assertedOutcomeIds: [] })).toThrow(
      /at least one outcome/,
    );
  });
});

describe("evidence", () => {
  const evidence = {
    id: "evidence.errors",
    owner: "platform",
    kind: "structured_module_error",
    purpose: "Cluster checkout failures into opportunities",
    redactionPolicyVersion: "redaction.v1",
    retentionDays: 30,
  };

  it("accepts an eligible input kind", () => {
    expect(validateEvidence(evidence).kind).toBe("structured_module_error");
  });

  it.each(PROHIBITED_EVIDENCE_KINDS)("refuses the prohibited input %s by name", (kind) => {
    expect(() => validateEvidence({ ...evidence, kind })).toThrow(
      /is a prohibited input under PRD section 6.2/,
    );
  });

  it("refuses an unrecognised kind rather than admitting it", () => {
    expect(() => validateEvidence({ ...evidence, kind: "screen_recording" })).toThrow(
      /is not an eligible input/,
    );
  });

  it("refuses a retention period that is not a bounded positive integer", () => {
    expect(() => validateEvidence({ ...evidence, retentionDays: 0 })).toThrow(/retentionDays/);
    expect(() => validateEvidence({ ...evidence, retentionDays: 30.5 })).toThrow(/retentionDays/);
    expect(() => validateEvidence({ ...evidence, retentionDays: 4000 })).toThrow(/retentionDays/);
  });

  it("requires a stated purpose, because purpose limitation is per declaration", () => {
    expect(() => validateEvidence({ ...evidence, purpose: "" })).toThrow(/must not be empty/);
  });
});

describe("guardrail and comparison", () => {
  it("requires a guardrail to state the trade-off it refuses", () => {
    expect(() =>
      validateGuardrail({
        id: "guardrail.latency",
        owner: "platform",
        metric: "p95_latency_ms",
        direction: "lower_is_better",
        bound: 800,
        unacceptableTradeOff: "",
      }),
    ).toThrow(/unacceptableTradeOff/);
  });

  it("refuses a negative minimum effect", () => {
    expect(() =>
      validateComparison({
        primaryMetric: "task_completion_rate",
        direction: "higher_is_better",
        minimumEffect: -0.1,
        guardrailIds: [],
      }),
    ).toThrow(/must not be negative/);
  });
});
