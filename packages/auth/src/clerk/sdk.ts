import type { ClerkSdkConfig } from "./config";
export { clerkConfigFromEnv, type ClerkSdkConfig } from "./config";
/** Server-only Clerk Backend API boundary. */
import {
  createClerkClient,
  verifyToken,
  type ClerkClient,
} from "@clerk/backend";
import { TokenVerificationErrorReason } from "@clerk/backend/errors";
import type {
  ClerkInvitationRecord,
  ClerkMembershipRecord,
  ClerkOrgMemberRecord,
  ClerkPort,
  ClerkSessionResult,
} from "./port";

const PAGE_SIZE = 100;
const MAX_RECORDS = 10_000;
const ROLE_PATTERN = /^org:[a-z0-9][a-z0-9_-]{0,127}$/;
const PERMISSION_PATTERN = /^org:[a-z0-9][a-z0-9_-]{0,63}:[a-z0-9][a-z0-9_-]{0,63}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validIdentifier(value: unknown): value is string {
  return nonEmptyString(value) && value.length <= 512;
}


async function fixedFailure<T>(message: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(message);
  }
}

async function allPages(
  operation: (offset: number) => Promise<unknown>,
): Promise<unknown[]> {
  const records: unknown[] = [];
  const resourceIds = new Set<string>();
  let expectedTotal: number | null = null;
  while (true) {
    const response = await operation(records.length);
    if (!isRecord(response)
      || !Array.isArray(response.data)
      || !Number.isInteger(response.totalCount)
      || (response.totalCount as number) < 0
      || (response.totalCount as number) > MAX_RECORDS) {
      throw new Error("invalid pagination response");
    }
    const total = response.totalCount as number;
    if (expectedTotal !== null && total !== expectedTotal) {
      throw new Error("inconsistent pagination response");
    }
    expectedTotal = total;
    if (records.length + response.data.length > total
      || records.length + response.data.length > MAX_RECORDS) {
      throw new Error("invalid pagination response");
    }
    for (const record of response.data) {
      if (!isRecord(record) || !validIdentifier(record.id) || resourceIds.has(record.id)) {
        throw new Error("invalid pagination response");
      }
      resourceIds.add(record.id);
    }
    records.push(...response.data);
    if (records.length === total) return records;
    if (response.data.length === 0) throw new Error("incomplete pagination response");
  }
}

function normalizeMembership(value: unknown): ClerkMembershipRecord | null {
  if (!isRecord(value)
    || !validIdentifier(value.id)
    || !nonEmptyString(value.role)
    || !ROLE_PATTERN.test(value.role)
    || !Array.isArray(value.permissions)
    || !value.permissions.every((permission) => nonEmptyString(permission)
      && PERMISSION_PATTERN.test(permission))
    || !isRecord(value.organization)
    || !validIdentifier(value.organization.id)
    || !isRecord(value.publicUserData)
    || !validIdentifier(value.publicUserData.userId)) {
    return null;
  }
  return {
    externalMembershipId: value.id,
    externalSubject: value.publicUserData.userId,
    externalOrganizationId: value.organization.id,
    role: value.role,
    status: "active",
  };
}

function normalizeOrgMember(value: unknown): ClerkOrgMemberRecord | null {
  const membership = normalizeMembership(value);
  if (membership === null || !isRecord(value) || !isRecord(value.publicUserData)) return null;
  const data = value.publicUserData;
  if (!nonEmptyString(data.identifier)
    || data.identifier.length > 254
    || !EMAIL_PATTERN.test(data.identifier)) return null;
  const first = typeof data.firstName === "string" ? data.firstName.trim() : "";
  const last = typeof data.lastName === "string" ? data.lastName.trim() : "";
  return {
    ...membership,
    email: data.identifier.trim().toLowerCase(),
    displayName: [first, last].filter(Boolean).join(" ") || null,
  };
}

function normalizeInvitation(value: unknown, expectedOrganizationId: string): ClerkInvitationRecord | null {
  if (!isRecord(value)) return null;
  const email = typeof value.emailAddress === "string"
    ? value.emailAddress.trim().toLowerCase()
    : "";
  if (!validIdentifier(value.id)
    || email.length > 254
    || !EMAIL_PATTERN.test(email)
    || !nonEmptyString(value.role)
    || !ROLE_PATTERN.test(value.role)
    || value.organizationId !== expectedOrganizationId
    || !["pending", "accepted", "revoked", "expired"].includes(String(value.status))) {
    return null;
  }
  return {
    externalInvitationId: value.id,
    email,
    role: value.role,
    status: value.status as ClerkInvitationRecord["status"],
  };
}

function versionTwoPermissions(payload: Record<string, unknown>, org: Record<string, unknown>): string[] | null {
  const featureClaim = payload.fea;
  const permissionClaim = org.per;
  const mapClaim = org.fpm;
  if (permissionClaim === undefined && mapClaim === undefined) return [];
  if (!nonEmptyString(featureClaim) || !nonEmptyString(permissionClaim) || !nonEmptyString(mapClaim)) {
    return null;
  }
  const features: string[] = [];
  for (const item of featureClaim.split(",")) {
    const [scope, ...rest] = item.trim().split(":");
    const feature = rest.join(":");
    if (!scope || !feature || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(feature)) return null;
    if (scope === "o" || scope === "ou" || scope === "uo") features.push(feature);
  }
  const permissions = permissionClaim.split(",").map((item) => item.trim());
  const masks = mapClaim.split(",").map((item) => item.trim());
  if (features.length !== masks.length
    || permissions.some((item) => !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item))) return null;

  const result: string[] = [];
  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const maskValue = masks[featureIndex];
    if (!maskValue || !/^\d+$/.test(maskValue)) return null;
    const mask = BigInt(maskValue);
    for (let permissionIndex = 0; permissionIndex < permissions.length; permissionIndex += 1) {
      if ((mask & (1n << BigInt(permissionIndex))) !== 0n) {
        result.push(`org:${features[featureIndex]}:${permissions[permissionIndex]}`);
      }
    }
  }
  return result;
}

function organizationClaims(payload: Record<string, unknown>): {
  organizationId: string | null;
  role: string | null;
  permissions: string[];
} | null {
  if (payload.v === 2) {
    if (payload.o === undefined) return { organizationId: null, role: null, permissions: [] };
    if (!isRecord(payload.o) || !validIdentifier(payload.o.id) || !nonEmptyString(payload.o.rol)) {
      return null;
    }
    const permissions = versionTwoPermissions(payload, payload.o);
    if (permissions === null || payload.o.rol.includes(":")) return null;
    return {
      organizationId: payload.o.id,
      role: `org:${payload.o.rol}`,
      permissions,
    };
  }
  if (payload.v !== undefined) return null;
  if (payload.org_id === undefined) {
    if (payload.org_role !== undefined || payload.org_permissions !== undefined) return null;
    return { organizationId: null, role: null, permissions: [] };
  }
  const permissions = payload.org_permissions ?? [];
  if (!validIdentifier(payload.org_id)
    || !nonEmptyString(payload.org_role)
    || !ROLE_PATTERN.test(payload.org_role)
    || !Array.isArray(permissions)
    || !permissions.every((permission) => nonEmptyString(permission)
      && PERMISSION_PATTERN.test(permission))) {
    return null;
  }
  return {
    organizationId: payload.org_id,
    role: payload.org_role,
    permissions: [...permissions],
  };
}

async function authenticate(
  client: ClerkClient,
  config: ClerkSdkConfig,
  sessionToken: string,
): Promise<ClerkSessionResult> {
  let payload: unknown;
  try {
    payload = await verifyToken(sessionToken, {
      secretKey: config.secretKey,
      authorizedParties: config.authorizedParties,
      audience: config.audience,
    });
  } catch (error) {
    return isRecord(error) && error.reason === TokenVerificationErrorReason.TokenExpired
      ? { status: "expired" }
      : { status: "invalid" };
  }
  if (!isRecord(payload)
    || payload.iss !== config.issuer
    || !validIdentifier(payload.sub)
    || !validIdentifier(payload.sid)
    || typeof payload.exp !== "number"
    || !Number.isFinite(payload.exp)) {
    return { status: "invalid" };
  }
  const tokenExpiresAt = payload.exp * 1_000;
  if (!Number.isSafeInteger(tokenExpiresAt)) return { status: "invalid" };
  if (tokenExpiresAt <= Date.now()) return { status: "expired" };
  const orgClaims = organizationClaims(payload);
  if (orgClaims === null) return { status: "invalid" };

  try {
    const [session, user] = await Promise.all([
      client.sessions.getSession(payload.sid),
      client.users.getUser(payload.sub),
    ]);
    if (!isRecord(session)
      || session.id !== payload.sid
      || session.userId !== payload.sub
      || session.status !== "active"
      || typeof session.expireAt !== "number"
      || !Number.isFinite(session.expireAt)
      || session.expireAt <= Date.now()
      || !isRecord(user)
      || user.id !== payload.sub
      || !validIdentifier(user.primaryEmailAddressId)
      || !Array.isArray(user.emailAddresses)) {
      return { status: "invalid" };
    }
    const primary = user.emailAddresses.find(
      (email) => isRecord(email) && email.id === user.primaryEmailAddressId,
    );
    if (!isRecord(primary) || !nonEmptyString(primary.emailAddress)) return { status: "invalid" };
    const normalizedEmail = primary.emailAddress.trim().toLowerCase();
    if (normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
      return { status: "invalid" };
    }
    const first = typeof user.firstName === "string" ? user.firstName.trim() : "";
    const last = typeof user.lastName === "string" ? user.lastName.trim() : "";

    return {
      status: "authenticated",
      session: {
        externalSessionId: payload.sid,
        externalSubject: payload.sub,
        externalOrganizationId: orgClaims.organizationId,
        email: normalizedEmail,
        displayName: [first, last].filter(Boolean).join(" ") || null,
        impersonated: payload.act !== undefined || session.actor !== null,
        role: orgClaims.role,
        permissions: orgClaims.permissions,
        expiresAt: new Date(Math.min(session.expireAt, tokenExpiresAt)),
      },
    };
  } catch {
    return { status: "invalid" };
  }
}

export function createClerkPort(config: ClerkSdkConfig): ClerkPort {
  let client: ClerkClient;
  try {
    client = createClerkClient({
      secretKey: config.secretKey,
      publishableKey: config.publishableKey,
    });
  } catch {
    throw new Error("Clerk client initialization failed");
  }

  const organizationMemberships = async (organizationId: string): Promise<unknown[]> => allPages(
    (offset) => client.organizations.getOrganizationMembershipList({
      organizationId,
      limit: PAGE_SIZE,
      offset,
    }),
  );
  const organizationInvitations = async (organizationId: string): Promise<unknown[]> => allPages(
    (offset) => client.organizations.getOrganizationInvitationList({
      organizationId,
      limit: PAGE_SIZE,
      offset,
    }),
  );

  return {
    async createOrganization(name): Promise<string> {
      return fixedFailure("Clerk organization operation failed", async () => {
        const organization = await client.organizations.createOrganization({ name });
        if (!isRecord(organization) || !validIdentifier(organization.id)) {
          throw new Error("invalid organization response");
        }
        return organization.id;
      });
    },

    async deleteOrganization(organizationId): Promise<void> {
      await fixedFailure("Clerk organization operation failed", async () => {
        const deleted = await client.organizations.deleteOrganization(organizationId);
        if (!isRecord(deleted) || deleted.id !== organizationId) {
          throw new Error("organization response mismatch");
        }
      });
    },

    async authenticateSession(sessionToken): Promise<ClerkSessionResult> {
      return authenticate(client, config, sessionToken);
    },

    async listMembershipsForUser(subject): Promise<ClerkMembershipRecord[]> {
      return fixedFailure("Clerk membership operation failed", async () => {
        const records = await allPages((offset) => client.users.getOrganizationMembershipList({
          userId: subject,
          limit: PAGE_SIZE,
          offset,
        }));
        const normalized = records.map(normalizeMembership);
        if (normalized.some((record) => record === null)) throw new Error("invalid membership response");
        if ((normalized as ClerkMembershipRecord[]).some(
          (record) => record.externalSubject !== subject,
        )) throw new Error("membership subject mismatch");
        return normalized as ClerkMembershipRecord[];
      });
    },

    async listMembershipsForOrganization(organizationId): Promise<ClerkOrgMemberRecord[]> {
      return fixedFailure("Clerk membership operation failed", async () => {
        const normalized = (await organizationMemberships(organizationId)).map(normalizeOrgMember);
        if (normalized.some((record) => record === null)) throw new Error("invalid membership response");
        if ((normalized as ClerkOrgMemberRecord[]).some(
          (record) => record.externalOrganizationId !== organizationId,
        )) throw new Error("membership organization mismatch");
        return normalized as ClerkOrgMemberRecord[];
      });
    },

    async listInvitationsForOrganization(organizationId): Promise<ClerkInvitationRecord[]> {
      return fixedFailure("Clerk invitation operation failed", async () => {
        const normalized = (await organizationInvitations(organizationId)).map(
          (record) => normalizeInvitation(record, organizationId),
        );
        if (normalized.some((record) => record === null)) throw new Error("invalid invitation response");
        return normalized as ClerkInvitationRecord[];
      });
    },

    async sendInvitation(email, organizationId, role): Promise<string> {
      return fixedFailure("Clerk invitation operation failed", async () => {
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) throw new Error("invalid email");
        const invitations = (await organizationInvitations(organizationId)).map(
          (record) => normalizeInvitation(record, organizationId),
        );
        if (invitations.some((record) => record === null)) throw new Error("invalid invitation response");
        const matches = (invitations as ClerkInvitationRecord[]).filter(
          (invitation) => invitation.status === "pending" && invitation.email === normalizedEmail,
        );
        if (matches.length > 1) throw new Error("ambiguous invitation response");
        if (matches[0]) {
          if (matches[0].role !== role) throw new Error("pending invitation role mismatch");
          return matches[0].externalInvitationId;
        }
        const created = await client.organizations.createOrganizationInvitation({
          organizationId,
          emailAddress: normalizedEmail,
          role,
        });
        const record = normalizeInvitation(created, organizationId);
        if (record === null || record.status !== "pending") throw new Error("invalid invitation response");
        return record.externalInvitationId;
      });
    },

    async revokeInvitation(organizationId, invitationId): Promise<void> {
      await fixedFailure("Clerk invitation operation failed", async () => {
        const revoked = await client.organizations.revokeOrganizationInvitation({
          organizationId,
          invitationId,
        });
        const record = normalizeInvitation(revoked, organizationId);
        if (record === null
          || record.externalInvitationId !== invitationId
          || record.status !== "revoked") {
          throw new Error("invitation response mismatch");
        }
      });
    },

    async replaceInvitationRole(organizationId, invitationId, role): Promise<string> {
      return fixedFailure("Clerk invitation operation failed", async () => {
        const invitations = (await organizationInvitations(organizationId)).map(
          (record) => normalizeInvitation(record, organizationId),
        );
        if (invitations.some((record) => record === null)) throw new Error("invalid invitation response");
        const matches = (invitations as ClerkInvitationRecord[]).filter(
          (invitation) => invitation.externalInvitationId === invitationId
            && invitation.status === "pending",
        );
        if (matches.length !== 1) throw new Error("invitation ownership conflict");
        await client.organizations.revokeOrganizationInvitation({ organizationId, invitationId });
        const created = await client.organizations.createOrganizationInvitation({
          organizationId,
          emailAddress: matches[0]!.email,
          role,
        });
        const replacement = normalizeInvitation(created, organizationId);
        if (replacement === null || replacement.status !== "pending") {
          throw new Error("invalid invitation response");
        }
        return replacement.externalInvitationId;
      });
    },

    async deleteMembership(organizationId, subject): Promise<void> {
      await fixedFailure("Clerk membership operation failed", async () => {
        const deleted = await client.organizations.deleteOrganizationMembership({
          organizationId,
          userId: subject,
        });
        const record = normalizeMembership(deleted);
        if (record === null
          || record.externalOrganizationId !== organizationId
          || record.externalSubject !== subject) {
          throw new Error("membership response mismatch");
        }
      });
    },

    async updateMembershipRole(organizationId, subject, role): Promise<void> {
      await fixedFailure("Clerk membership operation failed", async () => {
        const updated = await client.organizations.updateOrganizationMembership({
          organizationId,
          userId: subject,
          role,
        });
        const record = normalizeMembership(updated);
        if (record === null
          || record.externalOrganizationId !== organizationId
          || record.externalSubject !== subject
          || record.role !== role) {
          throw new Error("membership response mismatch");
        }
      });
    },

    async authorizationUrl(returnPath, requestUrl): Promise<URL> {
      const url = new URL("/sign-in", requestUrl);
      url.searchParams.set("redirect_url", returnPath);
      return url;
    },

    async revokeSession(sessionToken): Promise<void> {
      await fixedFailure("Clerk session operation failed", async () => {
        const result = await authenticate(client, config, sessionToken);
        if (result.status !== "authenticated") return;
        const revoked = await client.sessions.revokeSession(result.session.externalSessionId);
        if (!isRecord(revoked) || revoked.id !== result.session.externalSessionId) {
          throw new Error("session response mismatch");
        }
      });
    },
  };
}
