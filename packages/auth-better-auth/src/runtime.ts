import { betterAuth, type BetterAuthPlugin, type BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { scim } from "@better-auth/scim";
import type { Pool } from "pg";
import type { BetterAuthConfig } from "./config";

import { AUTH_PATH, SESSION_COOKIE } from "./constants";
export { AUTH_PATH, SESSION_COOKIE } from "./constants";

/** Prefix plugin-owned tables without changing their logical adapter model keys. */
function prefixed<P extends BetterAuthPlugin>(plugin: P): P {
  return { ...plugin, schema: Object.fromEntries(Object.entries(plugin.schema ?? {}).map(([key, table]) =>
    [key, { ...table, ...(key === "session" || key === "user" ? {} : { modelName: `ba_${key}` }) }],
  )) };
}

/** SDK types stay inside this package. Mail delivery is an injected server hook. */
export interface BetterAuthHooks {
  sendVerificationEmail?: (message: { email: string; url: string }) => Promise<void>;
  sendInvitationEmail?: (message: { email: string; invitationId: string; organizationId: string }) => Promise<void>;
}

export function betterAuthOptions(pool: Pool, config: BetterAuthConfig, hooks: BetterAuthHooks = {}): BetterAuthOptions {
  return {
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: AUTH_PATH,
    trustedOrigins: [config.baseURL, ...(config.ssoEnabled ? config.ssoTrustedOrigins ?? [] : [])],
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: { enabled: true, requireEmailVerification: config.production },
    emailVerification: {
      sendOnSignUp: !!hooks.sendVerificationEmail,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        if (!hooks.sendVerificationEmail) throw new Error("Identity email delivery is not configured");
        await hooks.sendVerificationEmail({ email: user.email, url });
      },
    },
    databaseHooks: {
      session: { create: { before: async (session) => {
        const { rows } = await pool.query<{ organizationId: string }>(`select m."organizationId" from ba_member m join identity_org_mappings o on o.external_organization_id = m."organizationId" and o.provider = 'better-auth' where m."userId" = $1`, [session.userId]);
        return { data: { ...session, ...(rows.length === 1 ? { activeOrganizationId: rows[0]!.organizationId } : {}) } };
      } } },
    },
    account: { modelName: "ba_account", accountLinking: { enabled: false } },
    user: { modelName: "ba_user" },
    session: { modelName: "ba_session", cookieCache: { enabled: false } },
    verification: { modelName: "ba_verification" },
    advanced: {
      useSecureCookies: config.production || config.baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const, path: "/" },
      cookies: { session_token: { name: SESSION_COOKIE } },
    },
    rateLimit: { enabled: true, storage: "database" as const, modelName: "ba_rateLimit" },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: config.production,
        schema: { organization: { modelName: "ba_organization" }, member: { modelName: "ba_member", additionalFields: { scimManaged: { type: "boolean", defaultValue: false, input: false } } }, invitation: { modelName: "ba_invitation" } },
        sendInvitationEmail: async (data) => {
          if (!hooks.sendInvitationEmail) throw new Error("Identity email delivery is not configured");
          await hooks.sendInvitationEmail({ email: data.email, invitationId: data.id, organizationId: data.organization.id });
        },
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            if (!["member", "admin"].includes(invitation.role)) throw new Error("Identity invitation role denied");
          },
        },
      }),
      sso({
        schema: { ssoProvider: { modelName: "ba_ssoProvider" } },
        providersLimit: config.ssoEnabled ? 5 : 0,
        organizationProvisioning: { disabled: true },
        domainVerification: { enabled: true },
      }),
      // SCIM 1.7 links only operator-mapped subjects and projects membership
      // through the vendor transaction. With no connection, deny all tokens.
      prefixed(directoryPlugin(pool, config) as unknown as BetterAuthPlugin),
    ],
  } satisfies Parameters<typeof betterAuth>[0];
}

/** Deliberately narrow facade avoids exporting inferred SDK/plugin types. */
export interface BetterAuthRuntime {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<{ session: { expiresAt: Date; activeOrganizationId?: string | null }; user: { id: string; email: string; name: string } } | null>;
    signOut(input: { headers: Headers }): Promise<unknown>;
    signInEmail(input: { body: { email: string; password: string }; asResponse: true }): Promise<Response>;
    signUpEmail(input: { body: { email: string; password: string; name: string } }): Promise<{ user: { id: string } }>;
    setActiveOrganization(input: { body: { organizationId: string }; headers: Headers; asResponse: true }): Promise<Response>;
    setActiveOrganization(input: { body: { organizationId: string }; headers: Headers }): Promise<unknown>;
    acceptInvitation(input: { body: { invitationId: string }; headers: Headers }): Promise<unknown>;
  };
}
export function createBetterAuth(pool: Pool, config: BetterAuthConfig, hooks?: BetterAuthHooks): BetterAuthRuntime {
  return betterAuth(betterAuthOptions(pool, config, hooks)) as unknown as BetterAuthRuntime;
}

/** SCIM owns only memberships it created. Existing owners/admins remain manual. */
function directoryPlugin(pool: Pool, config: BetterAuthConfig) {
  const connection = config.directory;
  if (!connection) return scim({ connections: [], authentication: { verifyBearerToken: async () => null } });
  return scim({
    connections: [{ id: connection.id, provisioningDomainId: connection.organizationId, credentials: [{ type: "bearer", id: connection.id, token: connection.token }] }],
    identity: { resolveUser: async ({ resource }) => {
      const userId = resource.externalId && Object.hasOwn(connection.subjects, resource.externalId) ? connection.subjects[resource.externalId] : undefined;
      const mapping = await pool.query(`select tenant_id from identity_org_mappings where provider = 'better-auth' and external_organization_id = $1`, [connection.organizationId]);
      if (!userId || mapping.rows.length !== 1) throw new Error("Directory subject mapping required");
      return { action: "link", userId, profile: "preserve" };
    } },
    projection: { reconcileUser: async (input, { database }) => {
      if (input.provisioningDomainId !== connection.organizationId) throw new Error("Directory domain mismatch");
      const where = [{ field: "organizationId", value: connection.organizationId }, { field: "userId", value: input.userId }];
      const member = await database.findOne<{ id: string; scimManaged: boolean }>({ model: "member", where });
      if (member && !member.scimManaged) return;
      if (input.active && !member) {
        await database.create({ model: "member", data: { organizationId: connection.organizationId, userId: input.userId, role: "member", scimManaged: true, createdAt: new Date() } });
      } else if (!input.active && member) {
        await database.delete({ model: "member", where: [{ field: "id", value: member.id }] });
        await database.deleteMany({ model: "session", where: [{ field: "userId", value: input.userId }, { field: "activeOrganizationId", value: connection.organizationId }] });
      }
    } },
  });
}
