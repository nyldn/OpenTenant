import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), resolver: vi.fn(), host: "app.customer.test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: mocks.host }), cookies: vi.fn() }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query: mocks.query }) }));
vi.mock("./server-config", () => ({ serverConfig: () => ({ NODE_ENV: "production", OPENTENANT_TENANT_BASE_DOMAIN: "platform.test", PLATFORM_ADMIN_HOST: "control.example.test" }) }));
vi.mock("@opentenant/database", () => ({ PgTenantResolver: class { tenantForHost = mocks.resolver; } }));
import { currentTenant } from "./tenant";
const alpha = { tenantId: "ten_alpha", slug: "alpha", displayName: "Example Alpha", status: "active" };
beforeEach(() => { vi.clearAllMocks(); mocks.host = "app.customer.test"; mocks.query.mockResolvedValue({ rows: [alpha] }); mocks.resolver.mockResolvedValue(alpha); });
it("uses fresh verified, unexpired custom-host evidence", async () => {
  expect(await currentTenant()).toEqual(alpha);
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("verification_valid_until > now()"), ["app.customer.test"]);
  expect(mocks.resolver).not.toHaveBeenCalled();
});
it("fails closed when a removed or expired custom mapping disappears", async () => {
  expect(await currentTenant()).toEqual(alpha);
  mocks.query.mockResolvedValue({ rows: [] });
  expect(await currentTenant()).toBeNull();
});
it.each(["alpha.platform.test", "control.example.test"])("resolves platform mappings with fresh lifecycle state for %s", async (host) => {
  mocks.host = host;
  expect(await currentTenant()).toEqual(alpha);
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("t.status"), [host]);
  expect(mocks.resolver).not.toHaveBeenCalled();
  mocks.query.mockResolvedValue({ rows: [{ ...alpha, status: "suspended" }] });
  expect(await currentTenant()).toBeNull();
});
