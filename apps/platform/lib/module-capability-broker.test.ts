import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContextClaims } from "@opentenant/security";

const authorize = vi.hoisted(() => vi.fn());
const withClient = vi.hoisted(() => vi.fn());
const resolveTenantDb = vi.hoisted(() => vi.fn());
const listTicketSummaries = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({ Pool: class FakePool {} }));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("@opentenant/database", () => ({
  PgModuleCapabilityStore: class FakeCapabilityStore {
    withAuthorizedCapability = authorize;
  },
}));
vi.mock("./tenant-db", () => ({ resolveTenantDb }));
vi.mock("../opentenant-modules", () => ({ helpdeskSource: { listTicketSummaries } }));

import { brokerSupportTicketSummaries } from "./module-capability-broker";

const claims: ModuleContextClaims = {
  tenantId: "tenant_alpha",
  moduleKey: "tenant-portal",
  moduleVersion: "1.0.0",
  userId: "user_alpha",
  permissions: ["tenant-portal.support-ticket-read"],
  brand: { displayName: "Alpha", logoUrl: null, cssBrandKey: "alpha" },
  issuedAt: 1_750_000_000,
  expiresAt: 1_750_000_120,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveTenantDb.mockResolvedValue({ withClient });
  vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://control.example.test/opentenant");
});

describe("module capability broker", () => {
  it("binds a fixed support summary operation to the signed tenant, version, identity, and permissions", async () => {
    const tenantQuery = vi.fn();
    const summaries = Array.from({ length: 12 }, (_, index) => ({
      ticketNumber: `SUP-${String(index + 1).padStart(6, "0")}`,
      category: "technical",
      status: "open",
      priority: "medium",
      updatedAt: "2026-07-22T00:00:00.000Z",
    }));
    listTicketSummaries.mockResolvedValue(summaries);
    withClient.mockImplementation(async (operation) => operation({ query: tenantQuery }));
    authorize.mockImplementation(async (_input, operation) => ({ allowed: true, value: (await operation()).value }));

    await expect(brokerSupportTicketSummaries(
      claims,
      "00000000-0000-4000-8000-000000000021",
    )).resolves.toEqual({ allowed: true, value: summaries });

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_alpha",
      moduleKey: "tenant-portal",
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: ["tenant-portal.support-ticket-read"],
      identityBacked: true,
      actor: { kind: "user", userId: "user_alpha" },
      correlationId: "00000000-0000-4000-8000-000000000021",
    }), expect.any(Function));
    expect(resolveTenantDb).toHaveBeenCalledWith("tenant_alpha");
    expect(resolveTenantDb.mock.invocationCallOrder[0]).toBeLessThan(authorize.mock.invocationCallOrder[0]!);
    expect(listTicketSummaries).toHaveBeenCalledOnce();
    expect(tenantQuery.mock.calls.map(([sql]) => sql)).toEqual([
      "set local statement_timeout = '4500ms'",
      "set local idle_in_transaction_session_timeout = '4500ms'",
    ]);
    expect(tenantQuery.mock.invocationCallOrder[1]).toBeLessThan(
      listTicketSummaries.mock.invocationCallOrder[0]!,
    );

    const operation = authorize.mock.calls[0]![1];
    await expect(operation()).resolves.toMatchObject({ resultCount: 12, resultSize: "bounded" });
  });

  it("routes a signed anonymous context through an auditable identity denial", async () => {
    authorize.mockResolvedValue({ allowed: false, reason: "identity_required" });

    await expect(brokerSupportTicketSummaries(
      { ...claims, userId: null, permissions: [] },
      "00000000-0000-4000-8000-000000000022",
    )).resolves.toEqual({ allowed: false, reason: "identity_required" });

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      identityBacked: false,
      actor: { kind: "system", job: "module-capability-broker" },
      runtimePermissions: [],
    }), expect.any(Function));
    expect(withClient).not.toHaveBeenCalled();
  });

  it("surfaces tenant pool resolution failures inside the audited operation", async () => {
    resolveTenantDb.mockRejectedValue(new Error("tenant database unavailable"));
    authorize.mockImplementation(async (_input, operation) => {
      await expect(operation()).rejects.toThrow("tenant database unavailable");
      return { allowed: false, reason: "broker_error" };
    });

    await expect(brokerSupportTicketSummaries(
      claims,
      "00000000-0000-4000-8000-000000000023",
    )).resolves.toEqual({ allowed: false, reason: "broker_error" });
    expect(authorize).toHaveBeenCalledOnce();
  });
});
