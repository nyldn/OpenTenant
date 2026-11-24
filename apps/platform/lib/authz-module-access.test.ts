import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentitySession, TenantId, UserId } from "@opentenant/auth";
const mocks = vi.hoisted(() => ({
  sync: true, query: vi.fn(), listTenantMembers: vi.fn(), queueMember: vi.fn(), queueModule: vi.fn(), acknowledged: vi.fn(), listPermissions: vi.fn(), loadContext: undefined as undefined | (() => Promise<unknown>),
}));
const manifest = { key: "example", version: "1", runtime: "native", navigation: [], permissions: ["example.use"], rolePermissions: { tenant_member: ["example.use"] } };
vi.mock("../opentenant-modules", () => ({ installedModules: { get: () => ({ manifest }) } }));
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query: mocks.query }) }));
vi.mock("./identity", () => ({ identityGateway: () => ({ listTenantMembers: mocks.listTenantMembers }) }));
vi.mock("./member-mutation-lock", () => ({ withTenantMemberMutationLock: async (_tenant: string, work: (client: unknown) => Promise<unknown>) => work({ query: mocks.query }) }));
vi.mock("./authz-lifecycle", () => ({
  authorizationSyncEnabled: () => mocks.sync, queueMembershipSync: mocks.queueMember,
  queueEntitlementSync: mocks.queueModule, acknowledgedAuthorizationContext: mocks.acknowledged,
}));
vi.mock("@opentenant/authz", () => ({
  failClosed: async (work: () => Promise<unknown>, fallback: unknown) => { try { return await work(); } catch { return fallback; } },
  createAuthorization: async (_config: unknown, options: { loadContext: () => Promise<unknown> }) => { mocks.loadContext = options.loadContext; return { listPermissions: mocks.listPermissions }; },
}));
import { resolvePermissions } from "./module-access";
const session: IdentitySession = { userId: "user_a" as UserId, activeTenantId: "ten_a" as TenantId, activeRole: "tenant_admin", permissions: [], isPlatformAdmin: false, email: "member@example.test", displayName: null, expiresAt: new Date(Date.now() + 60_000) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.sync = true; mocks.loadContext = undefined;
  mocks.query.mockResolvedValue({ rows: [{ enabled: true, authorization_manifest: manifest }] });
  mocks.listTenantMembers.mockResolvedValue([{ kind: "membership", userId: "user_a", tenantId: "ten_a", role: "tenant_admin", status: "active" }]);
  mocks.acknowledged.mockResolvedValue(null); mocks.queueMember.mockResolvedValue(undefined); mocks.queueModule.mockResolvedValue(undefined);
  mocks.listPermissions.mockResolvedValue(["example.use"]);
});
describe("permission resolution lifecycle fence", () => {
  it("initializes acceptance on the locked client and denies pending versions before calling FGA", async () => {
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual([]);
    expect(mocks.queueMember).toHaveBeenCalledWith(expect.objectContaining({ query: mocks.query }), {
      tenantId: "ten_a", userId: "user_a", role: "tenant_admin", active: true,
    }, { initializeOnly: true });
    expect(mocks.queueModule).toHaveBeenCalled(); expect(mocks.listPermissions).not.toHaveBeenCalled();
  });
  it("uses acknowledged local roles and versions instead of stale session authority", async () => {
    mocks.acknowledged.mockResolvedValue({ roles: ["tenant_member"], manifest, membershipVersion: "member_2", moduleVersion: "module_3" });
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual(["example.use"]);
    expect(await mocks.loadContext!()).toMatchObject({ roles: ["tenant_member"], membershipVersion: "member_2", moduleVersion: "module_3" });
  });
  it("fails closed on removed or foreign memberships and identity outages", async () => {
    mocks.listTenantMembers.mockResolvedValue([]);
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual([]);
    mocks.listTenantMembers.mockResolvedValue([{ tenantId: "ten_b", userId: "user_a", status: "active" }]);
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual([]);
    mocks.listTenantMembers.mockRejectedValue(new Error("synthetic identity outage"));
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual([]);
    expect(mocks.listPermissions).not.toHaveBeenCalled();
  });
  it("never invokes lifecycle reconciliation when the provider is disabled", async () => {
    mocks.sync = false;
    expect(await resolvePermissions(session, "ten_a", "example")).toEqual(["example.use"]);
    expect(mocks.listTenantMembers).not.toHaveBeenCalled(); expect(mocks.queueMember).not.toHaveBeenCalled(); expect(mocks.queueModule).not.toHaveBeenCalled();
  });
});
