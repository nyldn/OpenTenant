import type {
  IdentityGateway,
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

export interface LocalUser {
  token: string; tenant: TenantId | null; user: UserId; email: string; name: string; role: TenantRole | null;
  isPlatformAdmin?: boolean;
  permissions?: readonly string[];
}

export interface LocalIdentityConfig {
  readonly users?: readonly LocalUser[];
  readonly origin: string;
  readonly sessionToken: string;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly permissions: readonly string[];
}

function localOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Local identity origin must be a loopback HTTP URL");
  }
  return url.origin;
}

function identifier(value: string, field: string): string {
  if (value.trim().length === 0 || /[\0\r\n]/u.test(value)) {
    throw new Error(`Invalid local identity ${field}`);
  }
  return value;
}

function normalizeLocalUser(entry: LocalUser): LocalUser {
  for (const key of ["token", "user", "email", "name"] as const) identifier(entry[key], key);
  const noMembership = entry.tenant === null && entry.role === null;
  const member = typeof entry.tenant === "string" && identifier(entry.tenant, "tenant")
    && ["tenant_owner", "tenant_admin", "tenant_member"].includes(entry.role ?? "");
  if (!noMembership && !member) throw new Error("Invalid local membership");
  if (entry.isPlatformAdmin !== undefined && typeof entry.isPlatformAdmin !== "boolean") throw new Error("Invalid local installation authority");
  if (entry.permissions !== undefined && (!Array.isArray(entry.permissions) || !entry.permissions.every(p => typeof p === "string" && p.trim()))) throw new Error("Invalid local permissions");
  return { token: entry.token, tenant: entry.tenant, user: entry.user, email: entry.email, name: entry.name, role: entry.role, isPlatformAdmin: entry.isPlatformAdmin ?? false, ...(entry.permissions ? { permissions: entry.permissions } : {}) };
}

function parseLocalUsers(raw: string): LocalUser[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
    const tokens = new Set<string>();
    const memberships = new Set<string>();
    return parsed.map((entry: LocalUser) => {
      const user = normalizeLocalUser(entry);
      const membership = JSON.stringify([user.tenant, user.user]);
      if (tokens.has(user.token) || memberships.has(membership)) throw new Error();
      tokens.add(user.token);
      memberships.add(membership);
      return user;
    });
  } catch { throw new Error("Invalid LOCAL_USERS configuration"); }
}

export function localIdentityConfigFromEnv(
  env: NodeJS.ProcessEnv,
  defaultPermissions: readonly string[] = [],
): LocalIdentityConfig {
  if (env.NODE_ENV === "production") {
    throw new Error("Local identity is disabled in production");
  }
  if (env.IDENTITY_PROVIDER !== "local") {
    throw new Error("IDENTITY_PROVIDER must be local");
  }
  const permissions = (env.LOCAL_PERMISSIONS
    ?? defaultPermissions.join(","))
    .split(",")
    .map((permission) => permission.trim())
    .filter(Boolean);
  const users = env.LOCAL_USERS === undefined ? undefined : parseLocalUsers(env.LOCAL_USERS);
  return {
    ...(users ? { users } : {}),
    origin: localOrigin(env.LOCAL_PUBLIC_ORIGIN ?? "http://localhost:3000"),
    sessionToken: identifier(env.LOCAL_SESSION_TOKEN ?? "opentenant-local-session", "session token"),
    tenantId: identifier(env.LOCAL_TENANT_ID ?? "tenant_local", "tenant id") as TenantId,
    userId: identifier(env.LOCAL_USER_ID ?? "user_local", "user id") as UserId,
    email: identifier(env.LOCAL_USER_EMAIL ?? "developer@example.test", "email"),
    displayName: identifier(env.LOCAL_USER_NAME ?? "Local Developer", "display name"),
    permissions,
  };
}

function unavailable(): never {
  throw new Error("Operation is unavailable with local identity");
}

/**
 * Synthetic local identity adapter. It is intentionally rejected in
 * production and never persists or emulates provider objects.
 */
export class LocalIdentityGateway implements IdentityGateway {
  constructor(
    private readonly config: LocalIdentityConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async validateSession(
    sessionToken: string,
    expectedTenantId: TenantId | null,
  ): Promise<SessionValidationResult> {
    const user = this.users().find(user => user.token === sessionToken);
    if (!user) return { status: "invalid" };
    if (expectedTenantId !== null && expectedTenantId !== user.tenant) return { status: "tenant_mismatch", userId: user.user };
    return { status: "valid", session: {
      userId: user.user, email: user.email, displayName: user.name,
      activeTenantId: user.tenant, activeRole: user.role,
      permissions: user.tenant ? [...(user.permissions ?? this.config.permissions)] : [], isPlatformAdmin: user.isPlatformAdmin ?? !this.config.users,
      expiresAt: new Date(this.clock().getTime() + 24 * 60 * 60_000),
    } };
  }

  private users(): readonly LocalUser[] {
    return this.config.users ?? [{ token: this.config.sessionToken, tenant: this.config.tenantId, user: this.config.userId, email: this.config.email, name: this.config.displayName, role: "tenant_owner" }];
  }
  private membershipId(user: LocalUser): MembershipId {
    return (this.config.users ? `local:${user.tenant}:${user.user}` : "membership_local") as MembershipId;
  }
  async listMemberships(userId: UserId): Promise<TenantMembership[]> {
    return this.users().filter(user => user.user === userId && user.tenant !== null && user.role !== null).map(user => ({ membershipId: this.membershipId(user), userId, tenantId: user.tenant!, role: user.role!, status: "active" }));
  }
  async listTenantMembers(tenantId: TenantId): Promise<TenantMember[]> {
    return this.users().filter(user => user.tenant === tenantId).map(user => ({ kind: "membership", membershipId: this.membershipId(user), userId: user.user, tenantId, email: user.email, displayName: user.name, role: user.role!, status: "active" }));
  }

  async invite(_invitation: Invitation): Promise<MembershipId> {
    unavailable();
  }

  async removeMembership(_membershipId: MembershipId): Promise<void> {
    unavailable();
  }

  async setRole(_membershipId: MembershipId, _role: TenantRole): Promise<void> {
    unavailable();
  }

  async startLogin(request: LoginRequest): Promise<URL> {
    const safeReturn = safeReturnPath(request.returnPath);
    const url = new URL("/auth/local", this.config.origin);
    url.searchParams.set("return", safeReturn);
    return url;
  }

  async logout(_sessionToken: string): Promise<void> {
    // Clearing the local browser cookie is sufficient; no remote session exists.
  }
}
