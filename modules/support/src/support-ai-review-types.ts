import type { AppliedSupportVoiceProfile, KnowledgeChunk, SuggestionAdapter, SuggestionDraft, SupportAiTicketInput } from "./support-ai-types";
import type { ModelResolutionErrorCode, ModelStreamFailureCode, ResolvedModel } from "@opentenant/platform-core";
import type { SupportClient } from "./ticket-store";

export const SUPPORT_AI_PERMISSIONS = { suggest: "support.ai.suggest", review: "support.ai.review" } as const;
export type AiTransaction = <T>(tenantId: string, work: (client: SupportClient) => Promise<T>) => Promise<T>;
export interface AiActor { tenantId: string; actorId: string; kind: "tenant_admin" }
export interface AiSource { articleId: string; chunkId: string; digest: string }
export interface AiInputs { ticket: SupportAiTicketInput; knowledge: readonly KnowledgeChunk[]; sources: readonly AiSource[] }
export interface AiControls { enabled: boolean; synthetic: boolean; epoch: number; daily_limit: number; actor_hourly_limit: number; retention_days: number }
export interface AiRequest {
  id: string; tenant_id: string; ticket_id: string; ticket_version: number; actor_id: string;
  idempotency_key: string; input_digest: string; input_watermark: string; sources: AiSource[];
  voice_version: number | null; voice_digest: string | null; control_epoch: number; admitted: boolean;
  created_at: Date; execution_deadline: Date; retention_until: Date;
}
export type AiTerminalKind = "review_required" | "abstained" | "unavailable" | "cancelled" | "consent_stale" | "provider_failure" | "policy_unavailable" | "unsupported_request" | "ticket_stale" | "audit_failure";
export type AiReason = "low_confidence" | "insufficient_information" | "disabled" | "budget_exhausted" | "rate_limited" | "no_knowledge" | "invalid_output" | "no_route" | "model_not_allowed" | "residency_mismatch" | "retention_mismatch" | "adapter_region_mismatch" | "user_cancelled" | "client_disconnected" | "policy_version_changed" | "consent_withdrawn" | "pair_no_longer_covered" | "prepared_policy_changed" | "consent_missing" | "adapter_unavailable" | "adapter_error" | "credential_unavailable" | "credential_broker_unavailable" | "credential_broker_failed" | "policy_store_unavailable" | "policy_unpinned" | "policy_mismatch" | "invalid_lifecycle" | "internal_error" | "ticket_state" | "capability_disabled" | "version_changed" | "resolution_evidence" | "terminal_evidence" | "support_evidence";
export interface AiTerminal { kind: AiTerminalKind; reason: AiReason | null; suggestion_id?: string | null; artifact_digest?: string | null }
export interface AiPolicy extends ResolvedModel {
  preparationId: string; processingBasis: "tenant_region" | "cross_border_consent";
  consentId: string | null; consentPolicyVersion: string | null;
}
export interface AiAttempt {
  preparationId: string; executionId: string; tenantId: string; moduleId: "support"; useCase: "reviewed-suggestion";
  provider: string; model: string; region: string; retentionPosture: string; allowlistVersion: string;
  credentialOrigin: "tenant" | "installation"; terminal: "started" | "completed" | "failed" | "cancelled";
  evidenceOrigin: "router" | "synthetic";
}
/** The production composition must read recorded router evidence, not infer it from a region string. */
export interface SupportAiInferencePort {
  prepare(request: AiRequest): Promise<AiPolicy>;
  open(request: AiRequest, input: Parameters<SuggestionAdapter["suggest"]>[0], signal: AbortSignal): Promise<{ attempt: AiAttempt; run(): Promise<unknown> }>;
  verify(request: AiRequest, policy: AiPolicy, attempt: AiAttempt): Promise<boolean>;
}
export interface AiArtifact { category: SuggestionDraft["category"]; priority: SuggestionDraft["priority"]; reply: string; claims: SuggestionDraft["claims"]; segments?: SuggestionDraft["segments"]; sources: readonly AiSource[]; schemaVersion: 1 }
export interface AiView {
  request: AiRequest | null; terminal: AiTerminal | { kind: "interrupted"; reason: "execution_deadline" } | null;
  suggestion: { id: string; artifact: AiArtifact; digest: string; review: "review_required" | "reviewed" | "dismissed" } | null;
  visibility: "current" | "stale" | "revoked" | "expired"; policy: AiPolicy | null;
  history?: Array<{ requestId: string; ticketVersion: number; artifact: AiArtifact; review: "review_required" | "reviewed" | "dismissed" }>;
}
export interface AiDependencies {
  inference: SupportAiInferencePort;
  loadVoice(tenantId: string): Promise<AppliedSupportVoiceProfile | undefined>;
  /** Owner-only encrypted quarantine, bounded to 24 hours. Never a normal suggestion row. */
  quarantine(request: AiRequest, output: unknown): Promise<void>;
}
export const ROUTER_OUTCOMES = {
  CALLER_RESIDENCY_FORBIDDEN: ["policy_unavailable", "policy_mismatch"], TENANT_POLICY_MISMATCH: ["policy_unavailable", "policy_mismatch"],
  NOT_ALLOWLISTED: ["unavailable", "model_not_allowed"], ROUTER_POLICY_UNPINNED: ["policy_unavailable", "policy_unpinned"],
  RESIDENCY_MISMATCH: ["unavailable", "residency_mismatch"], RETENTION_MISMATCH: ["unavailable", "retention_mismatch"], UNRESOLVABLE_SLOT: ["unavailable", "no_route"],
  CREDENTIAL_UNAVAILABLE: ["policy_unavailable", "credential_unavailable"], CREDENTIAL_BROKER_UNAVAILABLE: ["policy_unavailable", "credential_broker_unavailable"], CREDENTIAL_BROKER_FAILED: ["policy_unavailable", "credential_broker_failed"],
  POLICY_STORE_UNAVAILABLE: ["policy_unavailable", "policy_store_unavailable"], ADAPTER_UNAVAILABLE: ["provider_failure", "adapter_unavailable"], ADAPTER_REGION_MISMATCH: ["unavailable", "adapter_region_mismatch"],
  PREPARED_POLICY_STALE: ["consent_stale", "prepared_policy_changed"], PREPARED_STREAM_CONSUMED: ["policy_unavailable", "invalid_lifecycle"], CONSENT_POLICY_STALE: ["consent_stale", "policy_version_changed"], CONSENT_PAIRS_EMPTY: ["consent_stale", "consent_missing"],
  AUDIT_RECORDING_FAILED: ["audit_failure", "resolution_evidence"], AUDIT_ERROR: ["audit_failure", "terminal_evidence"], ADAPTER_ERROR: ["provider_failure", "adapter_error"],
} as const satisfies Record<ModelResolutionErrorCode | ModelStreamFailureCode, readonly [AiTerminalKind, AiReason]>;
