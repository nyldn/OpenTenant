import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
import type { TenantId } from "@opentenant/auth";

const withTenantDb = vi.hoisted(() => vi.fn());
const installationOwnerContext = vi.hoisted(() => vi.fn());
const applyEvent = vi.hoisted(() => vi.fn());
const recordFailure = vi.hoisted(() => vi.fn());
const listQueue = vi.hoisted(() => vi.fn());
const health = vi.hoisted(() => vi.fn());
const rebuildForTenant = vi.hoisted(() => vi.fn());
const claimPendingOutboxEvents = vi.hoisted(() => vi.fn());
const markOutboxDelivered = vi.hoisted(() => vi.fn());
const markOutboxFailed = vi.hoisted(() => vi.fn());
const latestOutboxEventId = vi.hoisted(() => vi.fn());
const listTickets = vi.hoisted(() => vi.fn());
const getTicketByNumber = vi.hoisted(() => vi.fn());
const managedSupportSessionForTenant = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({ Pool: class FakePool {} }));
vi.mock("@opentenant/database", () => ({
  PgHelpdeskProjectionStore: class FakeProjectionStore {
    applyEvent = applyEvent;
    recordFailure = recordFailure;
    listQueue = listQueue;
    health = health;
    rebuildForTenant = rebuildForTenant;
  },
}));
vi.mock("../opentenant-modules", () => ({ helpdeskSource: {
  claimPendingOutboxEvents,
  markOutboxDelivered,
  markOutboxFailed,
  latestOutboxEventId,
  listTickets,
  getTicketByNumber,
} }));
vi.mock("./tenant-db", () => ({ withTenantDb }));
vi.mock("./installation-owner", () => ({ installationOwnerContext }));
vi.mock("./managed-support", () => ({ managedSupportSessionForTenant }));
vi.mock("./audit", () => ({ audit }));

import {
  ownerHelpdeskQueue,
  ownerHelpdeskTicket,
  projectionEventFromOutbox,
  rebuildHelpdeskProjection,
  runHelpdeskProjectionPass,
} from "./helpdesk";

const tenantId = "ten_a" as TenantId;

function outboxRecord(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: "ten_a",
    ticketId: "t_1",
    ticketNumber: "SUP-000001",
    ticketVersion: id,
    kind: "status_change",
    payload: {
      schemaVersion: 1,
      tenantId: "ten_a",
      ticketNumber: "SUP-000001",
      ticketVersion: id,
      kind: "status_change",
      status: "open",
      priority: "medium",
      category: "other",
      assignedRef: null,
      openedAt: "2026-07-27T09:00:00.000Z",
      updatedAt: "2026-07-27T10:00:00.000Z",
      occurredAt: "2026-07-27T10:00:00.000Z",
    },
    occurredAt: new Date("2026-07-27T10:00:00Z"),
    status: "pending",
    attempts: 1,
    claimedAt: new Date(),
    deliveredAt: null,
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://control.example.test/opentenant");
  withTenantDb.mockImplementation(async (_tenant, operation) => operation({ query: vi.fn() }));
  recordFailure.mockResolvedValue(undefined);
  markOutboxDelivered.mockResolvedValue(undefined);
  markOutboxFailed.mockResolvedValue("pending");
  audit.mockResolvedValue(undefined);
});

describe("projectionEventFromOutbox", () => {
  it("maps queue metadata only", () => {
    const mapped = projectionEventFromOutbox(outboxRecord(7) as never);
    expect(mapped).toEqual({
      eventId: 7,
      tenantId: "ten_a",
      ticketNumber: "SUP-000001",
      ticketVersion: 7,
      kind: "status_change",
      status: "open",
      priority: "medium",
      category: "other",
      assignedRef: null,
      openedAt: "2026-07-27T09:00:00.000Z",
      updatedAt: "2026-07-27T10:00:00.000Z",
      occurredAt: "2026-07-27T10:00:00.000Z",
    });
    expect(Object.keys(mapped)).not.toContain("subject");
  });
});

describe("runHelpdeskProjectionPass", () => {
  it("acknowledges applied and stale (idempotent replay) events", async () => {
    claimPendingOutboxEvents.mockResolvedValue([outboxRecord(1), outboxRecord(2)]);
    applyEvent.mockResolvedValueOnce("applied").mockResolvedValueOnce("stale");
    const result = await runHelpdeskProjectionPass(tenantId);
    expect(result).toEqual({ claimed: 2, delivered: 2, failed: 0 });
    expect(markOutboxDelivered).toHaveBeenCalledTimes(2);
    expect(markOutboxFailed).not.toHaveBeenCalled();
  });

  it("dead-letters a rejected envelope permanently", async () => {
    claimPendingOutboxEvents.mockResolvedValue([outboxRecord(1)]);
    applyEvent.mockResolvedValue("rejected");
    const result = await runHelpdeskProjectionPass(tenantId);
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(markOutboxFailed).toHaveBeenCalledWith(expect.anything(), "ten_a", 1, "projection_rejected", {
      permanent: true,
    });
  });

  it("isolates projection failures from canonical ticket state", async () => {
    claimPendingOutboxEvents.mockResolvedValue([outboxRecord(1)]);
    applyEvent.mockRejectedValue(new Error("control plane unavailable"));
    const result = await runHelpdeskProjectionPass(tenantId);
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(recordFailure).toHaveBeenCalledWith("ten_a", "control plane unavailable");
    expect(markOutboxFailed).toHaveBeenCalledWith(
      expect.anything(),
      "ten_a",
      1,
      "control plane unavailable",
    );
    // No ticket table is touched anywhere in the pass.
    expect(markOutboxDelivered).not.toHaveBeenCalled();
  });

  it("continues the pass when even the failure bookkeeping fails", async () => {
    claimPendingOutboxEvents.mockResolvedValue([outboxRecord(1), outboxRecord(2)]);
    applyEvent.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("applied");
    recordFailure.mockRejectedValue(new Error("health write failed"));
    markOutboxFailed.mockRejectedValue(new Error("tenant db unavailable"));
    const result = await runHelpdeskProjectionPass(tenantId);
    expect(result).toEqual({ claimed: 2, delivered: 1, failed: 1 });
  });
});

describe("rebuildHelpdeskProjection", () => {
  it("derives rows from canonical tenant state with the outbox checkpoint", async () => {
    listTickets.mockResolvedValue([
      {
        id: "t_1",
        tenantId: "ten_a",
        ticketNumber: "SUP-000001",
        createdBy: "user_1",
        assignedTo: null,
        subject: "secret",
        description: "secret",
        category: "other",
        status: "open",
        priority: "medium",
        version: 4,
        createdAt: new Date("2026-07-27T09:00:00Z"),
        updatedAt: new Date("2026-07-27T10:00:00Z"),
      },
    ]);
    latestOutboxEventId.mockResolvedValue(9);
    rebuildForTenant.mockResolvedValue({ rebuilt: 1, rejected: 0 });
    const actor = { kind: "installation_owner", userId: "user_owner" };
    await rebuildHelpdeskProjection(tenantId, actor as never);
    const input = rebuildForTenant.mock.calls[0]![0];
    expect(input.latestEventId).toBe(9);
    expect(input.rows[0]).not.toHaveProperty("subject");
    expect(input.rows[0]).toMatchObject({ ticketNumber: "SUP-000001", ticketVersion: 4 });
  });
});

describe("ownerHelpdeskQueue", () => {
  it("fails closed without installation authority", async () => {
    installationOwnerContext.mockResolvedValue({ ok: false, reason: "anonymous" });
    await expect(ownerHelpdeskQueue()).resolves.toEqual({ ok: false, reason: "anonymous" });
    expect(listQueue).not.toHaveBeenCalled();
  });

  it("requires owner.helpdesk.queue.read and returns rows with health", async () => {
    installationOwnerContext.mockResolvedValue({ ok: true, context: { authority: { userId: "owner_1" } } });
    listQueue.mockResolvedValue([]);
    health.mockResolvedValue([]);
    const result = await ownerHelpdeskQueue({ status: "open" });
    expect(installationOwnerContext).toHaveBeenCalledWith("owner.helpdesk.queue.read");
    expect(result).toEqual({ ok: true, rows: [], health: [], operatorUserId: "owner_1" });
  });
});

describe("ownerHelpdeskTicket", () => {
  it("requires customer-data authority plus an exact-tenant support session before canonical read", async () => {
    installationOwnerContext.mockResolvedValue({ ok: true, context: {} });
    managedSupportSessionForTenant.mockResolvedValue({
      ok: true,
      context: { sessionId: "sup_1", tenantId: "ten_a", operator: { userId: "owner_1" } },
    });
    getTicketByNumber.mockResolvedValue({ ticket: { ticketNumber: "SUP-000001" } });

    await expect(ownerHelpdeskTicket("ten_a", "SUP-000001")).resolves.toEqual({
      ok: true,
      detail: { ticket: { ticketNumber: "SUP-000001" } },
    });
    expect(installationOwnerContext).toHaveBeenCalledWith("owner.support.customer_data.read");
    expect(managedSupportSessionForTenant).toHaveBeenCalledWith("ten_a");
    expect(withTenantDb).toHaveBeenCalledWith("ten_a", expect.any(Function));
    expect(getTicketByNumber).toHaveBeenCalledWith(expect.anything(), "ten_a", "SUP-000001");
    expect(audit).toHaveBeenCalledWith(
      { kind: "installation_owner", userId: "owner_1" },
      "ten_a",
      "support.ticket_content_read",
      "SUP-000001",
      {
        supportSessionId: "sup_1",
        reason: null,
        reference: null,
      },
    );
  });

  it("denies queue-only installation authority before resolving support context or tenant data", async () => {
    installationOwnerContext.mockResolvedValue({
      ok: false,
      reason: "missing_installation_authority",
    });

    await expect(ownerHelpdeskTicket("ten_a", "SUP-000001")).resolves.toEqual({
      ok: false,
      reason: "missing_installation_authority",
    });
    expect(managedSupportSessionForTenant).not.toHaveBeenCalled();
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(getTicketByNumber).not.toHaveBeenCalled();
  });

  it("fails closed before canonical content access without an exact-tenant support session", async () => {
    installationOwnerContext.mockResolvedValue({ ok: true, context: {} });
    managedSupportSessionForTenant.mockResolvedValue({
      ok: false,
      reason: "support_context_mismatch",
    });

    await expect(ownerHelpdeskTicket("ten_a", "SUP-000001")).resolves.toEqual({
      ok: false,
      reason: "tenant_support_denied",
    });
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(getTicketByNumber).not.toHaveBeenCalled();
  });

  it("fails closed instead of returning customer content when access evidence cannot be written", async () => {
    installationOwnerContext.mockResolvedValue({ ok: true, context: {} });
    managedSupportSessionForTenant.mockResolvedValue({
      ok: true,
      context: { sessionId: "sup_1", tenantId: "ten_a", operator: { userId: "owner_1" } },
    });
    getTicketByNumber.mockResolvedValue({ ticket: { ticketNumber: "SUP-000001" } });
    audit.mockRejectedValue(new Error("audit unavailable"));

    await expect(ownerHelpdeskTicket("ten_a", "SUP-000001")).resolves.toEqual({
      ok: false,
      reason: "access_evidence_failed",
    });
  });

  it("rejects malformed projection navigation hints", async () => {
    await expect(ownerHelpdeskTicket("../ten_b", "SUP-000001")).resolves.toEqual({
      ok: false,
      reason: "invalid_reference",
    });
    expect(installationOwnerContext).not.toHaveBeenCalled();
  });
});
