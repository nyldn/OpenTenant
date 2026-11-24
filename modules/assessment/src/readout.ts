import { createHash } from "node:crypto";
import type { ModelRouter, ModelStreamEvent, ResolvedModel, TenantId } from "@opentenant/platform-core";
export const ASSESSMENT_MODULE_ID = "assessment";
export const ASSESSMENT_READOUT_USE_CASE = "executive-readout";
const ASSESSMENT_READOUT_SLOT = "primary";

const SYSTEM_PROMPT =
  "You are an AI maturity advisor helping an organisation turn AI ambition into adopted, " +
  "everyday ways of working. Write an executive readout of an AI Maturity Assessment with " +
  "five pillars, 25 dimensions, and scores from 1 to 5. Use a declarative, confident, " +
  "operator-to-operator voice. Stay diagnostic, avoid promotion, hype, and emoji. Tie each " +
  "claim to a mechanism. Use short markdown sections for an opening verdict, where the " +
  "organisation is strong, where it is constrained, and what to do first. Reference the " +
  "30-day sprint and phase sequencing. Stay under 350 words and do not invent data.";

export type AssessmentReadoutPrincipal =
  | { kind: "identity"; principalId: string }
  | {
      kind: "passcode";
      principalId: string;
      tenantId: string;
      moduleKey: string;
    };

export interface PreparedAssessmentReadout {
  fingerprint: string;
  policy: ResolvedModel;
  stream(signal?: AbortSignal): AsyncGenerator<ModelStreamEvent>;
}

export interface AssessmentReadoutService {
  prepare(input: {
    tenantId: TenantId;
    principal: AssessmentReadoutPrincipal;
    summary: string;
  }): Promise<PreparedAssessmentReadout>;
}

export class AssessmentReadoutAuthorityError extends Error {
  constructor() {
    super("assessment readout authority is invalid");
    this.name = "AssessmentReadoutAuthorityError";
  }
}

function retryFingerprint(summary: string, policy: ResolvedModel): string {
  return createHash("sha256").update(JSON.stringify({
    summary,
    moduleId: ASSESSMENT_MODULE_ID,
    useCase: ASSESSMENT_READOUT_USE_CASE,
    slot: ASSESSMENT_READOUT_SLOT,
    policy: {
      provider: policy.provider,
      model: policy.model,
      region: policy.region,
      retentionPosture: policy.retentionPosture,
      allowlistVersion: policy.allowlistVersion,
      source: policy.source,
      pin: policy.pin ?? null,
    },
  })).digest("hex");
}

export function createAssessmentReadout(
  router: Pick<ModelRouter, "prepareStream">,
): AssessmentReadoutService {
  return {
    prepare: async ({ tenantId, principal, summary }) => {
      // OT-R01 derives both principal variants at the request boundary. A
      // verified passcode is equivalent authority only while its signed grant
      // remains bound to this tenant and the Assessment module.
      if (principal.kind === "passcode"
        && (principal.tenantId !== tenantId || principal.moduleKey !== ASSESSMENT_MODULE_ID)) {
        throw new AssessmentReadoutAuthorityError();
      }
      const prepared = await router.prepareStream({
        tenantId,
        moduleId: ASSESSMENT_MODULE_ID,
        useCase: ASSESSMENT_READOUT_USE_CASE,
        slot: ASSESSMENT_READOUT_SLOT,
      });
      return {
        policy: prepared.policy,
        fingerprint: retryFingerprint(summary, prepared.policy),
        stream: (signal?: AbortSignal) => prepared.stream({
          input: `${SYSTEM_PROMPT}\n\nAssessment summary:\n${summary}`,
          ...(signal ? { signal } : {}),
        }),
      };
    },
  };
}
