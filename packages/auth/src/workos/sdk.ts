/**
 * The only application source file that imports the WorkOS SDK (spec 8.1).
 * Server-only: reads WORKOS_API_KEY, WORKOS_CLIENT_ID, and
 * WORKOS_COOKIE_PASSWORD from the environment.
 */
import { WorkOS } from "@workos-inc/node";
import type {
  WorkOSInvitationRecord,
  WorkOSMembershipRecord,
  WorkOSOrgMemberRecord,
  WorkOSPort,
  WorkOSSessionResult,
} from "./port";

export interface WorkOSSdkConfig {
  apiKey: string;
  clientId: string;
  /** Password for unsealing AuthKit session cookies. */
  cookiePassword: string;
  /** AuthKit redirect URI registered in the WorkOS dashboard. */
  redirectUri: string;
}

export function workOSConfigFromEnv(env: NodeJS.ProcessEnv): WorkOSSdkConfig {
  const apiKey = env.WORKOS_API_KEY;
  const clientId = env.WORKOS_CLIENT_ID;
  const cookiePassword = env.WORKOS_COOKIE_PASSWORD;
  const redirectUri = env.WORKOS_REDIRECT_URI;
  if (!apiKey || !clientId || !cookiePassword || !redirectUri) {
    throw new Error(
      "Missing WorkOS configuration: WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD, WORKOS_REDIRECT_URI",
    );
  }
  return { apiKey, clientId, cookiePassword, redirectUri };
}

/**
 * WorkOS list endpoints return one page (10 records by default). Membership
 * removal, role changes, and session validation all search these lists, so
 * a truncated page silently hides members past the first. A hard ceiling
 * keeps a runaway organization from exhausting memory.
 */
const MAX_LISTED_RECORDS = 10_000;

async function allRecords<T>(list: { autoPagination(): Promise<T[]> }): Promise<T[]> {
  const records = await list.autoPagination();
  if (records.length > MAX_LISTED_RECORDS) throw new Error("WorkOS list exceeded record limit");
  return records;
}

export function createWorkOSPort(config: WorkOSSdkConfig): WorkOSPort {
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });

  return {
    async createOrganization(name): Promise<string> {
      const organization = await workos.organizations.createOrganization({ name });
      const externalOrganizationId = organization.id;
      if (
        typeof externalOrganizationId !== "string"
        || !/^[A-Za-z0-9_-]{1,255}$/.test(externalOrganizationId)
      ) {
        throw new Error("WorkOS returned an invalid organization response");
      }
      return externalOrganizationId;
    },

    async deleteOrganization(externalOrganizationId): Promise<void> {
      await workos.organizations.deleteOrganization(externalOrganizationId);
    },

    async authenticateSession(sessionToken): Promise<WorkOSSessionResult> {
      const session = workos.userManagement.loadSealedSession({
        sessionData: sessionToken,
        cookiePassword: config.cookiePassword,
      });
      const result = await session.authenticate();
      if (!result.authenticated) {
        return result.reason === "invalid_session_cookie"
          ? { status: "invalid" }
          : { status: "expired" };
      }
      return {
        status: "authenticated",
        session: {
          externalSubject: result.user.id,
          email: result.user.email,
          displayName:
            [result.user.firstName, result.user.lastName].filter(Boolean).join(" ") || null,
          externalOrganizationId: result.organizationId ?? null,
          impersonated: Boolean(result.impersonator),
          permissions: result.permissions ?? [],
          // AuthKit access tokens live ~5 minutes; refresh is handled at the
          // session middleware layer in a later work package.
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      };
    },

    async generateAdminPortalLink(externalOrganizationId, intent): Promise<URL> {
      const { link } = await workos.adminPortal.generateLink({
        organization: externalOrganizationId,
        intent,
      });
      return new URL(link);
    },

    async listMembershipsForUser(externalSubject): Promise<WorkOSMembershipRecord[]> {
      const memberships = await allRecords(await workos.userManagement.listOrganizationMemberships({
        userId: externalSubject,
        statuses: ["active", "pending", "inactive"],
      }));
      return memberships.map((m) => ({
        externalMembershipId: m.id,
        externalSubject: m.userId,
        externalOrganizationId: m.organizationId,
        role: m.role.slug,
        status: m.status === "active" ? "active" : m.status === "pending" ? "pending" : "inactive",
      }));
    },

    async listMembershipsForOrganization(externalOrganizationId): Promise<WorkOSOrgMemberRecord[]> {
      const memberships = await allRecords(await workos.userManagement.listOrganizationMemberships({
        organizationId: externalOrganizationId,
        statuses: ["active", "pending", "inactive"],
      }));
      const members: WorkOSOrgMemberRecord[] = [];
      for (const m of memberships) {
        const user = await workos.userManagement.getUser(m.userId);
        members.push({
          externalMembershipId: m.id,
          externalSubject: m.userId,
          email: user.email,
          displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
          role: m.role.slug,
          status: m.status === "active" ? "active" : m.status === "pending" ? "pending" : "inactive",
        });
      }
      return members;
    },

    async listInvitationsForOrganization(externalOrganizationId): Promise<WorkOSInvitationRecord[]> {
      const invitations = await allRecords(await workos.userManagement.listInvitations({
        organizationId: externalOrganizationId,
      }));
      return invitations.map((invitation) => ({
        externalInvitationId: invitation.id,
        email: invitation.email,
        role: invitation.roleSlug ?? "",
        status: invitation.state,
      }));
    },

    async sendInvitation(email, externalOrganizationId, role): Promise<string> {
      try {
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await allRecords(await workos.userManagement.listInvitations({
          organizationId: externalOrganizationId,
          email: normalizedEmail,
        }));
        const pending = existing.find(
          (invitation) => invitation.state === "pending"
            && invitation.email.trim().toLowerCase() === normalizedEmail,
        );
        if (pending) {
          if (pending.roleSlug !== role) throw new Error("pending invitation role mismatch");
          return pending.id;
        }
        const invitation = await workos.userManagement.sendInvitation({
          email: normalizedEmail,
          organizationId: externalOrganizationId,
          roleSlug: role,
        });
        return invitation.id;
      } catch {
        throw new Error("WorkOS invitation operation failed");
      }
    },

    async replaceInvitationRole(
      externalOrganizationId,
      externalInvitationId,
      role,
    ): Promise<string> {
      const invitation = await workos.userManagement.getInvitation(externalInvitationId);
      if (
        invitation.organizationId !== externalOrganizationId
        || invitation.state !== "pending"
      ) {
        throw new Error("WorkOS invitation ownership mismatch");
      }
      const normalizedEmail = invitation.email.trim().toLowerCase();
      await workos.userManagement.revokeInvitation(externalInvitationId);
      const replacement = await workos.userManagement.sendInvitation({
        email: normalizedEmail,
        organizationId: externalOrganizationId,
        roleSlug: role,
      });
      return replacement.id;
    },

    async revokeInvitation(externalInvitationId): Promise<void> {
      await workos.userManagement.revokeInvitation(externalInvitationId);
    },

    async deleteMembership(externalMembershipId): Promise<void> {
      await workos.userManagement.deleteOrganizationMembership(externalMembershipId);
    },

    async updateMembershipRole(externalMembershipId, role): Promise<void> {
      await workos.userManagement.updateOrganizationMembership(externalMembershipId, {
        roleSlug: role,
      });
    },

    async authorizationUrl(externalOrganizationId, returnPath, stateNonce): Promise<URL> {
      const url = workos.userManagement.getAuthorizationUrl({
        provider: "authkit",
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state: JSON.stringify(stateNonce ? { returnPath, nonce: stateNonce } : { returnPath }),
        ...(externalOrganizationId ? { organizationId: externalOrganizationId } : {}),
      });
      return new URL(url);
    },

    async revokeSession(sessionToken): Promise<void> {
      const session = workos.userManagement.loadSealedSession({
        sessionData: sessionToken,
        cookiePassword: config.cookiePassword,
      });
      const result = await session.authenticate();
      if (result.authenticated) {
        await workos.userManagement.revokeSession({ sessionId: result.sessionId });
      }
      // An already-invalid session needs no revocation; logout is idempotent.
    },
  };
}

/**
 * OAuth callback exchange: code -> sealed session cookie payload. Lives at
 * the SDK boundary because it is provider bootstrap, not an IdentityGateway
 * operation; nothing outside the auth routes should call it.
 */
export async function exchangeCodeForSealedSession(
  config: WorkOSSdkConfig,
  code: string,
): Promise<string> {
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
  const result = await workos.userManagement.authenticateWithCode({
    clientId: config.clientId,
    code,
    session: { sealSession: true, cookiePassword: config.cookiePassword },
  });
  if (!result.sealedSession) {
    throw new Error("WorkOS returned no sealed session");
  }
  return result.sealedSession;
}
