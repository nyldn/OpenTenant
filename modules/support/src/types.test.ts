import { describe, expect, it } from "vitest";
import {
  SUPPORT_PERMISSIONS,
  SUPPORT_REQUESTER_PERMISSIONS,
  SUPPORT_STAFF_PERMISSIONS,
  expandSupportPermissions,
  outboxIdempotencyKey,
} from "./types";

describe("support permission vocabulary", () => {
  it("matches the approved multi-tenant operations slugs", () => {
    expect([...SUPPORT_PERMISSIONS]).toEqual([
      "support.ticket.create",
      "support.ticket.read_own",
      "support.ticket.reply_own",
      "support.ticket.read_tenant",
      "support.ticket.reply",
      "support.ticket.note_internal",
      "support.ticket.assign",
      "support.ticket.manage",
      "support.ticket.escalate",
      "support.config.manage",
      "support.analytics.read",
      "support.knowledge.manage",
    ]);
  });

  it("expands the deprecated coarse aliases", () => {
    expect(expandSupportPermissions(["support.use"])).toEqual([
      ...SUPPORT_REQUESTER_PERMISSIONS,
    ]);
    expect(expandSupportPermissions(["support.admin"])).toEqual([
      ...SUPPORT_REQUESTER_PERMISSIONS,
      ...SUPPORT_STAFF_PERMISSIONS,
    ]);
  });

  it("passes fine-grained slugs through and deduplicates", () => {
    expect(
      expandSupportPermissions(["support.ticket.assign", "support.use", "support.ticket.create"]),
    ).toEqual(["support.ticket.assign", "support.ticket.create", "support.ticket.read_own", "support.ticket.reply_own"]);
  });

  it("drops unknown strings instead of passing them through", () => {
    expect(expandSupportPermissions(["support.everything", "admin", ""])).toEqual([]);
    expect(expandSupportPermissions(["support.ticket.delete_all"])).toEqual([]);
  });
});

describe("outbox idempotency key", () => {
  it("derives deterministically from tenant, ticket, and canonical version", () => {
    expect(
      outboxIdempotencyKey({ tenantId: "ten_a", ticketNumber: "SUP-000001", ticketVersion: 3 }),
    ).toBe("ten_a/SUP-000001/3");
  });
});
