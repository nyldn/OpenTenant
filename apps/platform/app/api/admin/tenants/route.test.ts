import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), enqueue: vi.fn(), origin: vi.fn(), limit: vi.fn() }));
vi.mock("../../../../lib/installation-owner", () => ({ installationOwnerContext: mocks.gate }));
vi.mock("../../../../lib/settings-guard", () => ({ sameOrigin: mocks.origin }));
vi.mock("../../../../lib/tenant-worker-store", () => ({ enqueueTenantProvisioning: mocks.enqueue }));
vi.mock("../../../../lib/rate-limit", () => ({ enforceRateLimit: mocks.limit }));
import { POST } from "./route";
const request = (extra = {}) => new Request("https://admin.example.test/api/admin/tenants", { method: "POST", body: new URLSearchParams({ slug: "example", displayName: "Example", dataRegion: "us", ownerEmail: "owner@example.test", ...extra }) });
describe("asynchronous tenant creation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts ap as an operator-declared Postgres region", async () => {
    vi.stubEnv("PROVISIONING_PROVIDER", "postgres");
    expect((await POST(request({ dataRegion: "ap" }))).status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ dataRegion: "ap" }));
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.limit.mockResolvedValue(null); mocks.gate.mockResolvedValue({ ok: true, context: { authority: { userId: "operator_example" } } }); mocks.origin.mockReturnValue(true); mocks.enqueue.mockResolvedValue({ tenantId: "tenant_example", jobId: "job_example" }); });
  it("returns 202 with a durable job and status URL", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ tenantId: "tenant_example", jobId: "job_example" });
    expect(response.headers.get("location")).toBe("/admin/tenants/tenant_example");
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ ownerEmail: "owner@example.test", actor: { kind: "installation_owner", userId: "operator_example" } }));
  });
  it("limits the installation owner before reading or queueing tenant input", async () => {
    mocks.limit.mockResolvedValue(new Response("rate limited", { status: 429 }));
    expect((await POST(request())).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), { tenantId: "installation", userId: "operator_example", routeClass: "tenant-creation" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("denies tenant-only authority", async () => { mocks.gate.mockResolvedValue({ ok: false }); expect((await POST(request())).status).toBe(403); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it("denies cross-origin mutations", async () => { mocks.origin.mockReturnValue(false); expect((await POST(request())).status).toBe(403); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it.each([{ ownerEmail: "" }, { dataRegion: "ap" }, { slug: "-bad" }, { displayName: "" }, { cssBrandKey: "bad_key" }])("rejects invalid creation %j", async (input) => { expect((await POST(request(input))).status).toBe(303); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it("normalizes duplicate/database errors without provider detail", async () => { mocks.enqueue.mockRejectedValue(new Error("sensitive")); const response = await POST(request()); expect(response.status).toBe(409); expect(await response.text()).not.toContain("sensitive"); });
});
