import { SupportAiStreamError } from "./support-ai-review-service";
import { randomUUID } from "node:crypto";
import { sentenceSpans } from "./support-ai-policy";
import type { SuggestionAdapter } from "./support-ai-types";
import type { AiAttempt, AiDependencies, AiPolicy } from "./support-ai-review-types";
/** Local synthetic composition only. No network, credentials or hosted SDK. */
export function syntheticSupportAi(adapter?: SuggestionAdapter): AiDependencies {
  const completed = new Set<string>();
  const policies = new Map<string,AiPolicy>();
  const attempts = new Map<string,AiAttempt>();
  return {
    loadVoice: async () => undefined,
    // Synthetic invalid-output tests inject an owner quarantine fake. Runtime
    // synthetic output is deterministic and valid; no raw fallback persistence.
    quarantine: async () => { throw new Error("owner quarantine is not configured"); },
    inference: {
      prepare: async r => {
        const policy: AiPolicy = { preparationId: randomUUID(), provider: "synthetic", model: "support-fixture-v1", region: "us", retentionPosture: "zero_retention", allowlistVersion: "synthetic-support-v1", source: "platform_default", processingBasis: "tenant_region", consentId: null, consentPolicyVersion: null };
        policies.set(r.id,policy); return policy;
      },
      open: async (r,input,signal) => {
        const p = policies.get(r.id)!;
        const attempt: AiAttempt = { preparationId: p.preparationId, executionId: randomUUID(), tenantId: r.tenant_id, moduleId: "support", useCase: "reviewed-suggestion", provider: p.provider, model: p.model, region: p.region, retentionPosture: p.retentionPosture, allowlistVersion: p.allowlistVersion, credentialOrigin: "installation", terminal: "started", evidenceOrigin: "synthetic" };
        attempts.set(r.id,attempt);
        return { attempt, run: async () => {
          if (signal.aborted) return null;
          const chunk = input.knowledge[0]!;
          const span = sentenceSpans(chunk.body)[0]!;
          const text = chunk.body.slice(span.start,span.end);
          // The existing suggestion port is the provider boundary. R5 adapters
          // can be composed through it only after recorded routing evidence exists.
          const syntheticAdapter: SuggestionAdapter = adapter ?? { suggest: async () => ({ kind: "draft", category: "how_to", priority: "medium", reply: text, confidence: 1, claims: [{ text, citation: { chunkId: chunk.chunkId,...span } }] }) };
          let output;
          try { output = await syntheticAdapter.suggest(input); } catch { throw new SupportAiStreamError("ADAPTER_ERROR"); }
          completed.add(attempt.executionId); return output;
        } };
      },
      verify: async (r,p,a) => policies.get(r.id) === p && attempts.get(r.id) === a && completed.has(a.executionId),
    },
  };
}
