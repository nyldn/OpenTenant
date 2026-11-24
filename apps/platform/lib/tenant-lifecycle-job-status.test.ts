import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ gate: vi.fn(), status: vi.fn() }));
vi.mock("./installation-owner", () => ({ installationOwnerContext: fake.gate }));
vi.mock("./tenant-worker-store", () => ({ tenantJobStatus: fake.status }));
import { GET } from "../app/api/admin/tenants/[tenantId]/jobs/route";
const context = { params: Promise.resolve({ tenantId: "example" }) };
const request = new Request("http://localhost/api/admin/tenants/example/jobs");
beforeEach(() => vi.resetAllMocks());
it("denies reads after permission revocation without querying tenant work", async () => {
  fake.gate.mockResolvedValue({ ok: false });
  const response = await GET(request, context);
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fake.status).not.toHaveBeenCalled();
});
it("binds an uncached status read to the tenant and separately checks mutation permission", async () => {
  const projection = { tenant: { id: "example", status: "active" }, jobs: [{ id: "synthetic", kind: "provision", status: "completed", attempts: 1 }] };
  fake.gate.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
  fake.status.mockResolvedValue(projection);
  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ...projection, canManage: false });
  expect(fake.status).toHaveBeenCalledExactlyOnceWith("example");
  expect(fake.gate.mock.calls).toEqual([["owner.tenant.read"], ["owner.tenant.create"]]);
});
it("returns an uncached 404 for a missing tenant", async () => {
  fake.gate.mockResolvedValue({ ok: true }); fake.status.mockResolvedValue(null);
  const response = await GET(request, context);
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
