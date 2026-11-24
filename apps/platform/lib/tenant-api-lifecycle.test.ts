import { afterEach, expect, it, vi } from "vitest";
const lifecycle = vi.hoisted(() => vi.fn());
vi.mock("./tenant", () => ({ tenantLifecycleForHost: lifecycle }));
import { tenantApiLifecycleResponse } from "./settings-guard";
afterEach(() => vi.resetAllMocks());
it("returns secret-free uncached 423 for suspended API hosts", async () => {
  lifecycle.mockResolvedValue({ status: "suspended", tenantId: "secret-canary" });
  const response = await tenantApiLifecycleResponse();
  expect(response?.status).toBe(423);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response?.text()).not.toContain("secret-canary");
});
it("fails closed on lifecycle lookup errors", async () => {
  lifecycle.mockRejectedValue(new Error("secret-canary"));
  const response = await tenantApiLifecycleResponse();
  expect(response?.status).toBe(503);
  expect(await response?.text()).not.toContain("secret-canary");
});
it.each([null, { status: "active" }, { status: "deleted" }])("preserves other gate decisions for %j", async status => {
  lifecycle.mockResolvedValue(status);
  expect(await tenantApiLifecycleResponse()).toBeNull();
});
