import { describe, expect, it, vi } from "vitest";
import { BRAND_PROPOSAL_PERMISSIONS, authorizeBrandProposalAction, type TenantId, type UserId } from "@opentenant/auth";
import { BetterAuthIdentityGateway } from "./gateway";
import type { BetterAuthRuntime } from "./runtime";
function fixture(role: string, platform = false, active: string | null = "org_alpha") {
  const auth = { api: { getSession: vi.fn().mockResolvedValue({ session: { activeOrganizationId: active, expiresAt: new Date(Date.now() + 60_000) }, user: { id: "subject", email: "owner@example.test", name: "Example Owner" } }) } } as unknown as BetterAuthRuntime;
  const db = { query: vi.fn().mockResolvedValue({ rows: [{ role }] }) };
  const accounts = { userIdForExternalSubject: vi.fn().mockResolvedValue("usr_example" as UserId), isPlatformAdmin: vi.fn().mockResolvedValue(platform) };
  const orgs = { tenantForExternalOrganization: vi.fn().mockResolvedValue("tenant_alpha"), externalOrganizationForTenant: vi.fn().mockResolvedValue("org_alpha") };
  return new BetterAuthIdentityGateway(auth, db as never, orgs, accounts as never);
}
describe("Better Auth proposal policy", () => {
  it.each(["owner", "admin"])("derives exact operation grants from verified %s membership", async role => {
    const result = await fixture(role).validateSession("synthetic", "tenant_alpha" as TenantId);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("Expected verified session");
    expect(result.session.permissions).toEqual(BRAND_PROPOSAL_PERMISSIONS);
    for (const permission of BRAND_PROPOSAL_PERMISSIONS) expect(authorizeBrandProposalAction(result.session, "tenant_alpha" as TenantId, permission).allowed).toBe(true);
    expect(authorizeBrandProposalAction(result.session, "tenant_beta" as TenantId, "brand.proposal.apply").allowed).toBe(false);
  });
  it("does not grant members or installation-only sessions operations", async () => {
    for (const gateway of [fixture("member", true), fixture("owner", true, null)]) {
      const result = await gateway.validateSession("synthetic", null);
      expect(result.status).toBe("valid");
      if (result.status === "valid") expect(result.session.permissions).toEqual([]);
    }
  });
  it("rejects a different active organization and unknown roles", async () => {
    expect((await fixture("owner").validateSession("synthetic", "tenant_beta" as TenantId)).status).toBe("tenant_mismatch");
    expect((await fixture("owner,admin").validateSession("synthetic", null)).status).toBe("invalid");
  });
});
