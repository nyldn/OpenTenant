import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportApi } from "./host-api";

const { gate, retry, getTicket } = vi.hoisted(() => ({ gate: vi.fn(), retry: vi.fn(), getTicket: vi.fn() }));
vi.mock("./host-context", () => ({ createSupportContext: () => gate }));
vi.mock("./delivery-store", () => ({ retryTicketEmail: retry }));
vi.mock("./index", () => ({ getTicket, TICKET_CATEGORIES: [], TICKET_PRIORITIES: [], TICKET_STATUSES: [] }));
const ticketId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const actor = { kind: "managed_support", operatorId: "operator", tenantId: "tenant_a", supportSessionId: "session" };
const withTenantDb = vi.fn(async (_tenant: string, work: (client: unknown) => unknown) => work({}));
const host = { sameOrigin: () => true, enforceMutationRateLimit: async () => null,
  auditActor: () => actor, withTenantDb,
  readBoundedForm: (req: Request) => req.formData(),
} as unknown as ModuleHostServices;
function request(overrides = {}) {
  return new Request("https://example.test/api/support/tickets", { method: "POST",
    body: new URLSearchParams({ op: "retry_email", ticketId, deliveryId, ...overrides }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ ok: true, context: { session: { userId: "user" }, tenantId: "tenant_a", permissions: ["support.ticket.manage", "support.ticket.read_tenant"] } });
  getTicket.mockResolvedValue({ ticket: { createdBy: "requester" } });
  retry.mockResolvedValue(true);
});
describe("audited ticket email retry boundary", () => {
  it("binds retry to the authorized tenant, ticket and real audit actor", async () => {
    const response = await createSupportApi(host)(request());
    expect(response.status).toBe(303);
    expect(retry).toHaveBeenCalledWith({}, { tenantId: "tenant_a", ticketId, deliveryId, actor });
  });
  it("requires manage even on the requester's own ticket", async () => {
    gate.mockResolvedValue({ ok: true, context: { session: { userId: "requester" }, tenantId: "tenant_a", permissions: ["support.ticket.reply_own"] } });
    expect((await createSupportApi(host)(request())).status).toBe(403);
    expect(retry).not.toHaveBeenCalled();
  });
  it("keeps another requester's ticket hidden and validates delivery IDs", async () => {
    gate.mockResolvedValue({ ok: true, context: { session: { userId: "user" }, tenantId: "tenant_a", permissions: ["support.ticket.manage"] } });
    expect((await createSupportApi(host)(request())).status).toBe(404);
    expect(retry).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs and stale retries without success receipts", async () => {
    expect((await createSupportApi(host)(request({ deliveryId: "bad" }))).status).toBe(400);
    expect(retry).not.toHaveBeenCalled();
    retry.mockResolvedValue(false);
    expect((await createSupportApi(host)(request())).status).toBe(409);
  });
  it("returns a safe failure when the database rejects the retry", async () => {
    retry.mockRejectedValue(Error("driver password recipient@example.test"));
    const response = await createSupportApi(host)(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Email retry could not be saved. Please try again.");
  });
});
