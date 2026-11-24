import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn(), getSession: vi.fn(), acceptInvitation: vi.fn(), setActiveOrganization: vi.fn() }));
vi.mock("./lazy", () => ({ createBetterAuth: () => ({ handler: mocks.handler, api: mocks }) }));
import { handleBetterAuthRequest } from "./http";
const context = { pool: { query: vi.fn() } as never, config: { production: false, baseURL: "http://tenant.example.test", secret: "synthetic-test-secret" }, orgs: { externalOrganizationForTenant: vi.fn().mockResolvedValue("org_example"), tenantForExternalOrganization: vi.fn() }, tenantId: "tenant_example" as never };
beforeEach(() => { vi.clearAllMocks(); });
it("keeps native failed browser forms on a retry path without the password", async () => {
  mocks.handler.mockResolvedValue(Response.json({ message: "provider secret" }, { status: 401 }));
  const response = await handleBetterAuthRequest(new Request("http://tenant.example.test/api/auth/better-auth/login?return=/settings/branding&invitation=inv_example", { method: "POST", headers: { origin: "http://tenant.example.test", accept: "text/html" }, body: new URLSearchParams({ email: "owner@example.test", password: "never-return-this", action: "login" }) }), context);
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location")!);
  expect(location.searchParams.get("email")).toBe("owner@example.test");
  expect(location.searchParams.get("invitation")).toBe("inv_example");
  expect(location.searchParams.get("return")).toBe("/settings/branding");
  expect(location.href).not.toContain("never-return-this");
  expect(location.href).not.toContain("provider secret");
});
it("keeps JSON clients JSON and normalizes credential errors", async () => {
  mocks.handler.mockResolvedValue(Response.json({ message: "provider secret" }, { status: 401 }));
  const response = await handleBetterAuthRequest(new Request("http://tenant.example.test/api/auth/better-auth/login", { method: "POST", headers: { origin: "http://tenant.example.test", accept: "application/json" }, body: new URLSearchParams({ email: "owner@example.test", password: "synthetic-password" }) }), context);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Identity request failed" });
});
it("gives host forms safe retry codes without changing the legacy API response", async () => {
  const request = () => new Request("http://tenant.example.test/api/auth/better-auth/login", { method: "POST", headers: { origin: "http://tenant.example.test", accept: "application/vnd.opentenant.auth-form+json" }, body: new URLSearchParams({ email: "owner@example.test", password: "synthetic-password" }) });
  mocks.handler.mockResolvedValue(Response.json({ message: "provider secret" }, { status: 401 }));
  expect(await (await handleBetterAuthRequest(request(), context)).json()).toEqual({ error: "credentials" });
  mocks.handler.mockResolvedValue(new Response(null, { status: 429 }));
  expect(await (await handleBetterAuthRequest(request(), context)).json()).toEqual({ error: "rate_limit" });
});
it("keeps the existing successful API redirect and opts host forms into JSON", async () => {
  mocks.handler.mockResolvedValue(new Response(null, { headers: { "set-cookie": "opentenant_session=synthetic; Path=/; HttpOnly" } }));
  const request = (accept: string) => new Request("http://tenant.example.test/api/auth/better-auth/login?return=/settings", { method: "POST", headers: { origin: "http://tenant.example.test", accept }, body: new URLSearchParams({ email: "owner@example.test", password: "synthetic-password" }) });
  const unbound = { ...context, tenantId: null };
  const legacy = await handleBetterAuthRequest(request("application/json"), unbound);
  expect(legacy.status).toBe(303);
  expect(legacy.headers.get("location")).toBe("/settings");
  const hostForm = await handleBetterAuthRequest(request("application/vnd.opentenant.auth-form+json"), unbound);
  expect(hostForm.status).toBe(200);
  expect(await hostForm.json()).toEqual({ redirect: "/settings" });
});
it("rejects cross-origin login without touching the provider", async () => {
  const response = await handleBetterAuthRequest(new Request("http://tenant.example.test/api/auth/better-auth/login", { method: "POST", headers: { origin: "http://other.example.test" } }), context);
  expect(response.status).toBe(403);
  expect(mocks.handler).not.toHaveBeenCalled();
});
it("retains safe fields after provider exceptions and renders browser origin denials", async () => {
  mocks.handler.mockRejectedValue(new Error("provider secret"));
  const url = "http://tenant.example.test/api/auth/better-auth/login?return=/settings&invitation=inv_example";
  const response = await handleBetterAuthRequest(new Request(url, { method: "POST", headers: { origin: "http://tenant.example.test", accept: "text/html" }, body: new URLSearchParams({ email: "owner@example.test", name: "Example Owner", action: "signup", password: "never-return-this" }) }), context);
  const target = new URL(response.headers.get("location")!);
  expect(target.searchParams.get("email")).toBe("owner@example.test");
  expect(target.searchParams.get("name")).toBe("Example Owner");
  expect(target.searchParams.get("error")).toBe("unavailable");
  expect(target.href).not.toMatch(/never-return-this|provider.secret/);
  const denied = await handleBetterAuthRequest(new Request(url, { method: "POST", headers: { origin: "null", accept: "text/html" } }), context);
  expect(denied.status).toBe(303);
  expect(denied.headers.get("content-type")).toBeNull();
});
it("returns a failed native sign-out to the host form without provider details", async () => {
  mocks.handler.mockRejectedValue(new Error("provider secret"));
  const response = await handleBetterAuthRequest(new Request("http://tenant.example.test/api/auth/better-auth/sign-out", { method: "POST", headers: { origin: "http://tenant.example.test", accept: "text/html" } }), context);
  expect(response.status).toBe(303);
  expect(new URL(response.headers.get("location")!).pathname).toBe("/auth/better-auth/login");
  expect(await response.text()).toBe("");
});
