import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), headers: vi.fn(), data: vi.fn(), session: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query: mocks.query }) }));
vi.mock("./session", () => ({ currentSession: mocks.session }));
vi.mock("./tenant-db", () => ({ withTenantDb: mocks.data }));
vi.mock("./module-registry", () => ({ nativeModuleEnabled: async () => true }));
vi.mock("./module-access", () => ({ resolvePermissions: async () => ["support.use", "support.admin"], moduleAccessPolicy: vi.fn(), verifiedPasscodePrincipal: vi.fn(), accessCookieName: () => "module-cookie" }));
vi.mock("./audit", () => ({ audit: vi.fn() }));
vi.mock("./settings-rate-limit", () => ({ enforceMutationRateLimit: async () => null }));
import { currentTenant, tenantLifecycleForHost } from "./tenant";
import { POST } from "../app/api/[...moduleApi]/route";
import { createSupportContext } from "@opentenant/support/host-context";
import { moduleServices } from "./module-services";
const supportContext = createSupportContext(moduleServices);

describe("suspension fails closed at representative tenant data boundaries", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("blocks reads and writes while suspended and restores both after resume", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    mocks.headers.mockResolvedValue(new Headers({ host: "suspended.example.test" }));
    let status = "suspended";
    mocks.query.mockImplementation(async () => ({ rows: [{ tenantId: "tenant_example", slug: "suspended", displayName: "Example", status }] }));
    mocks.session.mockResolvedValue({ userId: "user_example", activeTenantId: "tenant_example", activeRole: "tenant_owner", permissions: ["support.use"] });
    mocks.data.mockResolvedValue({ id: "ticket_example" });
    expect(await currentTenant()).toBeNull();
    expect(await tenantLifecycleForHost()).toEqual({ status: "suspended" });
    expect(await supportContext()).toMatchObject({ ok: false, reason: "no_tenant", response: expect.objectContaining({ status: 423 }) });
    const request = () => new Request("https://suspended.example.test/api/support/tickets", { method: "POST", body: new URLSearchParams({ op: "create", subject: "Example", description: "Synthetic" }) });
    expect((await POST(request())).status).toBe(423);
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    status = "active";
    expect(await supportContext()).toMatchObject({ ok: true });
    expect((await POST(request())).status).toBe(303);
    expect(mocks.data).toHaveBeenCalledOnce();
    status = "deleted";
    expect(await currentTenant()).toBeNull();
  });
  it("returns no lifecycle details for an unknown host", async () => {
    mocks.headers.mockResolvedValue(new Headers({ host: "unknown.example.test" }));
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await tenantLifecycleForHost()).toBeNull();
  });
});
