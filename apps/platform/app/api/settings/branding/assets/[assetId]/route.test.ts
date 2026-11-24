import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), session: vi.fn(), gate: vi.fn(), read: vi.fn() }));
vi.mock("../../../../../../lib/tenant", () => ({ currentTenant: mocks.tenant }));
vi.mock("../../../../../../lib/session", () => ({ currentSession: mocks.session }));
vi.mock("../../../../../../lib/tenant-admin", () => ({ tenantAdminContext: mocks.gate }));
vi.mock("../../../../../../lib/tenant-branding-assets", () => ({ readTenantBrandingAsset: mocks.read }));
import { GET } from "./route";
const request = () => GET(new Request("https://alpha.example.test/api/settings/branding/assets/asset_alpha"), { params: Promise.resolve({ assetId: "asset_alpha" }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.tenant.mockResolvedValue({ tenantId: "ten_alpha" });
  mocks.session.mockResolvedValue({ activeTenantId: "ten_alpha", activeRole: "tenant_member" });
  mocks.gate.mockResolvedValue({ ok: false }); mocks.read.mockResolvedValue({ mime_type: "image/png", content: Buffer.from([1,2,3]) });
});
it("serves assets to verified members with private no-store caching", async () => {
  const response = await request(); expect(response.status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith("ten_alpha", "asset_alpha");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Host");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
it("denies anonymous and cross-tenant sessions before reading private bytes", async () => {
  mocks.session.mockResolvedValue(null); expect((await request()).status).toBe(404);
  mocks.session.mockResolvedValue({ activeTenantId: "ten_beta", activeRole: "tenant_owner" });
  expect((await request()).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
});
