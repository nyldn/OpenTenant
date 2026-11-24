import { secretFreeIdentityPort } from "../provider-errors";
/**
 * WorkOS implementation of the IdentityGateway contract (spec 8.1).
 *
 * All translation between WorkOS objects and platform-internal identifiers
 * happens here. Nothing outside src/workos/ sees a WorkOS identifier.
 */
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
import type {
  AccountLinkStore,
  TenantOrgResolver,
} from "../provider-store";
import type { WorkOSPort } from "./port";

export type { AccountLinkStore, ExternalMembershipRef, TenantOrgResolver } from "../provider-store";

/** Explicit, reviewed mapping between WorkOS role slugs and application roles. */
const ROLE_FROM_WORKOS: Readonly<Record<string, TenantRole>> = {
  "tenant-owner": "tenant_owner",
  "tenant-admin": "tenant_admin",
  // WorkOS environments ship a default "admin" slug; reviewed 2026-07-16.
  admin: "tenant_admin",
  member: "tenant_member",
};
const WORKOS_ROLE_FROM_APP: Readonly<Record<TenantRole, string>> = {
  tenant_owner: "tenant-owner",
  tenant_admin: "tenant-admin",
  tenant_member: "member",
};

function roleFromWorkOS(slug: string): TenantRole | null {
  // Unknown provider roles fail closed: mapping drift must never grant
  // access, so an unrecognized slug yields no role at all.
  return ROLE_FROM_WORKOS[slug] ?? null;
}

/**
 * Module permission slugs are dotted lowercase identifiers ("brain.promote").
 * Provider claims in any other shape (widget grants, typos, injected values)
 * are dropped rather than propagated into module authorization.
 */
const MODULE_PERMISSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}(\.[a-z0-9][a-z0-9_-]{0,63})+$/;

function modulePermissionsFrom(claims: ReadonlyArray<string>): string[] {
  return claims.filter((slug) => MODULE_PERMISSION_PATTERN.test(slug));
}

export class WorkOSIdentityGateway implements IdentityGateway {
  constructor(
    private readonly port: WorkOSPort,
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

    // Impersonation is out of scope for the first release (spec 8.2): reject
    // provider impersonation sessions until controls and auditing exist.
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
      activeTenantId = await this.orgs.tenantForExternalOrganization(session.externalOrganizationId);
      if (activeTenantId === null) {
        // Provider org exists but maps to no tenant: fail closed.
        return { status: "tenant_mismatch", userId };
      }
      const memberships = await this.port.listMembershipsForUser(session.externalSubject);
      const matching = memberships.filter(
        (m) => m.externalOrganizationId === session.externalOrganizationId
          && m.externalSubject === session.externalSubject,
      );
      const active = matching[0];
      if (matching.length !== 1 || active?.status !== "active") return { status: "invalid" };
      activeRole = roleFromWorkOS(active.role);
      // A membership whose role we cannot map is a configuration fault, not
      // an access grant.
      if (activeRole === null) return { status: "invalid" };
      // Permission claims count only once the membership itself validated;
      // an org-less session carries no module grants.
      permissions = modulePermissionsFrom(session.permissions);
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
    // The control plane, not WorkOS, is the read model for cross-tenant
    // membership listings; the adapter surfaces provider state normalized.
    const externalSubject = await this.externalSubjectFor(userId);
    if (externalSubject === null) return [];
    const records = await this.port.listMembershipsForUser(externalSubject);
    const memberships: TenantMembership[] = [];
    for (const record of records) {
      if (record.externalSubject !== externalSubject) continue;
      const tenantId = await this.orgs.tenantForExternalOrganization(record.externalOrganizationId);
      if (tenantId === null) continue; // unmapped provider orgs are invisible
      const role = roleFromWorkOS(record.role);
      if (role === null) continue; // unmappable roles confer nothing
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
    const externalOrganizationId = await this.orgs.externalOrganizationForTenant(tenantId);
    if (externalOrganizationId === null) return [];

    const members: TenantMember[] = [];
    for (const record of await this.port.listMembershipsForOrganization(externalOrganizationId)) {
      const role = roleFromWorkOS(record.role);
      if (role === null) continue;
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

    for (const record of await this.port.listInvitationsForOrganization(externalOrganizationId)) {
      if (record.status !== "pending") continue;
      const role = roleFromWorkOS(record.role);
      if (role === null) continue;
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
    const externalOrganizationId = await this.orgs.externalOrganizationForTenant(invitation.tenantId);
    if (externalOrganizationId === null) {
      throw new Error(`tenant ${invitation.tenantId} has no identity organization`);
    }
    const externalInvitationId = await this.port.sendInvitation(
      invitation.email,
      externalOrganizationId,
      WORKOS_ROLE_FROM_APP[invitation.role],
    );
    return this.accounts.membershipIdForExternalRef(
      { kind: "invitation", externalId: externalInvitationId },
      // The invited user has no internal identity until acceptance.
      { tenantId: invitation.tenantId, userId: null },
    );
  }

  async removeMembership(membershipId: MembershipId): Promise<void> {
    const ref = await this.accounts.externalRefForMembershipId(membershipId);
    if (ref === null) {
      // Unknown mapping must fail loudly: silently succeeding could leave
      // provider-side access active with no operator signal.
      throw new Error("unknown membership: cannot revoke provider access");
    }
    const externalOrganizationId = await this.orgs.externalOrganizationForTenant(ref.tenantId);
    if (externalOrganizationId === null) throw new Error("membership ownership conflict");
    if (ref.kind === "invitation") {
      const invitations = await this.port.listInvitationsForOrganization(externalOrganizationId);
      const target = invitations.find(
        (invitation) => invitation.externalInvitationId === ref.externalId
          && invitation.status === "pending",
      );
      if (!target) throw new Error("membership ownership conflict");
      await this.port.revokeInvitation(ref.externalId);
    } else {
      const externalSubject = await this.accounts.externalSubjectForUserId(ref.userId);
      if (externalSubject === null) throw new Error("membership ownership conflict");
      const members = await this.port.listMembershipsForOrganization(externalOrganizationId);
      const target = members.find(
        (member) => member.externalMembershipId === ref.externalId
          && member.externalSubject === externalSubject,
      );
      if (!target) throw new Error("membership ownership conflict");
      await this.port.deleteMembership(ref.externalId);
    }
  }

  async setRole(membershipId: MembershipId, role: TenantRole): Promise<void> {
    const ref = await this.accounts.externalRefForMembershipId(membershipId);
    if (ref === null) throw new Error("unknown membership");
    const externalOrganizationId = await this.orgs.externalOrganizationForTenant(ref.tenantId);
    if (externalOrganizationId === null) throw new Error("membership ownership conflict");
    if (ref.kind === "invitation") {
      const invitations = await this.port.listInvitationsForOrganization(externalOrganizationId);
      const target = invitations.find(
        (invitation) => invitation.externalInvitationId === ref.externalId
          && invitation.status === "pending",
      );
      if (!target) throw new Error("membership ownership conflict");
      const replacementId = await this.port.replaceInvitationRole(
        externalOrganizationId,
        ref.externalId,
        WORKOS_ROLE_FROM_APP[role],
      );
      await this.accounts.replaceExternalRefForMembershipId(
        membershipId,
        { kind: "invitation", externalId: ref.externalId },
        { kind: "invitation", externalId: replacementId },
      );
      return;
    }
    const externalSubject = await this.accounts.externalSubjectForUserId(ref.userId);
    if (externalSubject === null) throw new Error("membership ownership conflict");
    const members = await this.port.listMembershipsForOrganization(externalOrganizationId);
    const target = members.find(
      (member) => member.externalMembershipId === ref.externalId
        && member.externalSubject === externalSubject,
    );
    if (!target) throw new Error("membership ownership conflict");
    await this.port.updateMembershipRole(ref.externalId, WORKOS_ROLE_FROM_APP[role]);
  }

  async startLogin(request: LoginRequest): Promise<URL> {
    const externalOrganizationId =
      request.tenantId === null ? null : await this.orgs.externalOrganizationForTenant(request.tenantId);
    return this.port.authorizationUrl(externalOrganizationId, request.returnPath, request.stateNonce);
  }

  async logout(sessionToken: string): Promise<void> {
    await this.port.revokeSession(sessionToken);
  }

  private async externalSubjectFor(userId: UserId): Promise<string | null> {
    return this.accounts.externalSubjectForUserId(userId);
  }
}
