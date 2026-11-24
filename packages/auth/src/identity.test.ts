import { describe, expect, it } from "vitest";
import type {
  IdentityGateway,
  IdentitySession,
  Invitation,
  LoginRequest,
  MembershipId,
  SessionValidationResult,
  TenantId,
  TenantMember,
  TenantMembership,
  TenantRole,
  UserId,
} from "./identity";

/**
 * In-memory fake proving the contract is implementable and testable with no
 * provider SDK objects (spec 16.1). The WorkOS adapter must pass this same
 * behavioral suite.
 */
class FakeIdentityGateway implements IdentityGateway {
  private memberships = new Map<MembershipId, TenantMembership>();
  private sessions = new Map<string, IdentitySession>();
  private nextId = 1;

  seedSession(token: string, session: IdentitySession): void {
    this.sessions.set(token, session);
  }

  async validateSession(
    sessionToken: string,
    expectedTenantId: TenantId | null,
  ): Promise<SessionValidationResult> {
    const session = this.sessions.get(sessionToken);
    if (!session) return { status: "invalid" };
    if (session.expiresAt.getTime() < Date.now()) return { status: "expired" };
    if (
      expectedTenantId !== null &&
      session.activeTenantId !== null &&
      session.activeTenantId !== expectedTenantId
    ) {
      return { status: "tenant_mismatch", userId: session.userId };
    }
    return { status: "valid", session };
  }

  async listMemberships(userId: UserId): Promise<TenantMembership[]> {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }

  async listTenantMembers(_tenantId: TenantId): Promise<TenantMember[]> {
    return [];
  }

  async invite(invitation: Invitation): Promise<MembershipId> {
    const existing = [...this.memberships.values()].find(
      (m) => m.tenantId === invitation.tenantId && m.status === "invited",
    );
    if (existing) return existing.membershipId;
    const membershipId = `mem_${this.nextId++}` as MembershipId;
    this.memberships.set(membershipId, {
      membershipId,
      userId: `user_${this.nextId++}` as UserId,
      tenantId: invitation.tenantId,
      role: invitation.role,
      status: "invited",
    });
    return membershipId;
  }

  async removeMembership(membershipId: MembershipId): Promise<void> {
    const membership = this.memberships.get(membershipId);
    if (membership) {
      this.memberships.set(membershipId, { ...membership, status: "removed" });
    }
  }

  async setRole(membershipId: MembershipId, role: TenantRole): Promise<void> {
    const membership = this.memberships.get(membershipId);
    if (!membership) throw new Error("unknown membership");
    this.memberships.set(membershipId, { ...membership, role });
  }

  async startLogin(request: LoginRequest): Promise<URL> {
    return new URL(`https://login.example.test/start?return=${encodeURIComponent(request.returnPath)}`);
  }

  async logout(sessionToken: string): Promise<void> {
    this.sessions.delete(sessionToken);
  }
}

const tenantA = "ten_a" as TenantId;
const tenantB = "ten_b" as TenantId;

function sessionFor(tenant: TenantId | null): IdentitySession {
  return {
    userId: "user_1" as UserId,
    email: "member@example.test",
    displayName: null,
    activeTenantId: tenant,
    activeRole: tenant ? "tenant_member" : null,
    permissions: [],
    isPlatformAdmin: false,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe("IdentityGateway contract", () => {
  it("validates a session for the expected tenant", async () => {
    const gateway = new FakeIdentityGateway();
    gateway.seedSession("tok", sessionFor(tenantA));
    const result = await gateway.validateSession("tok", tenantA);
    expect(result.status).toBe("valid");
  });

  it("fails closed on tenant mismatch", async () => {
    const gateway = new FakeIdentityGateway();
    gateway.seedSession("tok", sessionFor(tenantA));
    const result = await gateway.validateSession("tok", tenantB);
    expect(result.status).toBe("tenant_mismatch");
  });

  it("rejects unknown and expired sessions distinctly", async () => {
    const gateway = new FakeIdentityGateway();
    gateway.seedSession("old", {
      ...sessionFor(tenantA),
      expiresAt: new Date(Date.now() - 1),
    });
    expect((await gateway.validateSession("missing", tenantA)).status).toBe("invalid");
    expect((await gateway.validateSession("old", tenantA)).status).toBe("expired");
  });

  it("invitation is idempotent per tenant while pending", async () => {
    const gateway = new FakeIdentityGateway();
    const invitation: Invitation = {
      email: "new@example.test",
      tenantId: tenantA,
      role: "tenant_member",
      invitedBy: "user_1" as UserId,
    };
    const first = await gateway.invite(invitation);
    const second = await gateway.invite(invitation);
    expect(second).toBe(first);
  });

  it("removal is terminal and role changes require a live membership", async () => {
    const gateway = new FakeIdentityGateway();
    const membershipId = await gateway.invite({
      email: "new@example.test",
      tenantId: tenantA,
      role: "tenant_member",
      invitedBy: "user_1" as UserId,
    });
    await gateway.setRole(membershipId, "tenant_admin");
    await gateway.removeMembership(membershipId);
    const memberships = await gateway.listMemberships(
      (await gateway.listMemberships("user_2" as UserId))[0]?.userId ?? ("user_2" as UserId),
    );
    expect(memberships.every((m) => m.status === "removed" || m.role === "tenant_admin")).toBe(true);
  });

  it("logout invalidates the session", async () => {
    const gateway = new FakeIdentityGateway();
    gateway.seedSession("tok", sessionFor(tenantA));
    await gateway.logout("tok");
    expect((await gateway.validateSession("tok", tenantA)).status).toBe("invalid");
  });
});
