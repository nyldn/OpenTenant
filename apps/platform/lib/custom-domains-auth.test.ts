import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), query: vi.fn() }));
vi.mock("./custom-domains-resolution", async (importOriginal) => ({ ...await importOriginal<typeof import("./custom-domains-resolution")>(), verifiedCustomTenantForHost: mocks.resolve }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query: mocks.query }) }));
vi.mock("./server-config", () => ({ tenantHostname: (slug: string) => `${slug}.platform.test` }));
import { GET, POST } from "../app/api/settings/domains/auth/route";
const request = (path: string) => new Request(`https://app.customer.test/api/settings/domains/auth?path=${encodeURIComponent(path)}`, { headers: { host: "app.customer.test" } });
beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ tenantId: "ten_alpha", slug: "alpha" }); mocks.query.mockResolvedValue({ rows: [{ exists: 1 }] }); });
it("redirects a verified custom host to its verified platform mapping without cookies", async () => {
  const response = await GET(request("/auth/login?return=%2Fsupport"));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://alpha.platform.test/auth/login?return=%2Fsupport");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ["alpha.platform.test", "ten_alpha"]);
});
it("never relays OAuth code/state", async () => {
  const response = await GET(request("/auth/callback?code=synthetic&state=synthetic"));
  expect(response.headers.get("location")).toBe("https://alpha.platform.test/auth/login");
});
it.each([
  ["/auth/login?return=%2Fsupport", "/auth/login?return=%2Fsupport"],
  ["/settings/domains", "/settings/domains"],
  ["/auth/callback?code=synthetic&state=synthetic", "/auth/login"],
])("handles Next retaining the original URL after rewriting %s", async (path, destination) => {
  const response = await GET(new Request(`https://app.customer.test${path}`, { headers: { host: "app.customer.test" } }));
  expect(response.headers.get("location")).toBe(`https://alpha.platform.test${destination}`);
});
it("denies expired/removed/unknown custom hosts and missing canonical mappings", async () => {
  mocks.resolve.mockResolvedValue(null);
  expect((await GET(request("/auth/login"))).status).toBe(404);
  mocks.resolve.mockResolvedValue({ tenantId: "ten_alpha", slug: "alpha" });
  mocks.query.mockResolvedValue({ rows: [] });
  expect((await GET(request("/auth/login"))).status).toBe(404);
});
it("refuses cross-origin mutation replay", () => expect(POST().status).toBe(403));

it("restricts provider sign-in return URLs to same-origin paths", async () => {
  const response = await GET(request("/sign-in?redirect_url=https://evil.test&force_redirect_url=https://evil.test"));
  expect(response.headers.get("location")).toBe("https://alpha.platform.test/sign-in?redirect_url=%2F");
});
