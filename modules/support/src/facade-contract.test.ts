import { describe, expect, it } from "vitest";
import * as supportAi from "./support-ai";
import * as supportDepth from "./support-depth";

describe("support compatibility facades", () => {
  it("preserves the complete Support AI runtime export surface and a service outcome", async () => {
    expect(Object.keys(supportAi).sort()).toEqual([
      "InMemorySupportAiStore",
      "SupportAiService",
      "SyntheticSuggestionAdapter",
      "evaluateOfflineSupportAi",
    ]);

    const service = new supportAi.SupportAiService(
      new supportAi.InMemorySupportAiStore(),
      new supportAi.SyntheticSuggestionAdapter(),
    );
    await expect(service.suggest({
      tenantId: "tenant_example",
      installationId: "installation_example",
      actorId: "user_example",
      kind: "tenant_admin",
      permissions: ["support.ticket.read_tenant"],
    }, {
      ticketId: "ticket_example",
      ticketVersion: 1,
      subject: "Synthetic support request",
      body: "A bounded contract-test request.",
      publicReplies: [],
      category: "how_to",
      priority: "medium",
      status: "open",
      tags: [],
      attachments: [],
    })).resolves.toEqual({ kind: "unavailable", reason: "no_knowledge" });
  });

  it("preserves the complete Support Depth runtime export surface and a service outcome", async () => {
    expect(Object.keys(supportDepth).sort()).toEqual([
      "DELIVERY_MAX_ATTEMPTS",
      "InMemorySupportDepthStore",
      "SupportDepthService",
      "SyntheticDeliveryTransport",
    ]);

    const store = new supportDepth.InMemorySupportDepthStore();
    store.seedTicket({
      tenantId: "tenant_example",
      ticketId: "ticket_example",
      ticketNumber: "SUP-1",
      requesterId: "requester_example",
      status: "open",
      priority: "medium",
      version: 1,
      createdAt: "2026-08-07T12:00:00.000Z",
    });
    const service = new supportDepth.SupportDepthService(
      store,
      new supportDepth.SyntheticDeliveryTransport(),
    );
    await expect(service.analytics({
      tenantId: "tenant_example",
      actorId: "admin_example",
      kind: "tenant_admin",
      permissions: ["support.analytics.read"],
    })).resolves.toEqual({
      tenantId: "tenant_example",
      ticketCount: 1,
      resolvedCount: 0,
      deliveryFailureCount: 0,
      csatResponseCount: 0,
      averageCsat: null,
    });
  });
});
