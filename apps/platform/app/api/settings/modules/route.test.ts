import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), queue: vi.fn(), audit: vi.fn(), transaction: vi.fn(),
  allowed: true, platform: true, managed: false, origin: true,
}));
vi.mock("../../../../lib/control-plane", () => ({ controlPlanePool: () => ({}), withControlPlaneTransaction: mocks.transaction }));
vi.mock("../../../../lib/authz-lifecycle", () => ({ queueEntitlementSync: mocks.queue }));
vi.mock("@opentenant/database", () => ({ PgAuditStore: class { appendWithClient = mocks.audit; } }));
vi.mock("../../../../lib/settings-guard", () => ({ sameOrigin: () => mocks.origin }));
vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: async () => null }));
vi.mock("../../../../lib/tenant-admin", () => ({ tenantAdminContext: async () => mocks.allowed ? {
  ok: true, context: { session: { isPlatformAdmin: mocks.platform }, tenant: { tenantId: "ten_a" }, auditActor: { kind: "user", userId: "user_a" }, ...(mocks.managed ? { managedSupport: {} } : {}) },
} : { ok: false } }));
import { POST } from "./route";
const client = { query: mocks.query };
const request = (enabled = "false") => new Request("https://app.example.test/api/settings/modules", { method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams({ moduleKey: "example", enabled }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.platform = true; mocks.managed = false; mocks.origin = true;
  mocks.query.mockResolvedValue({ rowCount: 1 }); mocks.queue.mockResolvedValue(undefined); mocks.audit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((work: (client: unknown) => Promise<unknown>) => work(client));
});
describe("tenant-bound module entitlement mutation", () => {
  it.each(["true", "false"])("composes entitlement %s and audit on the mutation's transaction", async enabled => {
    expect((await POST(request(enabled))).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("where tenant_id=$1 and module_key=$2"), ["ten_a", "example", enabled === "true"]);
    expect(mocks.queue).toHaveBeenCalledWith(client, { tenantId: "ten_a", moduleKey: "example", enabled: enabled === "true" });
    expect(mocks.audit).toHaveBeenCalledWith(client, expect.objectContaining({ tenantId: "ten_a", action: "module.entitlement_changed" }));
  });
  it("fails the transaction when durable enqueue fails", async () => {
    mocks.queue.mockRejectedValue(new Error("synthetic database failure"));
    expect((await POST(request())).status).toBe(500); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("never creates missing assignments or bypasses installation, support or origin gates", async () => {
    mocks.query.mockResolvedValue({ rowCount: 0 });
    expect((await POST(request())).status).toBe(404); expect(mocks.queue).not.toHaveBeenCalled();
    mocks.query.mockClear();
    mocks.platform = false; expect((await POST(request())).status).toBe(403);
    mocks.platform = true; mocks.managed = true; expect((await POST(request())).status).toBe(403);
    mocks.managed = false; mocks.origin = false; expect((await POST(request())).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("rejects malformed toggles without mutation", async () => {
    expect((await POST(request("yes"))).status).toBe(400); expect(mocks.query).not.toHaveBeenCalled();
  });
});
