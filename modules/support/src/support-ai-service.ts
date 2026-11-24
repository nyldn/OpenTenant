import { validSupportDraft, validSupportAbstention } from "./support-ai-validation";
import {
  SUPPORT_SCAFFOLD_VERSION,
} from "./reply-scaffold";
import { InMemorySupportAiStore } from "./support-ai-adapters";
import {
  PROMPT_TEMPLATE_VERSION,
  PROVIDER_POLICY_REF,
  applyRedactions,
  assertSafeReference,
  canManageKnowledge,
  canRetrieveKnowledge,
  sha256,
} from "./support-ai-policy";
import type {
  AppliedSupportVoiceProfile,
  KnowledgeArticle,
  KnowledgeChunk,
  KnowledgeProvenance,
  KnowledgeRedaction,
  KnowledgeScope,
  SuggestionAdapter,
  SuggestionOutcome,
  SupportAiAuthority,
  SupportAiTicketInput,
} from "./support-ai-types";

export class SupportAiService {
  constructor(
    private readonly store: InMemorySupportAiStore,
    private readonly adapter: SuggestionAdapter,
  ) {}

  async proposeKnowledge(
    authority: SupportAiAuthority,
    input: {
      scope: KnowledgeScope;
      tenantIds?: ReadonlyArray<string>;
      title: string;
      body: string;
      provenance: ReadonlyArray<KnowledgeProvenance>;
      redactions: ReadonlyArray<KnowledgeRedaction>;
    },
  ): Promise<KnowledgeArticle> {
    if (!canManageKnowledge(authority)) throw new Error("knowledge management authority required");
    if (input.provenance.length === 0) throw new Error("knowledge provenance required");
    if (input.title.trim() === "" || input.body.trim() === "") throw new Error("knowledge content required");
    for (const source of input.provenance) {
      assertSafeReference(source.sourceRef, "provenance source");
      assertSafeReference(source.sourceVersion, "provenance version");
    }
    for (const redaction of input.redactions) {
      if (
        !Number.isInteger(redaction.start) ||
        !Number.isInteger(redaction.end) ||
        redaction.start < 0 ||
        redaction.end <= redaction.start ||
        redaction.end > input.body.length ||
        redaction.reason.trim() === ""
      ) {
        throw new Error("invalid redaction review");
      }
    }
    const selectedTenants =
      input.scope === "installation_shared"
        ? [...new Set(input.tenantIds ?? [])]
        : [authority.tenantId];
    if (input.scope === "installation_shared" && authority.kind !== "installation_owner") {
      throw new Error("installation owner authority required");
    }
    if (selectedTenants.length === 0) throw new Error("shared knowledge tenant allowlist required");
    for (const tenantId of selectedTenants) assertSafeReference(tenantId, "tenant reference");

    const article: KnowledgeArticle = {
      id: this.store.nextId("knowledge"),
      installationId: authority.installationId,
      tenantId: input.scope === "tenant_private" ? authority.tenantId : null,
      tenantIds: selectedTenants,
      scope: input.scope,
      title: input.title,
      body: applyRedactions(input.body, input.redactions),
      provenance: input.provenance.map((source) => ({ ...source })),
      redactions: input.redactions.map((redaction) => ({ ...redaction })),
      status: "draft",
      proposedBy: authority.actorId,
      reviewedBy: null,
      publishedBy: null,
    };
    this.store.articles.push(article);
    this.recordEvidence(authority, "support.knowledge.proposed", article.id);
    return article;
  }

  async publishKnowledge(
    authority: SupportAiAuthority,
    articleId: string,
  ): Promise<KnowledgeArticle> {
    if (!canManageKnowledge(authority)) throw new Error("human publication authority required");
    const article = this.articleForInstallation(authority, articleId);
    if (article.status !== "draft") throw new Error("knowledge article is not a draft");
    if (article.scope === "tenant_private" && article.tenantId !== authority.tenantId) {
      throw new Error("knowledge article not found");
    }
    if (article.scope === "installation_shared" && authority.kind !== "installation_owner") {
      throw new Error("human publication authority required");
    }
    article.status = "published";
    article.reviewedBy = authority.actorId;
    article.publishedBy = authority.actorId;
    this.recordEvidence(authority, "support.knowledge.published", article.id);
    return article;
  }

  async promoteKnowledge(
    authority: SupportAiAuthority,
    articleId: string,
  ): Promise<KnowledgeArticle> {
    if (!canManageKnowledge(authority) || authority.kind !== "installation_owner") {
      throw new Error("installation owner promotion authority required");
    }
    const source = this.articleForInstallation(authority, articleId);
    if (source.scope !== "tenant_private" || source.status !== "published") {
      throw new Error("published tenant-private knowledge required");
    }
    if (source.proposedBy === authority.actorId) {
      throw new Error("promotion requires a different human reviewer");
    }
    const promoted: KnowledgeArticle = {
      ...source,
      id: this.store.nextId("knowledge"),
      tenantId: null,
      tenantIds: [source.tenantId!],
      scope: "installation_shared",
      proposedBy: source.proposedBy,
      reviewedBy: authority.actorId,
      publishedBy: authority.actorId,
      provenance: source.provenance.map((item) => ({ ...item })),
      redactions: source.redactions.map((item) => ({ ...item })),
    };
    this.store.articles.push(promoted);
    this.recordEvidence(authority, "support.knowledge.promoted", promoted.id);
    return promoted;
  }

  retrieveKnowledge(
    authority: SupportAiAuthority,
    query: string,
  ): ReadonlyArray<KnowledgeChunk> {
    if (!canRetrieveKnowledge(authority)) return [];
    const terms = query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 3);
    return this.store.articles
      .filter(
        (article) =>
          article.status === "published" &&
          article.installationId === authority.installationId &&
          article.tenantIds.includes(authority.tenantId) &&
          (article.scope === "installation_shared" || article.tenantId === authority.tenantId),
      )
      .filter((article) => {
        const searchable = `${article.title} ${article.body}`.toLocaleLowerCase();
        return terms.some((term) => searchable.includes(term));
      })
      .map((article) => ({
        chunkId: `${article.id}:body`,
        articleId: article.id,
        body: article.body,
        provenance: article.provenance,
      }));
  }

  async suggest(
    authority: SupportAiAuthority,
    ticket: SupportAiTicketInput,
    appliedVoiceProfile?: AppliedSupportVoiceProfile,
  ): Promise<SuggestionOutcome> {
    let outcome: SuggestionOutcome;
    if (this.store.disabledTenants.has(authority.tenantId)) {
      outcome = { kind: "unavailable", reason: "disabled" };
      await this.recordInference(authority, ticket, [], outcome, appliedVoiceProfile);
      return outcome;
    }
    if (this.store.exhaustedBudgetTenants.has(authority.tenantId)) {
      outcome = { kind: "unavailable", reason: "budget_exhausted" };
      await this.recordInference(authority, ticket, [], outcome, appliedVoiceProfile);
      return outcome;
    }

    const knowledge = this.retrieveKnowledge(authority, `${ticket.subject} ${ticket.body}`);
    if (knowledge.length === 0) {
      outcome = { kind: "unavailable", reason: "no_knowledge" };
      await this.recordInference(authority, ticket, [], outcome, appliedVoiceProfile);
      return outcome;
    }

    try {
      const suggestion: unknown = await this.adapter.suggest({
        ticket,
        knowledge,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      });
      if (validSupportAbstention(suggestion)) {
        outcome = { kind: "abstained", reason: suggestion.reason };
      } else if (!validSupportDraft(suggestion, knowledge, appliedVoiceProfile?.bannedWords ?? [])) {
        outcome = { kind: "unavailable", reason: "invalid_output" };
      } else if (suggestion.confidence < 0.5) {
        outcome = { kind: "abstained", reason: "low_confidence" };
      } else {
        outcome = {
          kind: "review_required",
          category: suggestion.category,
          priority: suggestion.priority,
          reply: suggestion.reply,
          claims: suggestion.claims,
        };
      }
    } catch {
      outcome = { kind: "unavailable", reason: "provider_failure" };
    }
    await this.recordInference(authority, ticket, knowledge, outcome, appliedVoiceProfile);
    return outcome;
  }

  private articleForInstallation(
    authority: SupportAiAuthority,
    articleId: string,
  ): KnowledgeArticle {
    const article = this.store.articles.find(
      (candidate) =>
        candidate.id === articleId && candidate.installationId === authority.installationId,
    );
    if (!article) throw new Error("knowledge article not found");
    return article;
  }

  private recordEvidence(
    authority: SupportAiAuthority,
    action: string,
    subjectRef: string,
  ): void {
    this.store.evidence.push({
      id: this.store.nextId("evidence"),
      installationId: authority.installationId,
      tenantId: authority.tenantId,
      actorId: authority.actorId,
      action,
      subjectRef,
    });
  }

  private async recordInference(
    authority: SupportAiAuthority,
    ticket: SupportAiTicketInput,
    knowledge: ReadonlyArray<KnowledgeChunk>,
    outcome: SuggestionOutcome,
    appliedVoiceProfile?: AppliedSupportVoiceProfile,
  ): Promise<void> {
    const inputWatermark = `${ticket.ticketId}:v${ticket.ticketVersion}:replies${ticket.publicReplies.length}`;
    const promptDigest = await sha256(JSON.stringify({
      template: PROMPT_TEMPLATE_VERSION,
      scaffold: SUPPORT_SCAFFOLD_VERSION,
      ticket,
      chunks: knowledge.map((chunk) => ({
        chunkId: chunk.chunkId,
        body: chunk.body,
      })),
      ...(appliedVoiceProfile
        ? {
          voiceProfile: {
            version: appliedVoiceProfile.version,
            digest: appliedVoiceProfile.digest,
          },
        }
        : {}),
    }));
    this.store.inferences.push({
      id: this.store.nextId("inference"),
      installationId: authority.installationId,
      tenantId: authority.tenantId,
      ticketId: ticket.ticketId,
      actorId: authority.actorId,
      promptDigest,
      promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      inputWatermark,
      providerPolicyRef: PROVIDER_POLICY_REF,
      voiceProfileVersion: appliedVoiceProfile?.version ?? null,
      voiceProfileDigest: appliedVoiceProfile?.digest ?? null,
      outcome: outcome.kind,
      reason: "reason" in outcome ? outcome.reason : null,
    });
  }
}
