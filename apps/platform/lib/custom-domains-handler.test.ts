import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), add: vi.fn(), reissue: vi.fn(), verify: vi.fn(), remove: vi.fn() }));
vi.mock("./tenant-admin", () => ({ tenantAdminContext: mocks.gate }));
vi.mock("./custom-domains", () => ({ addCustomDomain: mocks.add, reissueCustomDomain: mocks.reissue, verifyCustomDomain: mocks.verify, removeCustomDomain: mocks.remove }));
import { domainMutation } from "./custom-domains-handler";
const dns = vi.fn();
const post = domainMutation(dns);
const context = { tenant: { tenantId: "ten_alpha" }, session: { activeTenantId: "ten_alpha", activeRole: "tenant_owner" }, auditActor: { kind: "user", userId: "user_example" } };
function request(action = "add", origin = "https://alpha.platform.test") {
  return new Request("https://alpha.platform.test/api/settings/domains", { method: "POST", headers: { origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action, host: "app.customer.test", tenantId: "ten_beta" }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.gate.mockResolvedValue({ ok: true, context }); mocks.add.mockResolvedValue({ token: "synthetic" }); });
it.each(["tenant_owner", "tenant_admin"])("allows %s bound to the resolved tenant and actor", async (role) => {
  mocks.gate.mockResolvedValue({ ok: true, context: { ...context, session: { ...context.session, activeRole: role } } });
  const response = await post(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.add).toHaveBeenCalledWith("ten_alpha", "app.customer.test", context.auditActor);
});
it.each(["tenant_member", "platform_admin", "anonymous"])("denies %s", async (role) => {
  mocks.gate.mockResolvedValue({ ok: true, context: { ...context, session: { ...context.session, activeRole: role } } });
  expect((await post(request())).status).toBe(403);
  expect(mocks.add).not.toHaveBeenCalled();
});
it("denies cross-tenant sessions, managed support, and cross-origin requests", async () => {
  expect((await post(request("add", "https://beta.platform.test"))).status).toBe(403);
  mocks.gate.mockResolvedValue({ ok: true, context: { ...context, managedSupport: {} } });
  expect((await post(request())).status).toBe(403);
  mocks.gate.mockResolvedValue({ ok: true, context: { ...context, session: { ...context.session, activeTenantId: "ten_beta" } } });
  expect((await post(request())).status).toBe(403);
  expect(mocks.add).not.toHaveBeenCalled();
});
it("verifies using only server-injected DNS", async () => {
  await post(request("verify"));
  expect(mocks.verify).toHaveBeenCalledWith("ten_alpha", "app.customer.test", context.auditActor, dns);
});
it("normalizes errors without exposing provider or database details", async () => {
  mocks.add.mockRejectedValue(new Error("sensitive provider value"));
  const response = await post(request());
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("sensitive");
});

it("reissues only for the authenticated tenant and records no plaintext in errors", async () => {
  mocks.reissue.mockResolvedValue({ token: "synthetic", record: "_opentenant-challenge.app.customer.test" });
  expect((await post(request("reissue"))).status).toBe(200);
  expect(mocks.reissue).toHaveBeenCalledWith("ten_alpha", "app.customer.test", context.auditActor);
});
