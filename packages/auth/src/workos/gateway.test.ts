import { describe, expect, it } from "vitest";
import { WorkOSIdentityGateway } from "./gateway";
import type {
  AccountLinkStore,
  ExternalMembershipRef,
  TenantOrgResolver,
} from "./gateway";
import type { OwnedExternalMembershipRef } from "../provider-store";
import type {
  Invitation,
  MembershipId,
  TenantId,
  UserId,
} from "../identity";
import type {
  WorkOSAuthenticatedSession,
  WorkOSMembershipRecord,
  WorkOSPort,
  WorkOSSessionResult,
} from "./port";
import {
  identityGatewayConformance,
  type GatewayConformanceScenario,
} from "../testing/gateway-conformance";

class FakeWorkOSPort implements WorkOSPort {
  async createOrganization(): Promise<string> {
    return "workos_org_created";
  }
  async deleteOrganization(): Promise<void> {}
  async generateAdminPortalLink(): Promise<URL> {
    return new URL("https://portal.example.test/session");
  }
  readonly sessions = new Map<string, WorkOSSessionResult>();
  readonly memberships = new Map<string, WorkOSMembershipRecord[]>();
  readonly invitations: Array<{
    email: string;
    externalOrganizationId: string;
    role: string;
  }> = [];
  readonly deletedMemberships: string[] = [];
  readonly revokedInvitations: string[] = [];
  readonly updatedMembershipRoles: Array<{ externalMembershipId: string; role: string }> = [];
  readonly revokedSessions: string[] = [];
  readonly replacedInvitations: Array<{
    externalOrganizationId: string;
    externalInvitationId: string;
    role: string;
  }> = [];
  readonly organizationMembers = new Map<string, Array<{
    externalMembershipId: string;
    externalSubject: string;
    email: string;
    displayName: string | null;
    role: string;
    status: "active" | "pending" | "inactive";
  }>>();
  readonly organizationInvitations = new Map<string, Array<{
    externalInvitationId: string;
    email: string;
    role: string;
    status: "pending" | "accepted" | "revoked" | "expired";
  }>>();
  invitationExternalId = "workos_invitation_invited";

  async authenticateSession(sessionToken: string): Promise<WorkOSSessionResult> {
    return this.sessions.get(sessionToken) ?? { status: "invalid" };
  }

  async listMembershipsForUser(externalSubject: string): Promise<WorkOSMembershipRecord[]> {
    return this.memberships.get(externalSubject) ?? [];
  }

  async listMembershipsForOrganization(externalOrganizationId: string) {
    return this.organizationMembers.get(externalOrganizationId) ?? [];
  }

  async listInvitationsForOrganization(externalOrganizationId: string) {
    return this.organizationInvitations.get(externalOrganizationId) ?? [];
  }

  async replaceInvitationRole(
    externalOrganizationId: string,
    externalInvitationId: string,
    role: string,
  ): Promise<string> {
    this.replacedInvitations.push({ externalOrganizationId, externalInvitationId, role });
    const replacementId = `${externalInvitationId}_replacement`;
    const invitations = this.organizationInvitations.get(externalOrganizationId) ?? [];
    this.organizationInvitations.set(
      externalOrganizationId,
      invitations.map((invitation) => invitation.externalInvitationId === externalInvitationId
        ? { ...invitation, externalInvitationId: replacementId, role }
        : invitation),
    );
    return replacementId;
  }

  async sendInvitation(
    email: string,
    externalOrganizationId: string,
    role: string,
  ): Promise<string> {
    this.invitations.push({ email, externalOrganizationId, role });
    return this.invitationExternalId;
  }

  async revokeInvitation(externalInvitationId: string): Promise<void> {
    this.revokedInvitations.push(externalInvitationId);
  }

  async deleteMembership(externalMembershipId: string): Promise<void> {
    this.deletedMemberships.push(externalMembershipId);
  }

  async updateMembershipRole(externalMembershipId: string, role: string): Promise<void> {
    this.updatedMembershipRoles.push({ externalMembershipId, role });
  }

  async authorizationUrl(externalOrganizationId: string | null, returnPath: string): Promise<URL> {
    const url = new URL("https://login.example.test/authorize");
    if (externalOrganizationId !== null) {
      url.searchParams.set("organization", externalOrganizationId);
    }
    url.searchParams.set("return_path", returnPath);
    return url;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    this.revokedSessions.push(sessionToken);
  }
}

class FakeTenantOrgResolver implements TenantOrgResolver {
  readonly tenantsByOrganization = new Map<string, TenantId>();
  readonly organizationsByTenant = new Map<TenantId, string>();

  link(tenantId: TenantId, externalOrganizationId: string): void {
    this.tenantsByOrganization.set(externalOrganizationId, tenantId);
    this.organizationsByTenant.set(tenantId, externalOrganizationId);
  }

  async tenantForExternalOrganization(externalOrganizationId: string): Promise<TenantId | null> {
    return this.tenantsByOrganization.get(externalOrganizationId) ?? null;
  }

  async externalOrganizationForTenant(tenantId: TenantId): Promise<string | null> {
    return this.organizationsByTenant.get(tenantId) ?? null;
  }
}

class FakeAccountLinkStore implements AccountLinkStore {
  readonly usersBySubject = new Map<string, UserId>();
  readonly subjectsByUser = new Map<UserId, string>();
  readonly membershipsByExternalRef = new Map<string, MembershipId>();
  readonly externalRefsByMembership = new Map<MembershipId, OwnedExternalMembershipRef>();
  readonly platformAdmins = new Set<UserId>();

  linkUser(userId: UserId, externalSubject: string): void {
    this.usersBySubject.set(externalSubject, userId);
    this.subjectsByUser.set(userId, externalSubject);
  }

  linkMembership(
    membershipId: MembershipId,
    ref: ExternalMembershipRef,
    context: { tenantId: TenantId; userId: UserId | null } = {
      tenantId: "tenant_a" as TenantId,
      userId: ref.kind === "membership" ? ("user_internal" as UserId) : null,
    },
  ): void {
    this.membershipsByExternalRef.set(this.refKey(ref), membershipId);
    this.externalRefsByMembership.set(membershipId, { ...ref, ...context } as OwnedExternalMembershipRef);
  }

  async userIdForExternalSubject(
    externalSubject: string,
    _email: string,
    _displayName: string | null,
  ): Promise<UserId> {
    const userId = this.usersBySubject.get(externalSubject);
    if (userId === undefined) throw new Error("unknown external subject");
    return userId;
  }

  async externalSubjectForUserId(userId: UserId): Promise<string | null> {
    return this.subjectsByUser.get(userId) ?? null;
  }

  async membershipIdForExternalRef(ref: ExternalMembershipRef): Promise<MembershipId> {
    const membershipId = this.membershipsByExternalRef.get(this.refKey(ref));
    if (membershipId === undefined) throw new Error("unknown external membership reference");
    return membershipId;
  }

  async externalRefForMembershipId(
    membershipId: MembershipId,
  ): Promise<OwnedExternalMembershipRef | null> {
    return this.externalRefsByMembership.get(membershipId) ?? null;
  }

  async replaceExternalRefForMembershipId(
    membershipId: MembershipId,
    current: ExternalMembershipRef,
    replacement: ExternalMembershipRef,
  ): Promise<void> {
    const owned = this.externalRefsByMembership.get(membershipId);
    if (!owned || this.refKey(owned) !== this.refKey(current) || current.kind !== replacement.kind) {
      throw new Error("membership reference changed concurrently");
    }
    this.externalRefsByMembership.set(membershipId, {
      ...replacement,
      tenantId: owned.tenantId,
      userId: owned.userId,
    } as OwnedExternalMembershipRef);
  }

  async isPlatformAdmin(userId: UserId): Promise<boolean> {
    return this.platformAdmins.has(userId);
  }

  private refKey(ref: ExternalMembershipRef): string {
    return `${ref.kind}:${ref.externalId}`;
  }
}

const tenantA = "tenant_a" as TenantId;
const tenantB = "tenant_b" as TenantId;
const internalUserId = "user_internal" as UserId;
const internalMembershipId = "membership_internal" as MembershipId;
const externalSubject = "workos_user_123";
const externalOrganizationId = "workos_org_a";
const expiresAt = new Date("2030-01-01T00:00:00.000Z");

function authenticatedSession(
  overrides: Partial<WorkOSAuthenticatedSession> = {},
): WorkOSSessionResult {
  return {
    status: "authenticated",
    session: {
      externalSubject,
      email: "member@example.test",
      displayName: "Member Example",
      externalOrganizationId,
      impersonated: false,
      permissions: [],
      expiresAt,
      ...overrides,
    },
  };
}

function membership(overrides: Partial<WorkOSMembershipRecord> = {}): WorkOSMembershipRecord {
  return {
    externalMembershipId: "workos_membership_a",
    externalSubject,
    externalOrganizationId,
    role: "member",
    status: "active",
    ...overrides,
  };
}

function createGateway(): {
  gateway: WorkOSIdentityGateway;
  port: FakeWorkOSPort;
  orgs: FakeTenantOrgResolver;
  accounts: FakeAccountLinkStore;
} {
  const port = new FakeWorkOSPort();
  const orgs = new FakeTenantOrgResolver();
  const accounts = new FakeAccountLinkStore();
  return {
    gateway: new WorkOSIdentityGateway(port, orgs, accounts),
    port,
    orgs,
    accounts,
  };
}

function createConformanceFixture(scenario: GatewayConformanceScenario) {
  const { gateway, port, orgs, accounts } = createGateway();
  const token = `${scenario}_token`;
  orgs.link(tenantA, externalOrganizationId);
  accounts.linkUser(internalUserId, externalSubject);

  if (scenario === "expired") {
    port.sessions.set(token, { status: "expired" });
  } else if (scenario === "invalid") {
    port.sessions.set(token, { status: "invalid" });
  } else {
    port.sessions.set(token, authenticatedSession({ impersonated: scenario === "impersonated" }));
    if (scenario !== "missing_membership" && scenario !== "impersonated") {
      port.memberships.set(externalSubject, [
        membership({ status: scenario === "inactive_membership" ? "inactive" : "active" }),
      ]);
    }
  }

  return {
    gateway,
    tenantId: tenantA,
    token,
    expectedSession: {
      userId: internalUserId,
      email: "member@example.test",
      displayName: "Member Example",
      activeTenantId: tenantA,
      activeRole: "tenant_member" as const,
      permissions: [],
      isPlatformAdmin: false,
      expiresAt,
    },
    revokedSessionTokens: port.revokedSessions,
  };
}

identityGatewayConformance("WorkOS", createConformanceFixture);

describe("WorkOSIdentityGateway", () => {
  it("returns a normalized valid session for an authenticated tenant member", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    port.sessions.set("session_token", authenticatedSession());
    port.memberships.set(externalSubject, [membership({ role: "tenant-admin" })]);
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);
    accounts.platformAdmins.add(internalUserId);

    const result = await gateway.validateSession("session_token", tenantA);

    expect(result).toEqual({
      status: "valid",
      session: {
        userId: internalUserId,
        email: "member@example.test",
        displayName: "Member Example",
        activeTenantId: tenantA,
        activeRole: "tenant_admin",
        permissions: [],
        isPlatformAdmin: true,
        expiresAt,
      },
    });
    if (result.status === "valid") {
      expect(result.session.userId).not.toBe(externalSubject);
    }
  });

  it("passes through module permission claims, dropping non-module shapes", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    port.sessions.set(
      "session_token",
      authenticatedSession({
        permissions: [
          "brain.promote",
          "brain.admin",
          "widgets:dsync:manage", // widget grant, not a module permission
          "Brain.Use", // wrong case
          "noperiod", // not dotted
        ],
      }),
    );
    port.memberships.set(externalSubject, [membership({ role: "tenant-owner" })]);
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);

    const result = await gateway.validateSession("session_token", tenantA);

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.session.permissions).toEqual(["brain.promote", "brain.admin"]);
    }
  });

  it("grants no permissions on an organization-less session", async () => {
    const { gateway, port, accounts } = createGateway();
    port.sessions.set(
      "session_token",
      authenticatedSession({ externalOrganizationId: null, permissions: ["brain.admin"] }),
    );
    accounts.linkUser(internalUserId, externalSubject);

    const result = await gateway.validateSession("session_token", null);

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.session.permissions).toEqual([]);
    }
  });

  it("returns tenant_mismatch when the session organization maps to another tenant", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    port.sessions.set("session_token", authenticatedSession());
    port.memberships.set(externalSubject, [membership()]);
    orgs.link(tenantB, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);

    await expect(gateway.validateSession("session_token", tenantA)).resolves.toEqual({
      status: "tenant_mismatch",
      userId: internalUserId,
    });
  });

  it("returns tenant_mismatch when the session organization has no tenant mapping", async () => {
    const { gateway, port, accounts } = createGateway();
    port.sessions.set("session_token", authenticatedSession());
    accounts.linkUser(internalUserId, externalSubject);

    await expect(gateway.validateSession("session_token", tenantA)).resolves.toEqual({
      status: "tenant_mismatch",
      userId: internalUserId,
    });
  });

  it("returns invalid when the active membership has an unknown WorkOS role slug", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    port.sessions.set("session_token", authenticatedSession());
    port.memberships.set(externalSubject, [membership({ role: "super-admin" })]);
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);

    await expect(gateway.validateSession("session_token", tenantA)).resolves.toEqual({
      status: "invalid",
    });
  });

  it("skips memberships whose organization has no tenant mapping", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    const mappedExternalMembershipId = "workos_membership_mapped";
    const mappedMembershipId = "membership_mapped" as MembershipId;
    accounts.linkUser(internalUserId, externalSubject);
    accounts.linkMembership(mappedMembershipId, {
      kind: "membership",
      externalId: mappedExternalMembershipId,
    });
    orgs.link(tenantA, externalOrganizationId);
    port.memberships.set(externalSubject, [
      membership({ externalMembershipId: mappedExternalMembershipId }),
      membership({
        externalMembershipId: "workos_membership_unmapped",
        externalOrganizationId: "workos_org_unmapped",
      }),
    ]);

    await expect(gateway.listMemberships(internalUserId)).resolves.toEqual([
      {
        membershipId: mappedMembershipId,
        userId: internalUserId,
        tenantId: tenantA,
        role: "tenant_member",
        status: "active",
      },
    ]);
  });

  it("skips memberships with unmappable WorkOS role slugs", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    const mappedExternalMembershipId = "workos_membership_mapped";
    const mappedMembershipId = "membership_mapped" as MembershipId;
    accounts.linkUser(internalUserId, externalSubject);
    accounts.linkMembership(mappedMembershipId, {
      kind: "membership",
      externalId: mappedExternalMembershipId,
    });
    orgs.link(tenantA, externalOrganizationId);
    port.memberships.set(externalSubject, [
      membership({ externalMembershipId: mappedExternalMembershipId }),
      membership({
        externalMembershipId: "workos_membership_unknown_role",
        role: "super-admin",
      }),
    ]);

    await expect(gateway.listMemberships(internalUserId)).resolves.toEqual([
      {
        membershipId: mappedMembershipId,
        userId: internalUserId,
        tenantId: tenantA,
        role: "tenant_member",
        status: "active",
      },
    ]);
  });

  it("lists a tenant's members and invitations with internal identifiers only", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    const invitationMembershipId = "membership_invitation" as MembershipId;
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);
    accounts.linkMembership(internalMembershipId, {
      kind: "membership",
      externalId: "workos_membership_a",
    });
    accounts.linkMembership(invitationMembershipId, {
      kind: "invitation",
      externalId: "workos_invitation_a",
    });
    port.organizationMembers.set(externalOrganizationId, [{
      externalMembershipId: "workos_membership_a",
      externalSubject,
      email: "member@example.test",
      displayName: "Member Example",
      role: "tenant-owner",
      status: "active",
    }]);
    port.organizationInvitations.set(externalOrganizationId, [{
      externalInvitationId: "workos_invitation_a",
      email: "invitee@example.test",
      role: "member",
      status: "pending",
    }]);

    await expect(gateway.listTenantMembers(tenantA)).resolves.toEqual([
      {
        kind: "membership",
        membershipId: internalMembershipId,
        userId: internalUserId,
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

  it("omits tenant directory entries with unknown provider roles", async () => {
    const { gateway, port, orgs } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    port.organizationMembers.set(externalOrganizationId, [{
      externalMembershipId: "workos_membership_unknown",
      externalSubject,
      email: "member@example.test",
      displayName: null,
      role: "super-admin",
      status: "active",
    }]);

    await expect(gateway.listTenantMembers(tenantA)).resolves.toEqual([]);
  });

  it("starts login from an explicit request context", async () => {
    const { gateway } = createGateway();

    const url = await gateway.startLogin({
      tenantId: null,
      returnPath: "/assessment",
      requestUrl: "https://tenant.example.test/auth/login",
    });

    expect(url.searchParams.get("return_path")).toBe("/assessment");
  });

  it("maps invitations by invitation ref and revokes them through the invitation port", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkMembership(internalMembershipId, {
      kind: "invitation",
      externalId: port.invitationExternalId,
    });
    port.organizationInvitations.set(externalOrganizationId, [{
      externalInvitationId: port.invitationExternalId,
      email: "invitee@example.test",
      role: "tenant-admin",
      status: "pending",
    }]);
    const invitation: Invitation = {
      email: "invitee@example.test",
      tenantId: tenantA,
      role: "tenant_admin",
      invitedBy: internalUserId,
    };

    const membershipId = await gateway.invite(invitation);

    expect(membershipId).toBe(internalMembershipId);
    expect(port.invitations).toEqual([
      {
        email: "invitee@example.test",
        externalOrganizationId,
        role: "tenant-admin",
      },
    ]);
    await gateway.removeMembership(membershipId);
    expect(port.revokedInvitations).toEqual([port.invitationExternalId]);
    expect(port.deletedMemberships).toEqual([]);
  });

  it("throws when asked to remove an unknown membership", async () => {
    const { gateway, port } = createGateway();

    await expect(
      gateway.removeMembership("membership_unknown" as MembershipId),
    ).rejects.toThrow(/revoke/i);
    expect(port.deletedMemberships).toEqual([]);
    expect(port.revokedInvitations).toEqual([]);
  });

  it("replaces a pending invitation when its role changes", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkMembership(internalMembershipId, {
      kind: "invitation",
      externalId: port.invitationExternalId,
    });
    port.organizationInvitations.set(externalOrganizationId, [{
      externalInvitationId: port.invitationExternalId,
      email: "invitee@example.test",
      role: "member",
      status: "pending",
    }]);

    await gateway.setRole(internalMembershipId, "tenant_admin");

    expect(port.replacedInvitations).toEqual([{
      externalOrganizationId,
      externalInvitationId: port.invitationExternalId,
      role: "tenant-admin",
    }]);
    await gateway.removeMembership(internalMembershipId);
    expect(port.revokedInvitations).toEqual([`${port.invitationExternalId}_replacement`]);
    expect(port.updatedMembershipRoles).toEqual([]);
  });

  it("refuses to remove a membership whose provider subject does not match its stored owner", async () => {
    const { gateway, port, orgs, accounts } = createGateway();
    orgs.link(tenantA, externalOrganizationId);
    accounts.linkUser(internalUserId, externalSubject);
    accounts.linkMembership(internalMembershipId, {
      kind: "membership",
      externalId: "workos_membership_a",
    });
    port.organizationMembers.set(externalOrganizationId, [{
      externalMembershipId: "workos_membership_a",
      externalSubject: "workos_user_other",
      email: "other@example.test",
      displayName: null,
      role: "member",
      status: "active",
    }]);

    await expect(gateway.removeMembership(internalMembershipId)).rejects.toThrow(
      "membership ownership conflict",
    );
    expect(port.deletedMemberships).toEqual([]);
  });

});
