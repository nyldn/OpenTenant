import { describe, expect, it, vi } from "vitest";
import {
  SupportEmailDeliveryTransport,
  createSupportDeliveryService,
} from "./email-delivery";
import { InMemorySupportDepthStore } from "./support-depth-store";

const input = {
  tenantId: "tenant_a",
  destinationRef: "directory:user",
  channel: "email" as const,
  event: "reply" as const,
  ticketNumber: "SUP-1",
  idempotencyKey: "tenant_a/SUP-1/1/email/reply",
};
describe("real support email delivery", () => {
  it("resolves opaque destinations with tenant context and sends through the email port", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const resolveEmail = vi
      .fn()
      .mockResolvedValue({
        tenantId: "tenant_a",
        address: "recipient@example.test",
      });
    const transport = new SupportEmailDeliveryTransport(
      { send },
      { resolveEmail },
    );
    expect(await transport.deliver(input)).toEqual({ ok: true });
    expect(resolveEmail).toHaveBeenCalledWith("tenant_a", "directory:user");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "recipient@example.test",
        idempotencyKey: input.idempotencyKey,
      }),
    );
    expect(send.mock.calls[0]![0].text).toContain("SUP-1");
  });
  it("fails closed for missing or cross-tenant directory records", async () => {
    const send = vi.fn();
    for (const resolved of [
      null,
      { tenantId: "tenant_b", address: "other@example.test" },
    ]) {
      const transport = new SupportEmailDeliveryTransport(
        { send },
        { resolveEmail: async () => resolved },
      );
      expect(await transport.deliver(input)).toEqual({
        ok: false,
        safeErrorClass: "destination_unavailable",
      });
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("normalizes directory failures and forwards in-app notifications separately", async () => {
    const deliver = vi.fn().mockResolvedValue({ ok: true });
    const transport = new SupportEmailDeliveryTransport(
      { send: vi.fn() },
      {
        resolveEmail: async () => {
          throw Error("secret");
        },
      },
      { deliver },
    );
    expect(await transport.deliver(input)).toEqual({
      ok: false,
      safeErrorClass: "transient",
    });
    expect(await transport.deliver({ ...input, channel: "in_app" })).toEqual({
      ok: true,
    });
    expect(deliver).toHaveBeenCalledOnce();
  });
  it("composes the support service with email delivery and records one audited attempt", async () => {
    const store = new InMemorySupportDepthStore();
    store.seedTicket({
      tenantId: "tenant_a",
      ticketId: "ticket_1",
      ticketNumber: "SUP-1",
      requesterId: "requester_a",
      status: "open",
      priority: "medium",
      version: 1,
      createdAt: new Date().toISOString(),
    });
    const send = vi.fn().mockResolvedValue({ ok: true });
    const service = createSupportDeliveryService(store, {
      email: { send },
      directory: {
        resolveEmail: async () => ({
          tenantId: "tenant_a",
          address: "recipient@example.test",
        }),
      },
    });
    const authority = {
      tenantId: "tenant_a",
      actorId: "admin_a",
      kind: "tenant_admin" as const,
      permissions: ["support.ticket.manage"],
    };
    await service.setDeliveryPreference(authority, {
      subjectId: "requester_a",
      channel: "email",
      enabled: true,
      destinationRef: "directory:user",
    });
    const request = {
      ticketId: "ticket_1",
      ticketVersion: 1,
      channel: "email" as const,
      event: "reply" as const,
    };
    expect(await service.deliver(authority, request)).toMatchObject({
      status: "delivered",
    });
    await service.deliver(authority, request);
    expect(send).toHaveBeenCalledOnce();
    expect(store.attempts).toHaveLength(1);
    expect(JSON.stringify(store.evidence)).not.toContain(
      "recipient@example.test",
    );
  });
});
