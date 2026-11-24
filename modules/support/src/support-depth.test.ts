import { describe, expect, it } from "vitest";
import {
  DELIVERY_MAX_ATTEMPTS,
  InMemorySupportDepthStore,
  SyntheticDeliveryTransport,
  SupportDepthService,
  type SupportAuthority,
} from "./support-depth";

const requester: SupportAuthority = {
  tenantId: "ten_a",
  actorId: "user_requester",
  kind: "requester",
  permissions: [
    "support.ticket.create",
    "support.ticket.read_own",
    "support.ticket.reply_own",
  ],
};
const tenantAdmin: SupportAuthority = {
  tenantId: "ten_a",
  actorId: "user_admin",
  kind: "tenant_admin",
  permissions: [
    "support.ticket.read_tenant",
    "support.ticket.reply",
    "support.ticket.manage",
    "support.config.manage",
    "support.analytics.read",
  ],
};
const managedOwner: SupportAuthority = {
  tenantId: "ten_a",
  actorId: "owner_1",
  kind: "installation_owner",
  permissions: ["owner.support.customer_data.read"],
  supportSession: {
    id: "session_1",
    tenantId: "ten_a",
    operatorId: "owner_1",
    expiresAt: "2099-07-27T11:00:00.000Z",
  },
};

function fixture() {
  const store = new InMemorySupportDepthStore();
  store.seedTicket({
    tenantId: "ten_a",
    ticketId: "ticket_1",
    ticketNumber: "SUP-000001",
    requesterId: requester.actorId,
    status: "open",
    priority: "high",
    version: 2,
    createdAt: "2026-07-27T10:00:00.000Z",
  });
  const transport = new SyntheticDeliveryTransport();
  return { store, transport, service: new SupportDepthService(store, transport) };
}

describe("support depth delivery contracts", () => {
  it("keeps preferences, safe destinations, attempts, and idempotency canonical and tenant bound", async () => {
    const { store, transport, service } = fixture();
    await service.setDeliveryPreference(tenantAdmin, {
      subjectId: requester.actorId,
      channel: "email",
      enabled: true,
      destinationRef: "email_destination_01",
    });

    const first = await service.deliver(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 2,
      channel: "email",
      event: "reply",
    });
    const replay = await service.deliver(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 2,
      channel: "email",
      event: "reply",
    });

    expect(first).toMatchObject({ status: "delivered", tenantId: "ten_a" });
    expect(replay.id).toBe(first.id);
    expect(transport.deliveries).toHaveLength(1);
    expect(JSON.stringify(store.attempts)).not.toContain("@");
    await expect(
      service.deliver(tenantAdmin, {
        ticketId: "ticket_1",
        ticketVersion: 3,
        channel: "email",
        event: "reply",
      }),
    ).rejects.toThrow("stale ticket version");
    store.setTicketStatus("ten_a", "ticket_1", "in_progress", "2026-07-27T10:05:00.000Z");
    await expect(
      service.deliver(tenantAdmin, {
        ticketId: "ticket_1",
        ticketVersion: 2,
        channel: "email",
        event: "assigned",
      }),
    ).resolves.toMatchObject({ ticketVersion: 2, status: "delivered" });
    await expect(
      service.deliver({ ...tenantAdmin, tenantId: "ten_b" }, {
        ticketId: "ticket_1",
        ticketVersion: 3,
        channel: "email",
        event: "reply",
      }),
    ).rejects.toThrow("ticket not found");
  });

  it("records safe failure evidence and recovers by appending a new attempt without external calls", async () => {
    const { store, transport, service } = fixture();
    await service.setDeliveryPreference(tenantAdmin, {
      subjectId: requester.actorId,
      channel: "in_app",
      enabled: true,
      destinationRef: "user_requester",
    });
    transport.failNext("transient");

    const failed = await service.deliver(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 2,
      channel: "in_app",
      event: "reply",
    });
    const recovered = await service.retryDelivery(tenantAdmin, failed.id);

    expect(failed).toMatchObject({ status: "failed", safeErrorClass: "transient" });
    expect(recovered).toMatchObject({ status: "delivered", retryOf: failed.id });
    expect(store.attempts).toHaveLength(2);
    expect(store.evidence.map((event) => event.action)).toEqual([
      "support.delivery_preference.updated",
      "support.delivery.failed",
      "support.delivery.recovered",
    ]);
  });

  it("normalises transport exceptions and bounds retry to transient failures", async () => {
    const { store, transport, service } = fixture();
    await service.setDeliveryPreference(tenantAdmin, {
      subjectId: requester.actorId,
      channel: "email",
      enabled: true,
      destinationRef: "email_destination_01",
    });
    transport.throwNext(new Error("provider secret response"));

    const failed = await service.deliver(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 2,
      channel: "email",
      event: "reply",
    });

    expect(failed).toMatchObject({
      status: "failed",
      safeErrorClass: "transient",
      attemptNumber: 1,
    });
    expect(JSON.stringify(store.evidence)).not.toContain("provider secret response");

    transport.failNext("transient");
    const retryOne = await service.retryDelivery(tenantAdmin, failed.id);
    transport.failNext("transient");
    const retryTwo = await service.retryDelivery(tenantAdmin, retryOne.id);
    expect(retryTwo.attemptNumber).toBe(DELIVERY_MAX_ATTEMPTS);
    await expect(service.retryDelivery(tenantAdmin, retryTwo.id)).rejects.toThrow(
      "delivery retry budget exhausted",
    );

    const permanentFixture = fixture();
    await permanentFixture.service.setDeliveryPreference(tenantAdmin, {
      subjectId: requester.actorId,
      channel: "email",
      enabled: true,
      destinationRef: "email_destination_01",
    });
    permanentFixture.transport.failNext("permanent");
    const permanent = await permanentFixture.service.deliver(tenantAdmin, {
      ticketId: "ticket_1",
      ticketVersion: 2,
      channel: "email",
      event: "reply",
    });
    await expect(
      permanentFixture.service.retryDelivery(tenantAdmin, permanent.id),
    ).rejects.toThrow("delivery retry unavailable");
  });
});

describe("support depth authorization and state", () => {
  it("guards attachment metadata by requester, tenant admin, and exact managed-support session", async () => {
    const { service } = fixture();
    const attachment = await service.registerAttachment(requester, {
      ticketId: "ticket_1",
      fileName: "diagnostic.txt",
      mediaType: "text/plain",
      byteSize: 512,
      objectRef: "tenant_object_01",
    });

    await expect(service.readAttachment(requester, attachment.id)).resolves.toMatchObject({
      fileName: "diagnostic.txt",
    });
    const metadata = await service.readAttachment(requester, attachment.id);
    expect(metadata).not.toHaveProperty("objectRef");
    await expect(service.readAttachment(tenantAdmin, attachment.id)).resolves.toBeTruthy();
    await expect(service.readAttachment(managedOwner, attachment.id)).resolves.toBeTruthy();
    await expect(
      service.readAttachment({
        ...managedOwner,
        supportSession: {
          ...managedOwner.supportSession!,
          tenantId: "ten_b",
        },
      }, attachment.id),
    ).rejects.toThrow("attachment access denied");
    await expect(
      service.readAttachment({
        ...managedOwner,
        supportSession: {
          ...managedOwner.supportSession!,
          operatorId: "other_owner",
        },
      }, attachment.id),
    ).rejects.toThrow("attachment access denied");
    await expect(
      service.readAttachment({
        ...managedOwner,
        supportSession: {
          ...managedOwner.supportSession!,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      }, attachment.id),
    ).rejects.toThrow("attachment access denied");
    await expect(
      service.registerAttachment(
        {
          ...requester,
          permissions: ["support.ticket.read_own"],
        },
        {
          ticketId: "ticket_1",
          fileName: "diagnostic.txt",
          mediaType: "text/plain",
          byteSize: 512,
          objectRef: "tenant_object_02",
        },
      ),
    ).rejects.toThrow("attachment access denied");
    await expect(
      service.registerAttachment(requester, {
        ticketId: "ticket_1",
        fileName: "payload.exe",
        mediaType: "application/x-msdownload",
        byteSize: 512,
        objectRef: "tenant_object_02",
      }),
    ).rejects.toThrow("attachment media type denied");
  });

  it("persists paused SLA clocks, requester-only CSAT, and content-free tenant analytics", async () => {
    const { store, service } = fixture();
    await service.configureSla(tenantAdmin, {
      priority: "high",
      firstResponseMinutes: 30,
      resolutionMinutes: 240,
    });
    const active = await service.slaState(tenantAdmin, "ticket_1", "2026-07-27T10:20:00.000Z");
    expect(active).toMatchObject({
      state: "running",
      activeElapsedMinutes: 20,
      firstResponseBreached: false,
    });

    store.setTicketStatus("ten_a", "ticket_1", "awaiting_reply", "2026-07-27T10:20:00.000Z");
    const paused = await service.slaState(
      tenantAdmin,
      "ticket_1",
      "2026-07-27T13:20:00.000Z",
    );
    expect(paused).toMatchObject({
      state: "paused",
      activeElapsedMinutes: 20,
      firstResponseBreached: false,
    });
    store.setTicketStatus("ten_a", "ticket_1", "in_progress", "2026-07-27T13:20:00.000Z");
    const resumed = await service.slaState(
      tenantAdmin,
      "ticket_1",
      "2026-07-27T13:31:00.000Z",
    );
    expect(resumed).toMatchObject({
      state: "running",
      activeElapsedMinutes: 31,
      firstResponseBreached: true,
    });
    await expect(
      service.slaState(tenantAdmin, "ticket_1", "2026-07-27T09:59:00.000Z"),
    ).rejects.toThrow("SLA unavailable");

    store.setTicketStatus("ten_a", "ticket_1", "resolved", "2026-07-27T13:40:00.000Z");
    const stopped = await service.slaState(
      tenantAdmin,
      "ticket_1",
      "2026-07-28T13:40:00.000Z",
    );
    expect(stopped).toMatchObject({ state: "stopped", activeElapsedMinutes: 40 });
    await service.submitCsat(requester, {
      ticketId: "ticket_1",
      rating: 5,
      comment: "Solved clearly.",
    });
    await expect(
      service.submitCsat({ ...requester, actorId: "other_user" }, {
        ticketId: "ticket_1",
        rating: 1,
      }),
    ).rejects.toThrow("CSAT access denied");

    const analytics = await service.analytics(tenantAdmin);
    expect(analytics).toEqual({
      tenantId: "ten_a",
      ticketCount: 1,
      resolvedCount: 1,
      deliveryFailureCount: 0,
      csatResponseCount: 1,
      averageCsat: 5,
    });
    expect(JSON.stringify(analytics)).not.toContain("Solved clearly");
    await expect(service.analytics(requester)).rejects.toThrow("analytics access denied");
    expect(store.evidence.map((event) => event.action)).toContain("support.analytics.read");
  });
});
