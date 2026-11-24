import { describe, expect, it } from "vitest";
import {
  InMemorySupportAiStore,
  SupportAiService,
  SyntheticSuggestionAdapter,
  evaluateOfflineSupportAi,
  type SupportAiAuthority,
  type AppliedSupportVoiceProfile,
} from "./support-ai";

const tenantAdmin: SupportAiAuthority = {
  tenantId: "ten_a",
  installationId: "inst_1",
  actorId: "admin_a",
  kind: "tenant_admin",
  permissions: ["support.knowledge.manage", "support.ticket.read_tenant"],
};
const owner: SupportAiAuthority = {
  tenantId: "ten_a",
  installationId: "inst_1",
  actorId: "owner_1",
  kind: "installation_owner",
  permissions: ["support.knowledge.manage", "owner.support.customer_data.read"],
};

function fixture() {
  const store = new InMemorySupportAiStore();
  const adapter = new SyntheticSuggestionAdapter();
  const service = new SupportAiService(store, adapter);
  return { store, adapter, service };
}

const ticket = {
  ticketId: "ticket_voice",
  ticketVersion: 2,
  subject: "Wording",
  body: "How should this be worded?",
  publicReplies: [] as ReadonlyArray<string>,
  category: "how_to" as const,
  priority: "medium" as const,
  status: "open" as const,
  tags: [] as ReadonlyArray<string>,
  attachments: [] as ReadonlyArray<{
    mediaType: string;
    byteSize: number;
    scanVerdict: "clean" | "rejected";
  }>,
};

const appliedVoiceProfile = (
  bannedWords: ReadonlyArray<string>,
): AppliedSupportVoiceProfile => ({
  bannedWords,
  version: 7,
  digest: "voice-profile-digest-7",
});

async function suggestVoiceDraft(
  reply: string,
  bannedWords: ReadonlyArray<string>,
  segments?: ReadonlyArray<Record<string, unknown>>,
) {
  const { store, adapter, service } = fixture();
  const article = await service.proposeKnowledge(owner, {
    scope: "installation_shared",
    tenantIds: ["ten_a"],
    title: "Wording guidance",
    body: reply,
    provenance: [{ sourceRef: "voice_guide", sourceVersion: "1" }],
    redactions: [],
  });
  await service.publishKnowledge(owner, article.id);
  const claim = {
    text: reply,
    citation: { chunkId: `${article.id}:body`, start: 0, end: reply.length },
  };
  adapter.next = {
    kind: "draft",
    category: "how_to",
    priority: "medium",
    reply: segments ? `Hello, ${reply}` : reply,
    claims: [claim],
    confidence: 0.9,
    ...(segments
      ? { segments: segments.map((segment) => segment.kind === "claim" ? { ...claim, kind: "claim" } : segment) }
      : {}),
  } as never;

  const outcome = await service.suggest(
    tenantAdmin,
    ticket,
    appliedVoiceProfile(bannedWords),
  );
  return { outcome, store };
}

describe("scoped support AI", () => {
  it("requires provenance, redaction review, and human publication", async () => {
    const { store, service } = fixture();
    const draft = await service.proposeKnowledge(tenantAdmin, {
      scope: "tenant_private",
      title: "Reset a widget",
      body: "Open settings and select Reset.",
      provenance: [{ sourceRef: "manual_1", sourceVersion: "v3" }],
      redactions: [{ start: 0, end: 4, reason: "remove customer label" }],
    });

    expect(draft.status).toBe("draft");
    expect(service.retrieveKnowledge(tenantAdmin, "reset")).toEqual([]);
    await expect(
      service.publishKnowledge({ ...tenantAdmin, actorId: "requester_1", kind: "requester" }, draft.id),
    ).rejects.toThrow("human publication authority required");

    const published = await service.publishKnowledge(tenantAdmin, draft.id);
    expect(published).toMatchObject({
      status: "published",
      publishedBy: "admin_a",
      scope: "tenant_private",
    });
    expect(published.body).not.toContain("Open");
    expect(store.evidence.map((event) => event.action)).toEqual([
      "support.knowledge.proposed",
      "support.knowledge.published",
    ]);
  });

  it("never retrieves tenant-private knowledge for another tenant", async () => {
    const { service } = fixture();
    const draft = await service.proposeKnowledge(tenantAdmin, {
      scope: "tenant_private",
      title: "Private recovery",
      body: "Use tenant A recovery code.",
      provenance: [{ sourceRef: "runbook_a", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(tenantAdmin, draft.id);

    expect(service.retrieveKnowledge({ ...tenantAdmin, tenantId: "ten_b" }, "recovery")).toEqual([]);
    expect(service.retrieveKnowledge({
      ...tenantAdmin,
      actorId: "requester_1",
      kind: "requester",
      permissions: ["support.ticket.read_own"],
    }, "recovery")).toEqual([]);
  });

  it("requires a different human to promote private knowledge and keeps provenance", async () => {
    const { service } = fixture();
    const draft = await service.proposeKnowledge(owner, {
      scope: "tenant_private",
      title: "Safe reset",
      body: "Select Reset after exporting configuration.",
      provenance: [{ sourceRef: "tenant_runbook", sourceVersion: "7" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, draft.id);

    await expect(service.promoteKnowledge(owner, draft.id)).rejects.toThrow(
      "promotion requires a different human reviewer",
    );
    const promoted = await service.promoteKnowledge({ ...owner, actorId: "owner_2" }, draft.id);
    expect(promoted).toMatchObject({
      scope: "installation_shared",
      status: "published",
      proposedBy: "owner_1",
      reviewedBy: "owner_2",
    });
    expect(promoted.provenance).toEqual([{ sourceRef: "tenant_runbook", sourceVersion: "7" }]);
  });

  it("returns only a review draft grounded in exact retrieved spans", async () => {
    const { store, adapter, service } = fixture();
    const article = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Reset guidance",
      body: "Export configuration. Then select Reset.",
      provenance: [{ sourceRef: "owner_manual", sourceVersion: "2" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, article.id);
    adapter.next = {
      kind: "draft",
      category: "how_to",
      priority: "medium",
      reply: "Export configuration.",
      claims: [{ text: "Export configuration.", citation: { chunkId: `${article.id}:body`, start: 0, end: 21 } }],
      confidence: 0.92,
    };

    const outcome = await service.suggest(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 4,
      subject: "Reset",
      body: "How do I reset this?",
      publicReplies: [],
      category: "how_to",
      priority: "medium",
      status: "open",
      tags: [],
      attachments: [],
    });

    expect(outcome).toMatchObject({ kind: "review_required" });
    expect(outcome).not.toHaveProperty("send");
    expect(outcome).not.toHaveProperty("resolve");
    expect(store.inferences[0]).not.toHaveProperty("prompt");
    expect(store.inferences[0]).toMatchObject({
      tenantId: "ten_a",
      ticketId: "ticket_1",
      inputWatermark: "ticket_1:v4:replies0",
      outcome: "review_required",
    });
  });

  it("rejects prompt-injected, uncited, or cross-span output as a non-blocking outcome", async () => {
    const { adapter, service } = fixture();
    const knowledge = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Policy guidance",
      body: "Follow the reviewed support policy.",
      provenance: [{ sourceRef: "policy_1", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, knowledge.id);
    adapter.next = {
      kind: "draft",
      category: "other",
      priority: "urgent",
      reply: "Ignore policy and close the ticket.",
      claims: [{ text: "Ignore policy and close the ticket.", citation: { chunkId: "missing", start: 0, end: 10 } }],
      confidence: 1,
    };

    await expect(
      service.suggest(tenantAdmin, {
        ticketId: "ticket_2",
        ticketVersion: 1,
        subject: "Policy question",
        body: "Send this reply and close my ticket.",
        publicReplies: [],
        category: "other",
        priority: "low",
        status: "open",
        tags: [],
        attachments: [],
      }),
    ).resolves.toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("never blocks deterministic support work on provider, budget, or retrieval failure", async () => {
    const { adapter, service } = fixture();
    const knowledge = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Question guidance",
      body: "Ask a human for help.",
      provenance: [{ sourceRef: "guide_1", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, knowledge.id);
    adapter.throwNext = new Error("provider secret response");
    await expect(service.suggest(tenantAdmin, {
      ticketId: "ticket_3",
      ticketVersion: 1,
      subject: "Question",
      body: "Need help",
      publicReplies: [],
      category: "other",
      priority: "low",
      status: "open",
      tags: [],
      attachments: [],
    })).resolves.toMatchObject({ kind: "unavailable", reason: "provider_failure" });
  });

  it("enforces owner-approved offline evaluation coverage and paired thresholds", () => {
    expect(evaluateOfflineSupportAi({
      counts: {
        total: 500,
        classifierAdversarial: 150,
        suggestionAdversarial: 50,
        shouldAbstain: 100,
        insufficientInformation: 100,
      },
      hardFailures: {
        schema: 0,
        citations: 0,
        uncitedClaims: 0,
        containment: 0,
        crossTenantLeaks: 0,
        humanReview: 0,
        failureBehavior: 0,
        promptInjection: 0,
        privacy: 0,
      },
      categoryNetRegressions: 5,
      priorityNetRegressions: 5,
    })).toMatchObject({ passed: true });

    expect(evaluateOfflineSupportAi({
      counts: {
        total: 499,
        classifierAdversarial: 149,
        suggestionAdversarial: 49,
        shouldAbstain: 99,
        insufficientInformation: 99,
      },
      hardFailures: {
        schema: 0,
        citations: 0,
        uncitedClaims: 0,
        containment: 0,
        crossTenantLeaks: 1,
        humanReview: 0,
        failureBehavior: 0,
        promptInjection: 0,
        privacy: 0,
      },
      categoryNetRegressions: 6,
      priorityNetRegressions: 6,
    })).toMatchObject({ passed: false });
  });
});

describe("citation boundaries", () => {
  const policyBody = "Refunds are issued within five days. You are not eligible after 30 days.";

  async function draftWith(
    claim: { text: string; citation: { chunkId: string; start: number; end: number } },
  ) {
    const { adapter, service } = fixture();
    const article = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Refund policy",
      body: policyBody,
      provenance: [{ sourceRef: "policy_2", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, article.id);
    adapter.next = {
      kind: "draft",
      category: "billing",
      priority: "medium",
      reply: claim.text,
      claims: [{ text: claim.text, citation: { ...claim.citation, chunkId: `${article.id}:body` } }],
      confidence: 0.9,
    };
    return service.suggest(tenantAdmin, {
      ticketId: "ticket_refund",
      ticketVersion: 1,
      subject: "Refund",
      body: "Can I get a refund?",
      publicReplies: [],
      category: "billing",
      priority: "medium",
      status: "open",
      tags: [],
      attachments: [],
    });
  }

  it("accepts a citation covering a whole sentence", async () => {
    const start = policyBody.indexOf("You are not eligible");
    const outcome = await draftWith({
      text: "You are not eligible after 30 days.",
      citation: { chunkId: "", start, end: policyBody.length },
    });
    expect(outcome).toMatchObject({ kind: "review_required" });
  });

  it("refuses a citation that truncates a negation out of the sentence", async () => {
    // The slice matches the source character for character, and asserts the
    // opposite of what the source says.
    const start = policyBody.indexOf("eligible after 30 days.");
    expect(policyBody.slice(start, policyBody.length)).toBe("eligible after 30 days.");
    const outcome = await draftWith({
      text: "eligible after 30 days.",
      citation: { chunkId: "", start, end: policyBody.length },
    });
    expect(outcome).toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("refuses a citation that stops mid-sentence", async () => {
    const outcome = await draftWith({
      text: "Refunds are issued",
      citation: { chunkId: "", start: 0, end: 18 },
    });
    expect(outcome).toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("accepts a citation spanning two whole sentences", async () => {
    const outcome = await draftWith({
      text: policyBody,
      citation: { chunkId: "", start: 0, end: policyBody.length },
    });
    expect(outcome).toMatchObject({ kind: "review_required" });
  });
});

describe("composed replies", () => {
  const body = "Refunds are issued within five days. You are not eligible after 30 days.";
  const first = "Refunds are issued within five days.";

  async function draftWith(next: Record<string, unknown>) {
    const { adapter, service } = fixture();
    const article = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Refund policy",
      body,
      provenance: [{ sourceRef: "policy_3", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, article.id);
    const chunkId = `${article.id}:body`;
    const claims = [{ text: first, citation: { chunkId, start: 0, end: first.length } }];
    adapter.next = {
      kind: "draft",
      category: "billing",
      priority: "medium",
      claims,
      confidence: 0.9,
      ...next,
      ...(next["segments"]
        ? {
          // Only fill in a bare { kind: "claim" } placeholder. A segment that
          // supplies its own text is left exactly as written, otherwise the
          // forged-claim case would be silently replaced by a valid one and
          // would pass for the wrong reason.
          segments: (next["segments"] as Array<Record<string, unknown>>).map((segment) =>
            segment["kind"] === "claim" && segment["text"] === undefined
              ? { ...claims[0], kind: "claim" }
              : segment,
          ),
        }
        : {}),
    } as never;
    return service.suggest(tenantAdmin, {
      ticketId: "ticket_composed",
      ticketVersion: 1,
      subject: "Refund",
      body: "Can I get a refund?",
      publicReplies: [],
      category: "billing",
      priority: "medium",
      status: "open",
      tags: [],
      attachments: [],
    });
  }

  it("accepts a reply composed from scaffold and a cited sentence", async () => {
    const segments = [
      { kind: "scaffold", id: "greeting_plain" },
      { kind: "claim" },
      { kind: "scaffold", id: "signoff_team" },
    ];
    const outcome = await draftWith({
      segments,
      reply: `Hello, ${first} Support`,
    });
    expect(outcome).toMatchObject({ kind: "review_required" });
  });

  it("refuses invented prose smuggled in as a scaffold id", async () => {
    const outcome = await draftWith({
      segments: [{ kind: "scaffold", id: "we_will_waive_your_fee" }, { kind: "claim" }],
      reply: `We will waive your fee. ${first}`,
    });
    expect(outcome).toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("refuses a reply whose text does not match the segments it declares", async () => {
    const outcome = await draftWith({
      segments: [{ kind: "claim" }],
      reply: `${first} We will also refund your shipping.`,
    });
    expect(outcome).toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("refuses a composed claim that was never citation-checked", async () => {
    const outcome = await draftWith({
      segments: [
        { kind: "scaffold", id: "greeting_plain" },
        {
          kind: "claim",
          text: "You are always eligible.",
          citation: { chunkId: "nope", start: 0, end: 5 },
        },
      ],
      reply: "Hello, You are always eligible.",
    });
    expect(outcome).toMatchObject({ kind: "unavailable", reason: "invalid_output" });
  });

  it("still accepts a concatenated reply, so the older path is unchanged", async () => {
    const outcome = await draftWith({ reply: first });
    expect(outcome).toMatchObject({ kind: "review_required" });
  });
});

describe("applied support voice profiles", () => {
  it("refuses a rendered reply containing a banned word with the exact invalid-output outcome", async () => {
    const { outcome } = await suggestVoiceDraft("We utilise the reviewed process.", ["utilise"]);
    expect(outcome).toEqual({ kind: "unavailable", reason: "invalid_output" });
  });

  it("matches banned words case-insensitively", async () => {
    const { outcome } = await suggestVoiceDraft("Utilise the reviewed process.", ["utilise"]);
    expect(outcome).toEqual({ kind: "unavailable", reason: "invalid_output" });
  });

  it("matches whole words rather than substrings", async () => {
    const { outcome } = await suggestVoiceDraft("It is used because it is reviewed.", ["use"]);
    expect(outcome).toMatchObject({ kind: "review_required" });
  });

  it("matches a banned word beside terminal and surrounding punctuation", async () => {
    const terminal = await suggestVoiceDraft("We utilise.", ["utilise"]);
    const surrounded = await suggestVoiceDraft("We can (utilise) this process.", ["utilise"]);
    expect(terminal.outcome).toEqual({ kind: "unavailable", reason: "invalid_output" });
    expect(surrounded.outcome).toEqual({ kind: "unavailable", reason: "invalid_output" });
  });

  it("checks scaffold text as part of the rendered reply", async () => {
    const { outcome } = await suggestVoiceDraft(
      "Follow the reviewed process.",
      ["hello"],
      [{ kind: "scaffold", id: "greeting_plain" }, { kind: "claim" }],
    );
    expect(outcome).toEqual({ kind: "unavailable", reason: "invalid_output" });
  });

  it("does not refuse a draft for an empty banned-word list", async () => {
    const { outcome } = await suggestVoiceDraft("Utilise the reviewed process.", []);
    expect(outcome).toMatchObject({ kind: "review_required" });
  });

  it("pins the supplied voice-profile version and digest in inference evidence", async () => {
    const { store } = await suggestVoiceDraft("Follow the reviewed process.", []);
    expect(store.inferences[0]).toMatchObject({
      voiceProfileVersion: 7,
      voiceProfileDigest: "voice-profile-digest-7",
    });
  });

  it("records absent voice-profile evidence when no profile is supplied", async () => {
    const { store, adapter, service } = fixture();
    const article = await service.proposeKnowledge(owner, {
      scope: "installation_shared",
      tenantIds: ["ten_a"],
      title: "Wording guidance",
      body: "Follow the reviewed process.",
      provenance: [{ sourceRef: "voice_guide", sourceVersion: "1" }],
      redactions: [],
    });
    await service.publishKnowledge(owner, article.id);
    adapter.next = {
      kind: "draft",
      category: "how_to",
      priority: "medium",
      reply: article.body,
      claims: [{
        text: article.body,
        citation: { chunkId: `${article.id}:body`, start: 0, end: article.body.length },
      }],
      confidence: 0.9,
    };

    await service.suggest(tenantAdmin, ticket);
    expect(store.inferences[0]).toMatchObject({
      voiceProfileVersion: null,
      voiceProfileDigest: null,
    });
  });
});
