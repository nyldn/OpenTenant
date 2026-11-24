import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), session: vi.fn(), claim: vi.fn(), jobStatus: vi.fn() }));
vi.mock("../../../../../../lib/tenant", () => ({ currentTenant: mocks.tenant }));
vi.mock("../../../../../../lib/session", () => ({ currentSession: mocks.session }));
vi.mock("../../../../../../lib/tenant-owner-invite", () => ({ claimTenantOwnerInvite: mocks.claim, ownerClaimJobStatus: mocks.jobStatus }));
import { GET, POST } from "./route";
const origin = "http://pending.example.test";
const endpoint = origin + "/api/admin/tenants/tenant_pending/owner-claim";
const params = { params: Promise.resolve({ tenantId: "tenant_pending" }) };
const job = "12345678-1234-1234-1234-123456789abc";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenant.mockResolvedValue({ tenantId: "tenant_pending" });
  mocks.session.mockResolvedValue({ userId: "usr_claimant" });
  mocks.jobStatus.mockResolvedValue(null);
});
it("binds claims to the verified host and authenticated tenant membership", async () => {
  mocks.tenant.mockResolvedValue({ tenantId: "tenant_other" });
  const response = await POST(new Request(endpoint, { method: "POST", headers: { origin }, body: new URLSearchParams({ token: "synthetic" }) }), params);
  expect(response.status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("returns actionable claim errors without provider details", async () => {
  mocks.claim.mockRejectedValue(new Error("provider-secret"));
  const response = await POST(new Request(endpoint, { method: "POST", headers: { origin }, body: new URLSearchParams({ token: "synthetic" }) }), params);
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain("separate owner token");
  expect(body).not.toContain("provider-secret");
  expect(mocks.session).toHaveBeenCalledWith("tenant_pending");
});
it("reads only the claimant's durable job and hides unknown jobs", async () => {
  expect((await GET(new Request(endpoint + "?job=" + job), params)).status).toBe(404);
  expect(mocks.jobStatus).toHaveBeenCalledWith("tenant_pending", "usr_claimant", job);
  mocks.jobStatus.mockResolvedValue("completed");
  const response = await GET(new Request(endpoint + "?job=" + job), params);
  expect(await response.json()).toEqual({ status: "completed" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects malformed job identifiers before querying storage", async () => {
  expect((await GET(new Request(endpoint + "?job=" + "-".repeat(36)), params)).status).toBe(404);
  expect(mocks.jobStatus).not.toHaveBeenCalled();
});
it("returns browser claims to an inline result without putting the token in a URL", async () => {
  const request = () => new Request(endpoint, { method: "POST", headers: { origin, accept: "text/html" }, body: new URLSearchParams({ token: "never-return-this" }) });
  mocks.claim.mockResolvedValue(job);
  const saved = await POST(request(), params);
  expect(saved.status).toBe(303);
  expect(saved.headers.get("location")).toBe(`/admin/tenants/tenant_pending/owner-claim?job=${job}`);
  expect(await saved.text()).toBe("");
  mocks.claim.mockRejectedValue(new Error("provider-secret"));
  const failed = await POST(request(), params);
  expect(failed.status).toBe(303);
  expect(failed.headers.get("location")).toBe("/admin/tenants/tenant_pending/owner-claim?error=unavailable");
  expect(await failed.text()).toBe("");
});
