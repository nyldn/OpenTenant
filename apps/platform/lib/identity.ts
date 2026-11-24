import { installedModules } from "../opentenant-modules";
import { normalizeHost } from "@opentenant/domains";
import { SmtpEmailTransport } from "@opentenant/notifications/smtp";
import { betterAuthMailHooks, BetterAuthIdentityGateway, createBetterAuth, betterAuthConfigFromEnv } from "@opentenant/auth-better-auth";
import { serverConfig } from "./server-config";
/**
 * Server-only identity composition root: control-plane pool, WorkOS port,
 * and the IdentityGateway the app consumes. Route handlers and server
 * components import from here; nothing else touches provider config.
 */
import {
  ClerkIdentityGateway,
  clerkConfigFromEnv,
  createClerkPort,
  createWorkOSPort,
  LocalIdentityGateway,
  localIdentityConfigFromEnv,
  WorkOSIdentityGateway,
  workOSConfigFromEnv,
  type IdentityGateway,
  type LocalIdentityConfig,
  type ClerkPort,
  type WorkOSPort,
} from "@opentenant/auth";
import { PgAccountLinkStore, PgTenantOrgResolver } from "@opentenant/database";
import {
  identityProviderFromEnv,
  usesClerkIdentity,
  usesLocalIdentity,
} from "./identity-provider";
import type { PoolClient } from "pg";
import { controlPlanePool } from "./control-plane";

export {
  identityProviderFromEnv,
  usesClerkIdentity,
  usesLocalIdentity,
  type DeploymentIdentityProvider,
} from "./identity-provider";

export const SESSION_COOKIE = "opentenant_session";
/** Short-lived browser binding for the WorkOS login round trip. */
export const LOGIN_NONCE_COOKIE = "opentenant_login_nonce";

let gateway: IdentityGateway | null = null;
let workos: WorkOSPort | null = null;
let clerk: ClerkPort | null = null;
let orgResolver: PgTenantOrgResolver | null = null;
let localConfig: LocalIdentityConfig | null = null;

export type IdentityOrganizationPort = Pick<WorkOSPort, "createOrganization" | "deleteOrganization">;

export function localIdentityConfig(): LocalIdentityConfig {
  if (!usesLocalIdentity()) throw new Error("Local identity is not enabled");
  if (!localConfig) localConfig = localIdentityConfigFromEnv(serverConfig(), [...installedModules.modules.flatMap(definition => definition.permissions.roles.tenant_owner ?? []), "brand.proposal.upload", "brand.proposal.review"]);
  return localConfig;
}

export function workosPort(): WorkOSPort {
  if (identityProviderFromEnv() !== "workos") throw new Error("WorkOS identity is not enabled");
  if (!workos) workos = createWorkOSPort(workOSConfigFromEnv(serverConfig()));
  return workos;
}

export function clerkPort(): ClerkPort {
  if (!usesClerkIdentity()) throw new Error("Clerk identity is not enabled");
  if (!clerk) clerk = createClerkPort(clerkConfigFromEnv(serverConfig()));
  return clerk;
}

export function identityOrganizationPort(): IdentityOrganizationPort {
  const provider = identityProviderFromEnv();
  if (provider === "workos") return workosPort();
  if (provider === "clerk") return clerkPort();
  if (provider === "better-auth") return identityGateway() as BetterAuthIdentityGateway;
  throw new Error("Local identity has no external organization provider");
}

export function tenantOrgResolver(): PgTenantOrgResolver {
  const provider = identityProviderFromEnv();
  if (provider === "local") throw new Error("Local identity has no organization resolver");
  if (!orgResolver) orgResolver = new PgTenantOrgResolver(controlPlanePool(), provider);
  return orgResolver;
}

/** Bind stores to a locked client when supplied; never cache a checked-out client. */
export function identityMailHooks(ownerClaimTenantId?: string) {
  const config = serverConfig();
  const transport = config.IDENTITY_SMTP_HOST ? new SmtpEmailTransport({ host: config.IDENTITY_SMTP_HOST, port: Number(config.IDENTITY_SMTP_PORT ?? 587), from: config.IDENTITY_SMTP_FROM ?? "", secure: Number(config.IDENTITY_SMTP_PORT ?? 587) === 465, requireTLS: config.NODE_ENV === "production", ...(config.IDENTITY_SMTP_USER ? { auth: { user: config.IDENTITY_SMTP_USER, pass: config.IDENTITY_SMTP_PASSWORD ?? "" } } : {}) }) : undefined;
  return betterAuthMailHooks(transport, config.BETTER_AUTH_BASE_URL ?? "http://localhost:3000", async organizationId => {
    const tenantId = await tenantOrgResolver().tenantForExternalOrganization(organizationId);
    if (!tenantId) throw new Error("Identity invitation tenant unavailable");
    const result = await controlPlanePool().query<{ host: string }>("select host from domains where tenant_id=$1 and kind='opentenant_subdomain' and active and verification='verified' order by host limit 1", [tenantId]);
    const host = normalizeHost(result.rows[0]?.host ?? null);
    if (!host) throw new Error("Identity invitation tenant unavailable");
    const origin = new URL(config.BETTER_AUTH_BASE_URL!);
    origin.hostname = host;
    return origin.origin;
  }, ownerClaimTenantId ? `/admin/tenants/${encodeURIComponent(ownerClaimTenantId)}/owner-claim` : undefined);
}

export function identityGateway(database?: PoolClient, ownerClaimTenantId?: string): IdentityGateway {
  if (!database && gateway) return gateway;
  const provider = identityProviderFromEnv();
  let result: IdentityGateway;
  if (provider === "local") {
    result = new LocalIdentityGateway(localIdentityConfig());
  } else {
    const db = database ?? controlPlanePool();
    const resolver = new PgTenantOrgResolver(db, provider);
    const accounts = new PgAccountLinkStore(db, provider);
    result = provider === "workos"
      ? new WorkOSIdentityGateway(workosPort(), resolver, accounts)
      : provider === "clerk"
        ? new ClerkIdentityGateway(clerkPort(), resolver, accounts)
        : new BetterAuthIdentityGateway(createBetterAuth(controlPlanePool(), betterAuthConfigFromEnv(serverConfig()), identityMailHooks()), db, resolver, accounts, identityMailHooks(ownerClaimTenantId));
  }
  if (!database) gateway = result;
  return result;
}

/** Extracts the sealed session cookie from a request, if present. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (identityProviderFromEnv() === "better-auth") return header;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
