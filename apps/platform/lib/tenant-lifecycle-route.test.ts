import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ change: vi.fn(), gate: vi.fn() }));
vi.mock("./installation-owner", () => ({ installationOwnerContext: fake.gate }));
vi.mock("./rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("./tenant-lifecycle", () => ({ changeTenantLifecycle: fake.change, requestTenantExport: vi.fn() }));
vi.mock("./tenant-worker-store", () => ({ tenantOperations: async () => ({ tenant: { display_name: "Example Tenant" } }) }));
import { POST } from "../app/api/admin/tenants/[tenantId]/lifecycle/route";
beforeEach(() => { vi.clearAllMocks(); fake.gate.mockResolvedValue({ ok: true, context: { authority: { userId: "operator_example" } } }); });
async function post(fields: Record<string, string | undefined>) {
  const body = new FormData(); for (const [key, value] of Object.entries(fields)) { if (value !== undefined) body.set(key, value); }
  return POST(new Request("http://localhost/api/admin/tenants/example/lifecycle", { method: "POST", headers: { origin: "http://localhost" }, body }), { params: Promise.resolve({ tenantId: "example" }) });
}
it.each([{}, { confirmed: "delete" }, { confirmed: "delete", tenantName: "Wrong" }])("rejects an unconfirmed or wrongly named deletion %j", async fields => {
  expect((await post({ ...fields, action: "delete" })).status).toBe(400);
  expect(fake.change).not.toHaveBeenCalled();
});
it("accepts explicit named confirmation", async () => {
  fake.change.mockResolvedValue("example-job");
  expect((await post({ action: "delete", confirmed: "delete", tenantName: "Example Tenant" })).status).toBe(202);
  expect(fake.change).toHaveBeenCalledWith("example", "delete", { kind: "installation_owner", userId: "operator_example" });
});
it("requires installation permission", async () => {
  fake.gate.mockResolvedValue({ ok: false });
  expect((await post({ action: "cancel_delete" })).status).toBe(403);
  expect(fake.change).not.toHaveBeenCalled();
});
