import type { ReplySegment } from "./reply-scaffold";
import type { TicketCategory, TicketPriority, TicketStatus } from "./types";

export type KnowledgeScope = "installation_shared" | "tenant_private";
export type KnowledgeStatus = "draft" | "published" | "revoked";

export interface SupportAiAuthority {
  tenantId: string;
  installationId: string;
  actorId: string;
  kind: "requester" | "tenant_admin" | "installation_owner" | "managed_support";
  permissions: ReadonlyArray<string>;
}

export interface KnowledgeProvenance {
  sourceRef: string;
  sourceVersion: string;
}

export interface KnowledgeRedaction {
  start: number;
  end: number;
  reason: string;
}

export interface KnowledgeArticle {
  id: string;
  installationId: string;
  tenantId: string | null;
  tenantIds: ReadonlyArray<string>;
  scope: KnowledgeScope;
  title: string;
  body: string;
  provenance: ReadonlyArray<KnowledgeProvenance>;
  redactions: ReadonlyArray<KnowledgeRedaction>;
  status: KnowledgeStatus;
  proposedBy: string;
  reviewedBy: string | null;
  publishedBy: string | null;
}

export interface KnowledgeChunk {
  chunkId: string;
  articleId: string;
  body: string;
  provenance: ReadonlyArray<KnowledgeProvenance>;
}

export interface SupportAiTicketInput {
  ticketId: string;
  ticketVersion: number;
  subject: string;
  body: string;
  publicReplies: ReadonlyArray<string>;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  tags: ReadonlyArray<string>;
  attachments: ReadonlyArray<{
    mediaType: string;
    byteSize: number;
    scanVerdict: "clean" | "rejected";
  }>;
}

export interface AppliedSupportVoiceProfile {
  bannedWords: ReadonlyArray<string>;
  version: number;
  digest: string;
}

export interface SuggestionCitation {
  chunkId: string;
  start: number;
  end: number;
}

export interface SuggestionDraft {
  kind: "draft";
  category: TicketCategory;
  priority: TicketPriority;
  reply: string;
  claims: ReadonlyArray<{ text: string; citation: SuggestionCitation }>;
  confidence: number;
  /**
   * Present when the reply is composed rather than concatenated. Segments are
   * the authority: the reply must render from them exactly. Absent, the older
   * rule applies and the reply must equal its claims joined by spaces.
   */
  segments?: ReadonlyArray<ReplySegment>;
}

export type AdapterSuggestion =
  | SuggestionDraft
  | { kind: "abstain"; reason: "low_confidence" | "insufficient_information" };

export interface SuggestionAdapter {
  suggest(input: {
    ticket: SupportAiTicketInput;
    knowledge: ReadonlyArray<KnowledgeChunk>;
    promptTemplateVersion: string;
  }): Promise<AdapterSuggestion>;
}

export type SuggestionOutcome =
  | {
      kind: "review_required";
      category: TicketCategory;
      priority: TicketPriority;
      reply: string;
      claims: SuggestionDraft["claims"];
    }
  | {
      kind: "abstained";
      reason: "low_confidence" | "insufficient_information";
    }
  | {
      kind: "unavailable";
      reason:
        | "disabled"
        | "budget_exhausted"
        | "no_knowledge"
        | "invalid_output"
        | "provider_failure";
    };

export interface SupportAiInferenceEvidence {
  id: string;
  installationId: string;
  tenantId: string;
  ticketId: string;
  actorId: string;
  promptDigest: string;
  promptTemplateVersion: string;
  inputWatermark: string;
  providerPolicyRef: string;
  voiceProfileVersion: number | null;
  voiceProfileDigest: string | null;
  outcome: SuggestionOutcome["kind"];
  reason: string | null;
}

export interface SupportAiEvidence {
  id: string;
  installationId: string;
  tenantId: string;
  actorId: string;
  action: string;
  subjectRef: string;
}
