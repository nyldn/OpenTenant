/** Real provider-specific proofs and the shared IdentityGateway contract. */

import { identityGatewayContract } from "./identity-conformance";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { PgAccountLinkStore, PgTenantOrgResolver } from "@opentenant/database";
import type { Invitation, MembershipId, TenantId } from "@opentenant/auth";
import { BetterAuthIdentityGateway, IdentityAdapterError } from "../../auth-better-auth/src/gateway";
import { betterAuthOptions, createBetterAuth, AUTH_PATH } from "../../auth-better-auth/src/runtime";
import { handleBetterAuthRequest } from "../../auth-better-auth/src/http";
import { betterAuthConfigFromEnv } from "../../auth-better-auth/src/config";

const config = { secret: "synthetic-conformance-secret-over-32-characters", baseURL: "http://localhost:3000", production: false };
const alpha = "ten_alpha" as TenantId;
const beta = "ten_beta" as TenantId;
const databaseUrl = integrationDatabaseUrl("PROVISIONING_CONTROL_DATABASE_URL");
if (databaseUrl) {
let pool: Pool;
let auth: ReturnType<typeof createBetterAuth>;
let accounts: PgAccountLinkStore;
let orgs: PgTenantOrgResolver;
let gateway: BetterAuthIdentityGateway;
let credential: string;
let subject: string;
let org: string;
let invitation: Invitation;

async function signIn(): Promise<string> {
  const result = await auth.api.signInEmail({ body: { email: "owner@example.test", password: "synthetic-password" }, asResponse: true });
  expect(result.status).toBe(200);
  return result.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
}

beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 16 });
  const directory = new URL("../../../tooling/migrations/sql/control-plane/", import.meta.url);
  for (const file of readdirSync(directory).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(new URL(file, directory), "utf8"));
  }
  await pool.query(`insert into tenants (tenant_id, slug, display_name, status, data_region) values ('ten_alpha','alpha','Alpha','active','us'), ('ten_beta','beta','Beta','active','us')`);
  auth = createBetterAuth(pool, config);
  accounts = new PgAccountLinkStore(pool, "better-auth");
  orgs = new PgTenantOrgResolver(pool, "better-auth");
  gateway = new BetterAuthIdentityGateway(auth, pool, orgs, accounts);
}, 120_000);

afterAll(async () => {
  await pool?.end();

});

beforeEach(async () => {
  await pool.query(`truncate ba_user, ba_organization, "ba_rateLimit", identity_account_links, membership_links, platform_users, identity_org_mappings cascade`);
  const signup = await auth.api.signUpEmail({ body: { email: "owner@example.test", password: "synthetic-password", name: "Example Owner" } });
  subject = signup.user.id;
  org = await gateway.createOrganization("Example Organization");
  const second = await gateway.createOrganization("Other Organization");
  await pool.query(`insert into identity_org_mappings values ($1, 'better-auth', $2), ($3, 'better-auth', $4)`, [alpha, org, beta, second]);
  await pool.query(`insert into ba_member (id, "organizationId", "userId", role, "createdAt") values ('owner-membership', $1, $2, 'owner', now())`, [org, subject]);
  const userId = await accounts.userIdForExternalSubject(subject, "owner@example.test", "Example Owner");
  invitation = { email: "new@example.test", role: "tenant_member", tenantId: alpha, invitedBy: userId };
  credential = await signIn();
  await auth.api.setActiveOrganization({ headers: new Headers({ cookie: credential }), body: { organizationId: org } });
});

describe("IdentityGateway conformance with Better Auth and Postgres", () => {
  it("binds a signed session to the mapped tenant and live role", async () => {
    const valid = await gateway.validateSession(credential, alpha);
    expect(valid.status).toBe("valid");
    if (valid.status !== "valid") throw new Error("Expected verified owner session");
    expect(valid.session).toMatchObject({ activeTenantId: alpha, activeRole: "tenant_owner", isPlatformAdmin: false });
    const grants = ["brand.proposal.upload", "brand.proposal.review", "brand.proposal.edit", "brand.proposal.apply", "brand.proposal.supersede", "brand.proposal.revoke"].sort();
    expect([...valid.session.permissions].sort()).toEqual(grants);
    for (const [role, expected] of [["admin", grants], ["member", []]] as const) {
      await pool.query("update ba_member set role=$1", [role]);
      const session = await gateway.validateSession(credential, alpha);
      if (session.status !== "valid") throw new Error("Expected live membership session");
      expect([...session.session.permissions].sort()).toEqual(expected);
    }
    await pool.query("update platform_users set is_platform_admin=true");
    await pool.query('update ba_session set "activeOrganizationId"=null');
    await pool.query("delete from ba_member");
    const installation = await gateway.validateSession(credential, null);
    if (installation.status !== "valid") throw new Error("Expected installation session");
    expect(installation.session.isPlatformAdmin).toBe(true);
    expect(installation.session.activeTenantId).toBeNull();
    expect(installation.session.activeRole).toBeNull();
    expect(installation.session.permissions).toEqual([]);
    await pool.query(`insert into ba_member (id, "organizationId", "userId", role, "createdAt") values ('owner-membership', $1, $2, 'owner', now())`, [org, subject]);
    await pool.query('update ba_session set "activeOrganizationId"=$1', [org]);
    expect((await gateway.validateSession(credential, beta)).status).toBe("tenant_mismatch");
    expect((await gateway.validateSession("opentenant_session=forged", alpha)).status).toBe("invalid");
    await pool.query("update ba_member set role = 'constructor'");
    expect((await gateway.validateSession(credential, alpha)).status).toBe("invalid");
  });

  it("rejects expired, org-less, unmapped and removed membership sessions", async () => {
    await pool.query('update ba_session set "activeOrganizationId" = null');
    expect((await gateway.validateSession(credential, alpha)).status).toBe("tenant_mismatch");
    await pool.query('update ba_session set "activeOrganizationId" = $1', [org]);
    await pool.query("delete from identity_org_mappings where tenant_id = $1", [alpha]);
    expect((await gateway.validateSession(credential, alpha)).status).toBe("tenant_mismatch");
    await pool.query("insert into identity_org_mappings values ($1, 'better-auth', $2)", [alpha, org]);
    await pool.query("delete from ba_member");
    expect((await gateway.validateSession(credential, alpha)).status).toBe("invalid");
    await pool.query('update ba_session set "expiresAt" = now() - interval \'1 day\'');
    expect((await gateway.validateSession(credential, alpha)).status).not.toBe("valid");
  });

  it("paginates every membership and invitation with stable internal identifiers", async () => {
    await pool.query(`insert into ba_user (id,name,email,"emailVerified","createdAt","updatedAt") select 'person-' || n,'Person','person-' || n || '@example.test',true,now(),now() from generate_series(1,205) n`);
    await pool.query(`insert into ba_member (id,"organizationId","userId",role,"createdAt") select 'membership-' || n,$1,'person-' || n,'member',now() from generate_series(1,205) n`, [org]);
    await pool.query(`insert into ba_invitation (id,email,role,status,"organizationId","inviterId","expiresAt","createdAt") select 'invite-' || n,'invited-' || n || '@example.test','member','pending',$1,$2,now() + interval '1 day',now() from generate_series(1,205) n`, [org, subject]);
    const members = await gateway.listTenantMembers(alpha);
    expect(members).toHaveLength(411);
    expect(new Set(members.map((m) => m.membershipId)).size).toBe(411);
    expect(members.every((m) => m.tenantId === alpha && m.membershipId.startsWith("mem_"))).toBe(true);
    const userId = invitation.invitedBy;
    for (let n = 0; n < 105; n++) {
      const external = await gateway.createOrganization(`Organization ${n}`);
      const tenant = `ten_page_${n}`;
      await pool.query(`insert into tenants (tenant_id,slug,display_name,status,data_region) values ($1,$1,$1,'active','us') on conflict do nothing`, [tenant]);
      await pool.query("insert into identity_org_mappings values ($1,'better-auth',$2)", [tenant, external]);
      await pool.query(`insert into ba_member (id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,'member',now())`, [randomUUID(), external, subject]);
    }
    expect(await gateway.listMemberships(userId)).toHaveLength(106);
  }, 120_000);

  it("invites idempotently, maps roles, and denies owner invitations and promotions", async () => {
    const id = await gateway.invite(invitation);
    expect(await gateway.invite({ ...invitation, email: " NEW@EXAMPLE.TEST " })).toBe(id);
    await gateway.setRole(id, "tenant_admin");
    expect((await gateway.listTenantMembers(alpha)).find((m) => m.membershipId === id)?.role).toBe("tenant_admin");
    await expect(gateway.invite({ ...invitation, role: "tenant_owner" })).rejects.toThrow(IdentityAdapterError);
    await expect(gateway.setRole(id, "tenant_owner")).rejects.toThrow(IdentityAdapterError);
    await gateway.removeMembership(id);
    expect((await gateway.listTenantMembers(alpha)).filter((m) => m.kind === "invitation")).toHaveLength(0);
  });

  it("removes the owned membership and revokes its sessions; unknown references fail closed", async () => {
    const member = (await gateway.listTenantMembers(alpha))[0]!;
    await gateway.setRole(member.membershipId, "tenant_admin");
    const updated = await gateway.validateSession(credential, alpha);
    expect(updated.status === "valid" && updated.session.activeRole).toBe("tenant_admin");
    await gateway.removeMembership(member.membershipId);
    expect((await gateway.validateSession(credential, alpha)).status).toBe("invalid");
    await expect(gateway.removeMembership("unknown" as MembershipId)).rejects.toThrow("Identity provider operation failed");
    expect(await gateway.listMemberships(invitation.invitedBy)).toHaveLength(0);
  });

  it("converges concurrent account and invitation links without orphan users", async () => {
    const ids = await Promise.all(Array.from({ length: 16 }, () => accounts.userIdForExternalSubject("racing-subject", "race@example.test", "Race")));
    expect(new Set(ids).size).toBe(1);
    expect((await pool.query("select * from platform_users where email = 'race@example.test'")).rows).toHaveLength(1);
    const invitations = await Promise.all(Array.from({ length: 12 }, () => gateway.invite(invitation)));
    expect(new Set(invitations).size).toBe(1);
  });

  it("normalizes errors without provider identifiers, SQL, email or secrets", async () => {
    const broken = new BetterAuthIdentityGateway(auth, { query: async () => { throw new Error("postgresql://secret@example.test token-password query ba_member"); } } as unknown as Pool, orgs, accounts);
    const error = await broken.listTenantMembers(alpha).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "IdentityAdapterError", message: "Identity provider operation failed" });
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
    expect(String(error)).not.toMatch(/postgresql|password|example.test|ba_member/);
    await gateway.logout(credential);
    expect((await gateway.validateSession(credential, alpha)).status).toBe("invalid");
  });

  it("matches the pinned vendor schema without runtime migrations", async () => {
    const plan = await getMigrations(betterAuthOptions(pool, config));
    expect(plan.toBeCreated).toHaveLength(0);
    expect(plan.toBeAdded).toHaveLength(0);
  });

  it("sets secure production cookies and rejects unsafe configuration", async () => {
    expect(() => betterAuthConfigFromEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short", BETTER_AUTH_BASE_URL: "https://example.test" })).toThrow("BETTER_AUTH_SECRET");
    expect(() => betterAuthConfigFromEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: config.secret, BETTER_AUTH_BASE_URL: "http://example.test" })).toThrow("BETTER_AUTH_BASE_URL");
    const environment = { BETTER_AUTH_SECRET: config.secret, BETTER_AUTH_BASE_URL: config.baseURL, BETTER_AUTH_SSO_ENABLED: "true", BETTER_AUTH_SSO_TRUSTED_ORIGINS: "https://id.example.test" };
    expect(betterAuthConfigFromEnv(environment).ssoTrustedOrigins).toEqual(["https://id.example.test"]);
    expect(() => betterAuthConfigFromEnv({ ...environment, BETTER_AUTH_SSO_TRUSTED_ORIGINS: "http://id.example.test" })).toThrow("BETTER_AUTH_SSO_TRUSTED_ORIGINS");
    const secureAuth = createBetterAuth(pool, { ...config, baseURL: "https://example.test", production: true });
    await pool.query('update ba_user set "emailVerified" = true');
    const response = await secureAuth.api.signInEmail({ body: { email: "owner@example.test", password: "synthetic-password" }, asResponse: true });
    const cookies = response.headers.getSetCookie().join(";");
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/Secure/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
    expect(cookies).not.toMatch(/Domain=/i);
  });

  it("serves email login, binds the host tenant, and blocks bypass and CSRF routes", async () => {
    const context = { pool, config, orgs, tenantId: alpha, moduleAccessCookieNames: ["opentenant_module_access_example", "opentenant_module_access_other"] };
    const endpoint = config.baseURL + AUTH_PATH;
    const loginPage = await handleBetterAuthRequest(new Request(endpoint + "/login"), context);
    expect(loginPage.status).toBe(303);
    const loginTarget = new URL(loginPage.headers.get("location")!);
    expect(loginTarget.origin).toBe(new URL(endpoint).origin);
    expect(loginTarget.pathname).toBe("/auth/better-auth/login");
    expect([...loginTarget.searchParams.keys()].sort()).toEqual(["invitation", "return"]);
    expect(loginTarget.searchParams.get("invitation")).toBe("");
    expect(loginTarget.searchParams.get("return")).toBe("/");
    expect(loginPage.headers.get("set-cookie")).toBeNull();
    expect(await loginPage.text()).toBe("");
    const form = new URLSearchParams({ email: "owner@example.test", password: "synthetic-password", action: "login" });
    const request = () => new Request(endpoint + "/login?return=/settings", { method: "POST", headers: { origin: config.baseURL }, body: form });
    const response = await handleBetterAuthRequest(request(), context);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings");
    const cookie = response.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
    expect((await gateway.validateSession(cookie, alpha)).status).toBe("valid");
    expect((await gateway.validateSession(cookie, beta)).status).toBe("tenant_mismatch");
    const denied = await handleBetterAuthRequest(new Request(endpoint + "/organization/create", { method: "POST", headers: { origin: config.baseURL, cookie } }), context);
    expect(denied.status).toBe(404);
    expect((await handleBetterAuthRequest(new Request(endpoint + "/login", { method: "POST", body: form }), context)).status).toBe(403);
    const signout = await handleBetterAuthRequest(new Request(endpoint + "/sign-out", { method: "POST", headers: { origin: config.baseURL, cookie } }), context);
    expect(signout.status).toBe(303);
    for (const name of context.moduleAccessCookieNames) expect(signout.headers.get("set-cookie")).toContain(`${name}=`);
    expect((await gateway.validateSession(cookie, alpha)).status).toBe("invalid");
  });
  it("accepts an invitation only on its mapped tenant host", async () => {
    const id = await gateway.invite(invitation);
    const ref = await accounts.externalRefForMembershipId(id);
    const response = await handleBetterAuthRequest(new Request(config.baseURL + AUTH_PATH + "/login?invitation=" + ref!.externalId, {
      method: "POST", headers: { origin: config.baseURL },
      body: new URLSearchParams({ action: "signup", name: "New Member", email: invitation.email, password: "synthetic-password" }),
    }), { pool, config, orgs, tenantId: alpha });
    expect(response.status).toBe(303);
    const cookie = response.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
    const session = await gateway.validateSession(cookie, alpha);
    expect(session.status === "valid" && session.session.activeRole).toBe("tenant_member");
  });

  it("projects configured SCIM subjects and revokes only directory-owned membership", async () => {
    const user = await auth.api.signUpEmail({ body: { name: "Directory Member", email: "directory@example.test", password: "synthetic-password" } });
    const directory = { id: "directory-test", organizationId: org, token: "synthetic-directory-bearer-token-over-32-characters", subjects: { "immutable-directory-subject": user.user.id } };
    const context = { pool, config: { ...config, directory }, orgs, tenantId: alpha };
    const endpoint = config.baseURL + AUTH_PATH + "/scim/v2/Users";
    const body = { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], externalId: "immutable-directory-subject", userName: "directory@example.test", displayName: "Directory Member", emails: [{ value: "directory@example.test", primary: true }], active: true };
    const request = (url: string, method: string, data?: object) => new Request(url, { method, headers: { authorization: `Bearer ${directory.token}`, "content-type": "application/scim+json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const created = await handleBetterAuthRequest(request(endpoint, "POST", body), context);
    expect(created.status).toBe(201);
    const resource = await created.json() as { id: string };
    expect((await pool.query('select role, "scimManaged" from ba_member where "userId" = $1', [user.user.id])).rows).toEqual([{ role: "member", scimManaged: true }]);
    expect((await handleBetterAuthRequest(request(endpoint, "POST", { ...body, externalId: "unmapped" }), context)).status).toBeGreaterThanOrEqual(400);
    const signed = await auth.api.signInEmail({ body: { email: "directory@example.test", password: "synthetic-password" }, asResponse: true });
    const cookie = signed.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
    expect((await gateway.validateSession(cookie, alpha)).status).toBe("valid");
    const removed = await handleBetterAuthRequest(request(endpoint + "/" + resource.id, "DELETE"), context);
    expect(removed.status).toBe(204);
    expect((await gateway.validateSession(cookie, alpha)).status).toBe("invalid");
    expect((await pool.query('select * from ba_member where "userId" = $1', [subject])).rows).toHaveLength(1);
  });

  it("delivers verification through the mail hook and preserves the safe redirect", async () => {
    let verificationUrl = "";
    const mailAuth = createBetterAuth(pool, config, { sendVerificationEmail: async (message) => { verificationUrl = message.url; } });
    const user = await mailAuth.api.signUpEmail({ body: { name: "Verified Member", email: "verify@example.test", password: "synthetic-password" } });
    const url = new URL(verificationUrl);
    url.searchParams.set("callbackURL", "/");
    const response = await handleBetterAuthRequest(new Request(url), { pool, config, orgs, tenantId: null });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!, config.baseURL).origin).toBe(config.baseURL);
    expect((await pool.query('select "emailVerified" from ba_user where id = $1', [user.user.id])).rows[0]?.emailVerified).toBe(true);
  });

});

identityGatewayContract("Better Auth", async () => {
  const userId = invitation.invitedBy;
  await pool.query(`insert into tenants (tenant_id,slug,display_name,status,data_region) select 'ten_page_' || n,'page-' || n,'Page','active','us' from generate_series(1,100) n on conflict do nothing`);
  await pool.query(`insert into ba_organization (id,name,slug,"createdAt") select 'page-org-' || n,'Page','page-org-' || n,now() from generate_series(1,100) n`);
  await pool.query(`insert into identity_org_mappings select 'ten_page_' || n,'better-auth','page-org-' || n from generate_series(1,100) n`);
  await pool.query(`insert into ba_member (id,"organizationId","userId",role,"createdAt") select 'page-member-' || n,'page-org-' || n,$1,'member',now() from generate_series(1,100) n`, [subject]);
  // Real SQL pagination, including a terminal empty page.
  const pageReads: string[] = [];
  const query = pool.query.bind(pool);
  const db = { query: async (...args: Parameters<typeof query>) => {
    if (typeof args[0] === "string" && args[0].includes("limit")) pageReads.push(String(args[1]));
    return query(...args);
  } } as unknown as Pool;
  const tested = new BetterAuthIdentityGateway(auth, db, orgs, accounts);
  return {
    gateway: tested, tenantId: alpha, otherTenantId: beta, userId, token: credential,
    mutable: true, expectedMembershipCount: 101, expectedMemberCount: 1, pageReads,
    async failProvider() { db.query = async () => { throw new Error("secret-canary"); }; },
    async foreignSubject() {
      await pool.query(`insert into ba_user (id,name,email,"emailVerified","createdAt","updatedAt") values ('foreign-subject','Foreign','foreign@example.test',true,now(),now())`);
      await pool.query('delete from ba_member where "userId"=$1', [subject]);
      await pool.query(`insert into ba_member (id,"organizationId","userId",role,"createdAt") values ('foreign-membership',$1,'foreign-subject','member',now())`, [org]);
    },
    async ambiguousMembership() { await pool.query(`update ba_member set role='owner,member' where "userId"=$1 and "organizationId"=$2`, [subject, org]); },
  };
});
}
