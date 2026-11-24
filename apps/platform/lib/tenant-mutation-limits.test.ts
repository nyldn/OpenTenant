import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), mutate: vi.fn() }));
vi.mock("./installation-owner", () => ({ installationOwnerContext: async () => ({ ok: true, context: { authority: { userId: "operator_synthetic" } } }) }));
vi.mock("./rate-limit", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("./tenant-lifecycle", () => ({ changeTenantLifecycle: mocks.mutate, requestTenantExport: mocks.mutate }));
vi.mock("./tenant-worker-store", () => ({ retryTenantJob: mocks.mutate, tenantJob: mocks.mutate }));
import { POST as lifecycle } from "../app/api/admin/tenants/[tenantId]/lifecycle/route";
import { POST as retry } from "../app/api/admin/tenants/[tenantId]/jobs/[jobId]/route";
beforeEach(() => { vi.clearAllMocks(); mocks.limit.mockResolvedValue(new Response("rate limited", { status: 429 })); });
it.each(["suspend", "resume", "export", "delete", "retry"])("limits %s before tenant mutation", async action => {
  const request = new Request("https://admin.example.test/api/admin/tenants/hostile/lifecycle", { method: "POST", body: new URLSearchParams({ action }) });
  const context = { params: Promise.resolve({ tenantId: "hostile", jobId: "synthetic" }) };
  expect((await (action === "retry" ? retry : lifecycle)(request, context)).status).toBe(429);
  expect(mocks.limit).toHaveBeenCalledWith(request, { tenantId: "installation", userId: "operator_synthetic", routeClass: "tenant-creation" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
