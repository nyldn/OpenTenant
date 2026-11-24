vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  role: "tenant_owner",
  isPlatformAdmin: false,
  resolveOrganization: vi.fn(),
  generateLink: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../../../../lib/identity", () => ({
  identityProviderFromEnv: mocks.provider,
  tenantOrgResolver: () => ({ externalOrganizationForTenant: mocks.resolveOrganization }),
  workosPort: () => ({ generateAdminPortalLink: mocks.generateLink }),
}));
vi.mock("../../../../lib/audit", () => ({ audit: mocks.audit }));
vi.mock("../../../../lib/settings-guard", () => ({
  auditActor: () => ({ kind: "user", userId: "usr_admin" }),
  sameOrigin: () => true,
}));
vi.mock("../../../../lib/tenant-admin", () => ({
  tenantAdminContext: async () => ({
    ok: true,
    context: {
      session: { userId: "usr_admin", activeRole: mocks.role, isPlatformAdmin: mocks.isPlatformAdmin },
      tenant: { tenantId: "tenant_example", displayName: "Example" },
      auditActor: { kind: "user", userId: "usr_admin" },
    },
  }),
}));

import { POST } from "./route";

function request(intent = "sso"): Request {
  return new Request("https://app.example.test/api/settings/identity-portal", {
    method: "POST",
    body: new URLSearchParams({ intent }),
  });
}

describe("identity portal capability", () => {
  beforeEach(() => {
    mocks.role = "tenant_owner";
    mocks.isPlatformAdmin = false;
    mocks.provider.mockReset();
    mocks.resolveOrganization.mockReset();
    mocks.generateLink.mockReset();
    mocks.audit.mockReset().mockResolvedValue(undefined);
  });

  it("returns a provider-neutral 404 for Clerk without calling WorkOS", async () => {
    mocks.provider.mockReturnValue("clerk");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("retains the audited WorkOS capability redirect", async () => {
    mocks.provider.mockReturnValue("workos");
    mocks.resolveOrganization.mockResolvedValue("workos_org_internal_adapter_only");
    mocks.generateLink.mockResolvedValue(new URL("https://provider.example.test/portal"));

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://provider.example.test/portal");
    expect(mocks.audit).toHaveBeenCalledBefore(mocks.generateLink);
  });

  it.each(["sso", "dsync"])("denies tenant admins the %s portal before audit or provider work", async (intent) => {
    mocks.provider.mockReturnValue("workos");
    mocks.role = "tenant_admin";
    mocks.resolveOrganization.mockClear(); mocks.generateLink.mockClear(); mocks.audit.mockClear();
    const response = await POST(request(intent));
    expect(response.status).toBe(403);
    expect(mocks.resolveOrganization).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(["sso", "dsync", "domain_verification"])("permits owners to launch %s", async (intent) => {
    mocks.provider.mockReturnValue("workos"); mocks.role = "tenant_owner";
    mocks.resolveOrganization.mockResolvedValue("org_example");
    mocks.generateLink.mockResolvedValue(new URL("https://provider.example.test/portal"));
    expect((await POST(request(intent))).status).toBe(303);
  });

  it("keeps domain verification available to tenant admins", async () => {
    mocks.provider.mockReturnValue("workos"); mocks.role = "tenant_admin";
    mocks.resolveOrganization.mockResolvedValue("org_example");
    mocks.generateLink.mockResolvedValue(new URL("https://provider.example.test/portal"));
    expect((await POST(request("domain_verification"))).status).toBe(303);
  });
});
