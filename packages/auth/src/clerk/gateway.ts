import { secretFreeIdentityPort } from "../provider-errors";
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
} from "../identity";
import { safeReturnPath } from "../return-path";
import type {
  AccountLinkStore,
  TenantOrgResolver,
} from "../provider-store";
import type { ClerkPort } from "./port";

const ROLE_FROM_CLERK: Readonly<Record<string, TenantRole>> = {
  "org:tenant_owner": "tenant_owner",
  "org:tenant_admin": "tenant_admin",
  "org:member": "tenant_member",
};

const CLERK_ROLE_FROM_APP: Readonly<Record<TenantRole, string>> = {
  tenant_owner: "org:tenant_owner",
  tenant_admin: "org:tenant_admin",
  tenant_member: "org:member",
};

const PERMISSION_FROM_CLERK: Readonly<Record<string, string>> = {
  "org:brain:promote": "brain.promote",
  "org:brand:proposal:upload": "brand.proposal.upload",
  "org:brand:proposal:review": "brand.proposal.review",
  "org:brand:proposal:edit": "brand.proposal.edit",
  "org:brand:proposal:apply": "brand.proposal.apply",
  "org:brand:proposal:supersede": "brand.proposal.supersede",
  "org:brand:proposal:revoke": "brand.proposal.revoke",
};

export function roleFromClerk(role: string): TenantRole | null {
  return ROLE_FROM_CLERK[role] ?? null;
}

export function modulePermissionsFromClerk(permissions: ReadonlyArray<string>): string[] {
  return permissions.flatMap((permission) => {
    const mapped = PERMISSION_FROM_CLERK[permission];
    return mapped ? [mapped] : [];
  });
}

export class ClerkIdentityGateway implements IdentityGateway {
  constructor(
    private readonly port: ClerkPort,
    private readonly orgs: TenantOrgResolver,
    private readonly accounts: AccountLinkStore,
  ) {
    this.port = secretFreeIdentityPort(port);
  }

  async validateSession(
    sessionToken: string,
    expectedTenantId: TenantId | null,
  ): Promise<SessionValidationResult> {
    const result = await this.port.authenticateSession(sessionToken);
    if (result.status === "expired") return { status: "expired" };
    if (result.status === "invalid") return { status: "invalid" };
    const { session } = result;
    if (session.impersonated) return { status: "invalid" };

    const userId = await this.accounts.userIdForExternalSubject(
      session.externalSubject,
      session.email,
      session.displayName,
    );
    let activeTenantId: TenantId | null = null;
    let activeRole: TenantRole | null = null;
    let permissions: string[] = [];

    if (session.externalOrganizationId !== null) {
      activeTenantId = await this.orgs.tenantForExternalOrganization(
        session.externalOrganizationId,
      );
      if (activeTenantId === null) return { status: "tenant_mismatch", userId };
      if (session.role === null) return { status: "invalid" };
      const matchingMemberships = (await this.port.listMembershipsForUser(session.externalSubject)).filter(
        (membership) => membership.externalOrganizationId === session.externalOrganizationId
          && membership.externalSubject === session.externalSubject,
      );
      const activeMembership = matchingMemberships[0];
      if (matchingMemberships.length !== 1
        || activeMembership?.status !== "active"
        || activeMembership.role !== session.role) {
        return { status: "invalid" };
      }
      activeRole = roleFromClerk(session.role);
      if (activeRole === null) return { status: "invalid" };
      permissions = modulePermissionsFromClerk(session.permissions);
    }

    if (expectedTenantId !== null && activeTenantId !== expectedTenantId) {
      return { status: "tenant_mismatch", userId };
    }

    return {
      status: "valid",
      session: {
        userId,
        email: session.email,
        displayName: session.displayName,
        activeTenantId,
        activeRole,
        permissions,
        isPlatformAdmin: await this.accounts.isPlatformAdmin(userId),
        expiresAt: session.expiresAt,
      } satisfies IdentitySession,
    };
  }

  async listMemberships(userId: UserId): Promise<TenantMembership[]> {
    const externalSubject = await this.accounts.externalSubjectForUserId(userId);
    if (externalSubject === null) return [];
    const memberships: TenantMembership[] = [];
    for (const record of await this.port.listMembershipsForUser(externalSubject)) {
      if (record.externalSubject !== externalSubject) continue;
      const tenantId = await this.orgs.tenantForExternalOrganization(record.externalOrganizationId);
      const role = roleFromClerk(record.role);
      if (tenantId === null || role === null) continue;
      memberships.push({
        membershipId: await this.accounts.membershipIdForExternalRef(
          { kind: "membership", externalId: record.externalMembershipId },
          { tenantId, userId },
        ),
        userId,
        tenantId,
        role,
        status: record.status === "active" ? "active" : record.status === "pending" ? "invited" : "suspended",
      });
    }
    return memberships;
  }

  async listTenantMembers(tenantId: TenantId): Promise<TenantMember[]> {
    const organizationId = await this.orgs.externalOrganizationForTenant(tenantId);
    if (organizationId === null) return [];
    const members: TenantMember[] = [];
    for (const record of await this.port.listMembershipsForOrganization(organizationId)) {
      const role = roleFromClerk(record.role);
      if (role === null || record.externalOrganizationId !== organizationId) continue;
      const userId = await this.accounts.userIdForExternalSubject(
        record.externalSubject,
        record.email,
        record.displayName,
      );
      members.push({
        kind: "membership",
        membershipId: await this.accounts.membershipIdForExternalRef(
          { kind: "membership", externalId: record.externalMembershipId },
          { tenantId, userId },
        ),
        userId,
        tenantId,
        email: record.email,
        displayName: record.displayName,
        role,
        status: record.status === "active" ? "active" : record.status === "pending" ? "invited" : "suspended",
      });
    }
    for (const record of await this.port.listInvitationsForOrganization(organizationId)) {
      const role = roleFromClerk(record.role);
      if (record.status !== "pending" || role === null) continue;
      members.push({
        kind: "invitation",
        membershipId: await this.accounts.membershipIdForExternalRef(
          { kind: "invitation", externalId: record.externalInvitationId },
          { tenantId, userId: null },
        ),
        userId: null,
        tenantId,
        email: record.email,
        displayName: null,
        role,
        status: "invited",
      });
    }
    return members;
  }

  async invite(invitation: Invitation): Promise<MembershipId> {
    if (invitation.role !== "tenant_admin" && invitation.role !== "tenant_member") {
      throw new Error("Role is not invitable through the normal path");
    }
    const organizationId = await this.orgs.externalOrganizationForTenant(invitation.tenantId);
    if (organizationId === null) throw new Error("tenant has no identity organization");
    const externalId = await this.port.sendInvitation(
      invitation.email,
      organizationId,
      CLERK_ROLE_FROM_APP[invitation.role],
    );
    return this.accounts.membershipIdForExternalRef(
      { kind: "invitation", externalId },
      { tenantId: invitation.tenantId, userId: null },
    );
  }

  async removeMembership(membershipId: MembershipId): Promise<void> {
    const ref = await this.ownedRef(membershipId);
    const organizationId = await this.organizationFor(ref.tenantId);
    if (ref.kind === "invitation") {
      const targets = (await this.port.listInvitationsForOrganization(organizationId)).filter(
        (invitation) => invitation.externalInvitationId === ref.externalId
          && invitation.status === "pending",
      );
      if (targets.length !== 1) throw new Error("membership ownership conflict");
      await this.port.revokeInvitation(organizationId, ref.externalId);
      return;
    }
    const subject = await this.subjectFor(ref.userId);
    await this.assertMembershipOwnership(organizationId, subject, ref.externalId);
    await this.port.deleteMembership(organizationId, subject);
  }

  async setRole(membershipId: MembershipId, role: TenantRole): Promise<void> {
    const ref = await this.ownedRef(membershipId);
    const organizationId = await this.organizationFor(ref.tenantId);
    if (ref.kind === "invitation") {
      const targets = (await this.port.listInvitationsForOrganization(organizationId)).filter(
        (invitation) => invitation.externalInvitationId === ref.externalId
          && invitation.status === "pending",
      );
      if (targets.length !== 1) throw new Error("membership ownership conflict");
      const replacementId = await this.port.replaceInvitationRole(
        organizationId,
        ref.externalId,
        CLERK_ROLE_FROM_APP[role],
      );
      await this.accounts.replaceExternalRefForMembershipId(
        membershipId,
        { kind: "invitation", externalId: ref.externalId },
        { kind: "invitation", externalId: replacementId },
      );
      return;
    }
    const subject = await this.subjectFor(ref.userId);
    await this.assertMembershipOwnership(organizationId, subject, ref.externalId);
    await this.port.updateMembershipRole(organizationId, subject, CLERK_ROLE_FROM_APP[role]);
  }

  async startLogin(request: LoginRequest): Promise<URL> {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.requestUrl);
    } catch {
      throw new Error("invalid Clerk login request");
    }
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
      throw new Error("invalid Clerk login request");
    }
    const returnPath = safeReturnPath(request.returnPath);
    const target = await this.port.authorizationUrl(returnPath, requestUrl.toString());
    if (target.origin !== requestUrl.origin
      || target.pathname !== "/sign-in"
      || target.username !== ""
      || target.password !== ""
      || target.hash !== "") {
      throw new Error("invalid Clerk login target");
    }
    return target;
  }

  async logout(sessionToken: string): Promise<void> {
    await this.port.revokeSession(sessionToken);
  }

  private async ownedRef(membershipId: MembershipId) {
    const ref = await this.accounts.externalRefForMembershipId(membershipId);
    if (ref === null) throw new Error("unknown membership: cannot mutate provider access");
    return ref;
  }

  private async organizationFor(tenantId: TenantId): Promise<string> {
    const organizationId = await this.orgs.externalOrganizationForTenant(tenantId);
    if (organizationId === null) throw new Error("membership ownership conflict");
    return organizationId;
  }

  private async subjectFor(internalUserId: UserId): Promise<string> {
    const subject = await this.accounts.externalSubjectForUserId(internalUserId);
    if (subject === null) throw new Error("membership ownership conflict");
    return subject;
  }

  private async assertMembershipOwnership(
    organizationId: string,
    subject: string,
    externalMembershipId: string,
  ): Promise<void> {
    const targets = (await this.port.listMembershipsForOrganization(organizationId)).filter(
      (membership) => membership.externalOrganizationId === organizationId
        && membership.externalSubject === subject,
    );
    if (targets.length !== 1 || targets[0]?.externalMembershipId !== externalMembershipId) {
      throw new Error("membership ownership conflict");
    }
  }
}

export type { ClerkPort } from "./port";
