import { beforeEach, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import type { AiRequest } from "@opentenant/support";
const state = vi.hoisted(() => ({ factory: vi.fn(), currentVoice: vi.fn() }));
vi.mock("@opentenant/support", async original => ({ ...await original<typeof import("@opentenant/support")>(), createSupportAiApi: state.factory }));
vi.mock("@opentenant/database", async original => ({ ...await original<typeof import("@opentenant/database")>(), PgTenantVoiceProfileStore: class { getCurrent = state.currentVoice; } }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({}) }));
import { handleSupportAiRequest, supportAiDependencies } from "./support-ai-composition";
import { installedModules } from "../opentenant-modules";
const host = () => ({ currentTenant: vi.fn(async () => ({ tenantId: "tenant_a" })), currentSession: vi.fn(async () => ({ userId: "user_a", activeTenantId: "tenant_a", isPlatformAdmin: false })), resolvePermissions: vi.fn(async () => ["support.ai.suggest"]), withTenantDb: vi.fn(async () => false), modelRouter: vi.fn(() => ({ resolve: vi.fn(async () => ({})), prepareStream: vi.fn(), complete: vi.fn() })) } as unknown as ModuleHostServices);
const request = { tenant_id: "tenant_a" } as AiRequest;
beforeEach(() => { vi.clearAllMocks(); state.factory.mockReturnValue(async () => new Response(null, { status: 200 })); });
it("composes live dependencies while preserving explicit tenant-local synthetic mode", async () => {
  const h = host(); const req = new Request("https://tenant.example.test/api/example");
  await handleSupportAiRequest(req, h);
  expect(state.factory).toHaveBeenLastCalledWith(h, expect.objectContaining({ inference: expect.any(Object), loadVoice: expect.any(Function) }));
  vi.mocked(h.withTenantDb).mockResolvedValueOnce(true);
  await handleSupportAiRequest(req, h);
  expect(state.factory).toHaveBeenLastCalledWith(h, undefined);
});
it("checks active tenant and live suggestion permission before data access", async () => {
  const h = host(); vi.mocked(h.resolvePermissions).mockResolvedValue([]);
  expect((await handleSupportAiRequest(new Request("https://tenant.example.test"), h)).status).toBe(404);
  expect(h.withTenantDb).not.toHaveBeenCalled(); expect(state.factory).not.toHaveBeenCalled();
});
it("loads only verified current voice data bound to this tenant", async () => {
  const deps = supportAiDependencies(host(), "tenant_a");
  state.currentVoice.mockResolvedValueOnce(null);
  expect(await deps.loadVoice("tenant_a")).toBeUndefined();
  state.currentVoice.mockResolvedValueOnce({ tenantId: "tenant_a", current: { tenantId: "tenant_a", version: 3, digest: "a".repeat(64), profile: { bannedWords: ["promise"], secretExtra: "hidden" } } });
  expect(await deps.loadVoice("tenant_a")).toEqual({ version: 3, digest: "a".repeat(64), bannedWords: ["promise"] });
  await expect(deps.loadVoice("tenant_b")).rejects.toThrow("tenant mismatch");
  expect(state.currentVoice).toHaveBeenCalledTimes(2);
});
it("uses tenant routing but refuses inference without recorded evidence and quarantine", async () => {
  const h = host(); const router = h.modelRouter(); vi.mocked(h.modelRouter).mockReturnValue(router);
  const deps = supportAiDependencies(h, "tenant_a");
  await expect(deps.inference.prepare(request)).rejects.toMatchObject({ code: "AUDIT_RECORDING_FAILED" });
  expect(router.resolve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_a", useCase: "reviewed-suggestion" }));
  await expect(deps.inference.prepare({ ...request, tenant_id: "tenant_b" })).rejects.toThrow("tenant mismatch");
  expect(router.resolve).toHaveBeenCalledTimes(1);
  await expect(deps.quarantine(request, "secret-canary")).rejects.toThrow(/^Support owner quarantine unavailable$/);
  expect(await deps.inference.verify(request, {} as never, {} as never)).toBe(false);
  expect(router.prepareStream).not.toHaveBeenCalled(); expect(router.complete).not.toHaveBeenCalled();
});
it("returns fixed uncached errors without dependency secrets or logs", async () => {
  const h = host(); vi.mocked(h.withTenantDb).mockRejectedValue(new Error("secret-canary"));
  const log = vi.spyOn(console, "error");
  const response = await handleSupportAiRequest(new Request("https://tenant.example.test"), h);
  expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).not.toContain("secret-canary"); expect(log).not.toHaveBeenCalled(); log.mockRestore();
});

it.each(["/api/support/ai/suggestions", "/api/support/ai/suggestions/reviews"])(
  "registers the host-bound Support handler for %s",
  async path => {
    const services = host();
    const httpRequest = new Request("https://tenant.example.test" + path);
    const response = await installedModules.apiRoute(path)!.handle(httpRequest, services);
    expect(response.status).toBe(200);
    expect(services.withTenantDb).toHaveBeenCalledWith("tenant_a", expect.any(Function));
    expect(state.factory).toHaveBeenCalledWith(services, expect.objectContaining({ loadVoice: expect.any(Function) }));
  },
);
