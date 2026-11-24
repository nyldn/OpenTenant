import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BRAND_PROPOSAL_PERMISSIONS, safeReturnPath, type AccountLinkStore, type IdentityGateway, type Invitation, type LoginRequest, type MembershipId, type SessionValidationResult, type TenantId, type TenantMember, type TenantMembership, type TenantOrgResolver, type TenantRole, type UserId } from "@opentenant/auth";
import { AUTH_PATH } from "./constants";
import type { BetterAuthRuntime, BetterAuthHooks } from "./runtime";

const roles: Readonly<Record<string, TenantRole>> = { owner: "tenant_owner", admin: "tenant_admin", member: "tenant_member" };
function roleFor(value: string): TenantRole | null {
  return Object.hasOwn(roles, value) ? roles[value] ?? null : null;
}
const providerRoles: Record<TenantRole, string> = { tenant_owner: "owner", tenant_admin: "admin", tenant_member: "member" };
const PAGE_SIZE = 100;
type Database = Pick<Pool | PoolClient, "query">;
interface MemberRow { id: string; organizationId: string; userId: string; role: string; email: string; name: string }
interface InviteRow { id: string; email: string; role: string }

export class IdentityAdapterError extends Error {
  constructor() { super("Identity provider operation failed"); this.name = "IdentityAdapterError"; }
}
function normalized<T>(work: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(work).catch(() => { throw new IdentityAdapterError(); });
}

/** All calls are trusted server operations; authorization remains with the platform. */
export class BetterAuthIdentityGateway implements IdentityGateway {
  constructor(
    private readonly auth: BetterAuthRuntime,
    private readonly db: Database,
    private readonly orgs: TenantOrgResolver,
    private readonly accounts: AccountLinkStore,
    private readonly hooks: BetterAuthHooks = {},
  ) {}

  validateSession(credential: string, expectedTenantId: TenantId | null): Promise<SessionValidationResult> {
    return normalized(async () => {
      const result = await this.auth.api.getSession({ headers: new Headers({ cookie: credential }) });
      if (!result) return { status: "invalid" };
      if (result.session.expiresAt <= new Date()) return { status: "expired" };
      const userId = await this.accounts.userIdForExternalSubject(result.user.id, result.user.email, result.user.name);
      const organizationId = result.session.activeOrganizationId ?? null;
      let tenantId: TenantId | null = null;
      let role: TenantRole | null = null;
      if (organizationId) {
        tenantId = await this.orgs.tenantForExternalOrganization(organizationId);
        if (!tenantId) return { status: "tenant_mismatch", userId };
        const { rows } = await this.db.query<{ role: string }>(
          'select role from ba_member where "organizationId" = $1 and "userId" = $2', [organizationId, result.user.id],
        );
        role = roleFor(rows[0]?.role ?? "");
        if (rows.length !== 1 || role === null) return { status: "invalid" };
      }
      if (expectedTenantId !== null && tenantId !== expectedTenantId) return { status: "tenant_mismatch", userId };
      return { status: "valid", session: {
        userId, email: result.user.email, displayName: result.user.name,
        activeTenantId: tenantId, activeRole: role,
        permissions: tenantId && (role === "tenant_owner" || role === "tenant_admin") ? [...BRAND_PROPOSAL_PERMISSIONS] : [],
        isPlatformAdmin: await this.accounts.isPlatformAdmin(userId), expiresAt: result.session.expiresAt,
      } };
    });
  }

  listMemberships(userId: UserId): Promise<TenantMembership[]> {
    return normalized(async () => {
      const subject = await this.accounts.externalSubjectForUserId(userId);
      if (!subject) return [];
      const result: TenantMembership[] = [];
      for (const row of await this.members('m."userId" = $1', subject)) {
        const tenantId = await this.orgs.tenantForExternalOrganization(row.organizationId);
        const role = roleFor(row.role);
        if (!tenantId || !role) continue;
        result.push({ membershipId: await this.accounts.membershipIdForExternalRef({ kind: "membership", externalId: row.id }, { tenantId, userId }), userId, tenantId, role, status: "active" });
      }
      return result;
    });
  }

  listTenantMembers(tenantId: TenantId): Promise<TenantMember[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) return Promise.resolve([]);
    return normalized(async () => {
      const org = await this.orgs.externalOrganizationForTenant(tenantId);
      if (!org) return [];
      const result: TenantMember[] = [];
      for (const row of await this.members('m."organizationId" = $1', org)) {
        const role = roleFor(row.role);
        if (!role) continue;
        const userId = await this.accounts.userIdForExternalSubject(row.userId, row.email, row.name);
        result.push({ kind: "membership", membershipId: await this.accounts.membershipIdForExternalRef({ kind: "membership", externalId: row.id }, { tenantId, userId }), userId, tenantId, email: row.email, displayName: row.name, role, status: "active" });
      }
      let cursor = "";
      for (;;) {
        const { rows } = await this.db.query<InviteRow>(
          `select id, email, role from ba_invitation where "organizationId" = $1 and status = 'pending' and "expiresAt" > now() and id > $2 order by id limit $3`, [org, cursor, PAGE_SIZE],
        );
        for (const row of rows) {
          const role = roleFor(row.role);
          if (!role) continue;
          result.push({ kind: "invitation", membershipId: await this.accounts.membershipIdForExternalRef({ kind: "invitation", externalId: row.id }, { tenantId, userId: null }), userId: null, tenantId, email: row.email, displayName: null, role, status: "invited" });
        }
        if (rows.length < PAGE_SIZE) break;
        cursor = rows.at(-1)!.id;
      }
      return result;
    });
  }

  invite(invitation: Invitation): Promise<MembershipId> {
    return normalized(async () => {
      if (invitation.role !== "tenant_admin" && invitation.role !== "tenant_member") throw new IdentityAdapterError();
      const org = await this.organizationFor(invitation.tenantId);
      const inviter = await this.accounts.externalSubjectForUserId(invitation.invitedBy);
      if (!inviter) throw new IdentityAdapterError();
      const { rows } = await this.db.query<{ id: string }>(
        `insert into ba_invitation (id, email, role, status, "organizationId", "inviterId", "expiresAt", "createdAt")
         values ($1, lower(trim($2)), $3, 'pending', $4, $5, now() + interval '48 hours', now())
         on conflict ("organizationId", lower(email)) where status = 'pending'
         do update set role = excluded.role, "expiresAt" = excluded."expiresAt" returning id`,
        [randomUUID(), invitation.email, providerRoles[invitation.role], org, inviter],
      );
      const id = rows[0]!.id;
      await this.hooks.sendInvitationEmail?.({ email: invitation.email, invitationId: id, organizationId: org });
      return this.accounts.membershipIdForExternalRef({ kind: "invitation", externalId: id }, { tenantId: invitation.tenantId, userId: null });
    });
  }

  removeMembership(membershipId: MembershipId): Promise<void> {
    return normalized(async () => {
      const { ref, org, subject } = await this.ownedRef(membershipId);
      const result = ref.kind === "invitation"
        ? await this.db.query(`update ba_invitation set status = 'canceled' where id = $1 and "organizationId" = $2 and status = 'pending' returning id`, [ref.externalId, org])
        : await this.db.query(`with removed as (delete from ba_member where id = $1 and "organizationId" = $2 and "userId" = $3 returning id), revoked as (delete from ba_session where "userId" = $3 and "activeOrganizationId" = $2 and exists (select 1 from removed)) select id from removed`, [ref.externalId, org, subject]);
      if (result.rows.length !== 1) throw new IdentityAdapterError();
    });
  }

  setRole(membershipId: MembershipId, role: TenantRole): Promise<void> {
    return normalized(async () => {
      if (!Object.hasOwn(providerRoles, role)) throw new IdentityAdapterError();
      const { ref, org, subject } = await this.ownedRef(membershipId);
      if (ref.kind === "invitation" && role === "tenant_owner") throw new IdentityAdapterError();
      const result = ref.kind === "invitation"
        ? await this.db.query(`update ba_invitation set role = $3 where id = $1 and "organizationId" = $2 and status = 'pending' returning id`, [ref.externalId, org, providerRoles[role]])
        : await this.db.query(`update ba_member set role = $4 where id = $1 and "organizationId" = $2 and "userId" = $3 returning id`, [ref.externalId, org, subject, providerRoles[role]]);
      if (result.rows.length !== 1) throw new IdentityAdapterError();
    });
  }

  startLogin(request: LoginRequest): Promise<URL> {
    return normalized(async () => {
      const url = new URL(request.requestUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new IdentityAdapterError();
      const target = new URL(`${AUTH_PATH}/login`, url.origin);
      target.searchParams.set("return", safeReturnPath(request.returnPath));
      return target;
    });
  }

  logout(credential: string): Promise<void> {
    return normalized(async () => { await this.auth.api.signOut({ headers: new Headers({ cookie: credential }) }); });
  }

  createOrganization(name: string): Promise<string> {
    return normalized(async () => {
      const id = randomUUID();
      await this.db.query('insert into ba_organization (id, name, slug, "createdAt") values ($1, $2, $1, now())', [id, name]);
      return id;
    });
  }

  deleteOrganization(id: string): Promise<void> {
    return normalized(async () => { await this.db.query("delete from ba_organization where id = $1", [id]); });
  }

  private async members(predicate: 'm."userId" = $1' | 'm."organizationId" = $1', value: string): Promise<MemberRow[]> {
    const result: MemberRow[] = [];
    let cursor = "";
    for (;;) {
      const { rows } = await this.db.query<MemberRow>(`select m.*, u.email, u.name from ba_member m join ba_user u on u.id = m."userId" where ${predicate} and m.id > $2 order by m.id limit $3`, [value, cursor, PAGE_SIZE]);
      result.push(...rows);
      if (rows.length < PAGE_SIZE) return result;
      cursor = rows.at(-1)!.id;
    }
  }

  private async organizationFor(tenantId: TenantId): Promise<string> {
    const org = await this.orgs.externalOrganizationForTenant(tenantId);
    if (!org) throw new IdentityAdapterError();
    return org;
  }

  private async ownedRef(id: MembershipId) {
    const ref = await this.accounts.externalRefForMembershipId(id);
    if (!ref) throw new IdentityAdapterError();
    const org = await this.organizationFor(ref.tenantId);
    const subject = ref.userId ? await this.accounts.externalSubjectForUserId(ref.userId) : null;
    if (ref.kind === "membership" && !subject) throw new IdentityAdapterError();
    return { ref, org, subject };
  }
}
