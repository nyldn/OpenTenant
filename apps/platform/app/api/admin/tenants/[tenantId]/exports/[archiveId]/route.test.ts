import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ gate: vi.fn(), download: vi.fn() }));
vi.mock("../../../../../../../lib/installation-owner", () => ({ installationOwnerContext: fake.gate }));
vi.mock("../../../../../../../lib/tenant-export", () => ({ downloadTenantExport: fake.download }));
import { GET } from "./route";
const params = Promise.resolve({ tenantId: "tenant_export", archiveId: "11111111-1111-4111-8111-111111111111" });
beforeEach(() => { vi.clearAllMocks(); fake.gate.mockResolvedValue({ ok: true, context: { authority: { userId: "user_operator" } } }); });
it("reauthorizes, binds both identifiers, streams with a length and forwards cancellation", async () => {
  let cancelled = false;
  fake.download.mockResolvedValue({ body: new ReadableStream({ cancel() { cancelled = true; } }), byteLength: 42 });
  const controller = new AbortController();
  const req = new Request("http://example.test/export", { signal: controller.signal });
  const response = await GET(req, { params });
  expect(fake.gate).toHaveBeenCalledWith("owner.tenant.create");
  expect(fake.download).toHaveBeenCalledWith("tenant_export", (await params).archiveId, { kind: "installation_owner", userId: "user_operator" }, undefined, req.signal);
  expect(response.headers.get("content-length")).toBe("42");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/gzip");
  await response.body!.cancel(); expect(cancelled).toBe(true);
});
it("refuses missing, expired, corrupt and cross-tenant archives", async () => {
  fake.download.mockResolvedValue(null);
  expect((await GET(new Request("http://example.test/export"), { params })).status).toBe(404);
});
it("refuses access before opening any file", async () => {
  fake.gate.mockResolvedValue({ ok: false });
  expect((await GET(new Request("http://example.test/export"), { params })).status).toBe(403);
  expect(fake.download).not.toHaveBeenCalled();
});
