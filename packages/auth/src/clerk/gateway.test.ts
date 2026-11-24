import { describe, expect, it } from "vitest";
import type {
  AccountLinkStore,
  ExternalMembershipRef,
  OwnedExternalMembershipRef,
  TenantOrgResolver,
} from "../provider-store";
import type { MembershipId, TenantId, UserId } from "../identity";
import {
  ClerkIdentityGateway,
  modulePermissionsFromClerk,
  roleFromClerk,
} from "./gateway";
import type {
  ClerkAuthenticatedSession,
  ClerkInvitationRecord,
  ClerkMembershipRecord,
  ClerkOrgMemberRecord,
  ClerkPort,
  ClerkSessionResult,
} from "./port";
import {
  identityGatewayConformance,
  type GatewayConformanceScenario,
} from "../testing/gateway-conformance";

const tenantA = "tenant_a" as TenantId;
const tenantB = "tenant_b" as TenantId;
const userId = "user_internal" as UserId;
const externalSubject = "clerk_user_example";
const externalOrganizationId = "clerk_org_example";
const membershipId = "membership_internal" as MembershipId;
const expiresAt = new Date("2030-01-01T00:00:00.000Z");

class FakeTenantOrgResolver implements TenantOrgResolver {
  readonly tenants = new Map<string, TenantId>();
  readonly organizations = new Map<TenantId, string>();

  link(tenantId: TenantId, organizationId: string): void {
    this.tenants.set(organizationId, tenantId);
    this.organizations.set(tenantId, organizationId);
  }

  async tenantForExternalOrganization(organizationId: string): Promise<TenantId | null> {
    return this.tenants.get(organizationId) ?? null;
  }

  async externalOrganizationForTenant(tenantId: TenantId): Promise<string | null> {
    return this.organizations.get(tenantId) ?? null;
  }
}

class FakeAccountLinkStore implements AccountLinkStore {
  readonly users = new Map<string, UserId>();
  readonly subjects = new Map<UserId, string>();
  readonly refs = new Map<MembershipId, OwnedExternalMembershipRef>();
  readonly ids = new Map<string, MembershipId>();

  linkUser(internal: UserId, external: string): void {
    this.users.set(external, internal);
    this.subjects.set(internal, external);
  }

  linkMembership(
    internal: MembershipId,
    ref: ExternalMembershipRef,
    context: { tenantId: TenantId; userId: UserId | null },
  ): void {
    this.ids.set(`${ref.kind}:${ref.externalId}`, internal);
    this.refs.set(internal, { ...ref, ...context } as OwnedExternalMembershipRef);
  }

  async userIdForExternalSubject(subject: string): Promise<UserId> {
    const internal = this.users.get(subject);
    if (!internal) throw new Error("unknown subject");
    return internal;
  }

  async externalSubjectForUserId(internal: UserId): Promise<string | null> {
    return this.subjects.get(internal) ?? null;
  }

  async membershipIdForExternalRef(
    ref: ExternalMembershipRef,
    context: { tenantId: TenantId; userId: UserId | null },
  ): Promise<MembershipId> {
    const internal = this.ids.get(`${ref.kind}:${ref.externalId}`);
    if (!internal) throw new Error("unknown membership reference");
    this.refs.set(internal, { ...ref, ...context } as OwnedExternalMembershipRef);
    return internal;
  }

  async externalRefForMembershipId(internal: MembershipId): Promise<OwnedExternalMembershipRef | null> {
    return this.refs.get(internal) ?? null;
  }

  async replaceExternalRefForMembershipId(
    internal: MembershipId,
    current: ExternalMembershipRef,
    replacement: ExternalMembershipRef,
  ): Promise<void> {
    const owned = this.refs.get(internal);
    if (!owned || `${owned.kind}:${owned.externalId}` !== `${current.kind}:${current.externalId}`) {
      throw new Error("membership reference changed concurrently");
    }
    this.refs.set(internal, { ...replacement, tenantId: owned.tenantId, userId: owned.userId } as OwnedExternalMembershipRef);
  }

  async isPlatformAdmin(): Promise<boolean> {
    return false;
  }
}

class FakeClerkPort implements ClerkPort {
  readonly sessions = new Map<string, ClerkSessionResult>();
  readonly membershipsByUser = new Map<string, ClerkMembershipRecord[]>();
  readonly membersByOrganization = new Map<string, ClerkOrgMemberRecord[]>();
  readonly invitationsByOrganization = new Map<string, ClerkInvitationRecord[]>();
  readonly deletedMemberships: Array<{ organizationId: string; subject: string }> = [];
  readonly updatedMemberships: Array<{ organizationId: string; subject: string; role: string }> = [];
  readonly revokedSessions: string[] = [];
  invitationId = "clerk_invitation_example";
  authorizationTarget: URL | null = null;

  async createOrganization(): Promise<string> {
    return "clerk_org_created";
  }

  async deleteOrganization(): Promise<void> {}

  async authenticateSession(token: string): Promise<ClerkSessionResult> {
    return this.sessions.get(token) ?? { status: "invalid" };
  }

  async listMembershipsForUser(subject: string): Promise<ClerkMembershipRecord[]> {
    return this.membershipsByUser.get(subject) ?? [];
  }

  async listMembershipsForOrganization(organizationId: string): Promise<ClerkOrgMemberRecord[]> {
    return this.membersByOrganization.get(organizationId) ?? [];
  }

  async listInvitationsForOrganization(organizationId: string): Promise<ClerkInvitationRecord[]> {
    return this.invitationsByOrganization.get(organizationId) ?? [];
  }

  async sendInvitation(_email: string, _organizationId: string, _role: string): Promise<string> {
    return this.invitationId;
  }

  async revokeInvitation(_organizationId: string, _externalInvitationId: string): Promise<void> {}

  async replaceInvitationRole(_organizationId: string, invitationId: string): Promise<string> {
    return `${invitationId}_replacement`;
  }

  async deleteMembership(organizationId: string, subject: string): Promise<void> {
    this.deletedMemberships.push({ organizationId, subject });
  }

  async updateMembershipRole(organizationId: string, subject: string, role: string): Promise<void> {
    this.updatedMemberships.push({ organizationId, subject, role });
  }

  async authorizationUrl(returnPath: string, requestUrl: string): Promise<URL> {
    if (this.authorizationTarget !== null) return this.authorizationTarget;
    const url = new URL("/sign-in", requestUrl);
    url.searchParams.set("redirect_url", returnPath);
    return url;
  }

  async revokeSession(token: string): Promise<void> {
    this.revokedSessions.push(token);
  }
}

function authenticated(overrides: Partial<ClerkAuthenticatedSession> = {}): ClerkSessionResult {
  return {
    status: "authenticated",
    session: {
      externalSessionId: "clerk_session_example",
      externalSubject,
      externalOrganizationId,
      email: "member@example.test",
      displayName: "Member Example",
      impersonated: false,
      role: "org:tenant_owner",
      permissions: ["org:brain:promote"],
      expiresAt,
      ...overrides,
    },
  };
}

function membership(overrides: Partial<ClerkMembershipRecord> = {}): ClerkMembershipRecord {
  return {
    externalMembershipId: "clerk_membership_example",
    externalSubject,
    externalOrganizationId,
    role: "org:tenant_owner",
    status: "active",
    ...overrides,
  };
}

function createGateway() {
  const port = new FakeClerkPort();
  const orgs = new FakeTenantOrgResolver();
  const accounts = new FakeAccountLinkStore();
  return {
    gateway: new ClerkIdentityGateway(port, orgs, accounts),
    port,
    orgs,
    accounts,
  };
}

function createConformanceFixture(scenario: GatewayConformanceScenario) {
  const { gateway, port, orgs, accounts } = createGateway();
  const token = `${scenario}_token`;
  orgs.link(tenantA, externalOrganizationId);
  accounts.linkUser(userId, externalSubject);

  if (scenario === "expired") {
    port.sessions.set(token, { status: "expired" });
  } else if (scenario === "invalid") {
    port.sessions.set(token, { status: "invalid" });
  } else {
    port.sessions.set(token, authenticated({ impersonated: scenario === "impersonated" }));
    if (scenario !== "missing_membership" && scenario !== "impersonated") {
      port.membershipsByUser.set(externalSubject, [
        membership({ status: scenario === "inactive_membership" ? "inactive" : "active" }),
      ]);
    }
  }

  return {
    gateway,
    tenantId: tenantA,
    token,
    expectedSession: {
      userId,
      email: "member@example.test",
      displayName: "Member Example",
      activeTenantId: tenantA,
      activeRole: "tenant_owner" as const,
      permissions: ["brain.promote"],
      isPlatformAdmin: false,
      expiresAt,
    },
    revokedSessionTokens: port.revokedSessions,
  };
}

identityGatewayConformance("Clerk", createConformanceFixture);

describe("ClerkIdentityGateway", () => {
  it("maps only the reviewed roles and module permissions", () => {
    expect(roleFromClerk("org:tenant_owner")).toBe("tenant_owner");
    expect(roleFromClerk("org:tenant_admin")).toBe("tenant_admin");
    expect(roleFromClerk("org:member")).toBe("tenant_member");
    expect(roleFromClerk("org:admin")).toBeNull();
    expect(modulePermissionsFromClerk([
      "org:brain:promote",
      "org:brand:proposal:review",
      "org:brand:proposal:apply",
      "org:sys_memberships:manage",
      "org:unknown:grant",
    ])).toEqual([
      "brain.promote",
      "brand.proposal.review",
      "brand.proposal.apply",
    ]);
  });

  it("returns a normalized tenant-bound session with explicit role and permission mapping", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    port.sessions.set("token", authenticated({
      permissions: ["org:brain:promote", "org:sys_memberships:manage", "org:unknown:grant"],
    }));
    port.membershipsByUser.set(externalSubject, [membership()]);
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);

    await expect(gateway.validateSession("token", tenantA)).resolves.toEqual({
      status: "valid",
      session: {
        userId,
        email: "member@example.test",
        displayName: "Member Example",
        activeTenantId: tenantA,
        activeRole: "tenant_owner",
        permissions: ["brain.promote"],
        isPlatformAdmin: false,
        expiresAt,
      },
    });
  });

  it("fails closed for unknown roles", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    port.membershipsByUser.set(externalSubject, [membership({ role: "org:admin" })]);
    port.sessions.set("unknown-role", authenticated({ role: "org:admin" }));

    await expect(gateway.validateSession("unknown-role", tenantA)).resolves.toEqual({ status: "invalid" });
  });

  it("returns tenant_mismatch for unmapped and cross-tenant organizations", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    accounts.linkUser(userId, externalSubject);
    port.sessions.set("token", authenticated());
    port.membershipsByUser.set(externalSubject, [membership()]);

    await expect(gateway.validateSession("token", tenantA)).resolves.toEqual({
      status: "tenant_mismatch",
      userId,
    });

    orgs.link(tenantB, externalOrganizationId);
    await expect(gateway.validateSession("token", tenantA)).resolves.toEqual({
      status: "tenant_mismatch",
      userId,
    });
  });

  it("rejects ambiguous active membership records", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    port.sessions.set("token", authenticated());
    port.membershipsByUser.set(externalSubject, [
      membership(),
      membership({
        externalMembershipId: "clerk_membership_duplicate",
        status: "inactive",
      }),
    ]);

    await expect(gateway.validateSession("token", tenantA)).resolves.toEqual({
      status: "invalid",
    });
  });

  it("ignores membership records returned for another subject", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    port.membershipsByUser.set(externalSubject, [
      membership({ externalSubject: "clerk_user_other" }),
    ]);

    await expect(gateway.listMemberships(userId)).resolves.toEqual([]);
  });

  it("lists normalized tenant members and invitations", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    const invitationMembershipId = "membership_invitation" as MembershipId;
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    accounts.linkMembership(membershipId, { kind: "membership", externalId: "clerk_membership_example" }, { tenantId: tenantA, userId });
    accounts.linkMembership(invitationMembershipId, { kind: "invitation", externalId: port.invitationId }, { tenantId: tenantA, userId: null });
    port.membersByOrganization.set(externalOrganizationId, [{
      ...membership(),
      email: "member@example.test",
      displayName: "Member Example",
    }]);
    port.invitationsByOrganization.set(externalOrganizationId, [{
      externalInvitationId: port.invitationId,
      email: "invitee@example.test",
      role: "org:member",
      status: "pending",
    }]);

    await expect(gateway.listTenantMembers(tenantA)).resolves.toEqual([
      {
        kind: "membership",
        membershipId,
        userId,
        tenantId: tenantA,
        email: "member@example.test",
        displayName: "Member Example",
        role: "tenant_owner",
        status: "active",
      },
      {
        kind: "invitation",
        membershipId: invitationMembershipId,
        userId: null,
        tenantId: tenantA,
        email: "invitee@example.test",
        displayName: null,
        role: "tenant_member",
        status: "invited",
      },
    ]);
  });

  it("mutates memberships through verified organization and subject ownership", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    accounts.linkMembership(membershipId, { kind: "membership", externalId: "clerk_membership_example" }, { tenantId: tenantA, userId });
    port.membersByOrganization.set(externalOrganizationId, [{
      ...membership(),
      email: "member@example.test",
      displayName: null,
    }]);

    await gateway.setRole(membershipId, "tenant_admin");
    await gateway.removeMembership(membershipId);

    expect(port.updatedMemberships).toEqual([{
      organizationId: externalOrganizationId,
      subject: externalSubject,
      role: "org:tenant_admin",
    }]);
    expect(port.deletedMemberships).toEqual([{
      organizationId: externalOrganizationId,
      subject: externalSubject,
    }]);
  });

  it("refuses mutation when provider membership ownership is ambiguous", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(userId, externalSubject);
    accounts.linkMembership(
      membershipId,
      { kind: "membership", externalId: "clerk_membership_example" },
      { tenantId: tenantA, userId },
    );
    const member = {
      ...membership(),
      email: "member@example.test",
      displayName: null,
    };
    port.membersByOrganization.set(externalOrganizationId, [
      member,
      { ...member, externalMembershipId: "clerk_membership_conflict" },
    ]);

    await expect(gateway.removeMembership(membershipId)).rejects.toThrow(
      "membership ownership conflict",
    );
    expect(port.deletedMemberships).toEqual([]);
  });

  it("starts same-origin login through the port", async () => {
    const { gateway } = createGateway();

    const url = await gateway.startLogin({
      tenantId: null,
      returnPath: "/assessment",
      requestUrl: "https://tenant.example.test/auth/login",
    });
    expect(url.toString()).toBe("https://tenant.example.test/sign-in?redirect_url=%2Fassessment");
  });

  it("rejects a cross-origin or non-sign-in login target", async () => {
    const { gateway, port } = createGateway();
    const request = {
      tenantId: null,
      returnPath: "/assessment",
      requestUrl: "https://tenant.example.test/auth/login",
    };
    port.authorizationTarget = new URL("https://attacker.example.test/sign-in");

    await expect(gateway.startLogin(request)).rejects.toThrow("invalid Clerk login target");

    port.authorizationTarget = new URL("https://tenant.example.test/admin");
    await expect(gateway.startLogin(request)).rejects.toThrow("invalid Clerk login target");
  });
});
