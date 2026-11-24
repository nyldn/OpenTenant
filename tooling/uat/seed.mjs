import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
const { Pool } = createRequire(new URL("../e2e/package.json", import.meta.url))("pg");
import { CredentialCipher } from "../../packages/database/src/credential-cipher.ts";
import { provisionFixtures } from "../e2e/provision-fixtures.mjs";
import { createTicket, addMessage, setStatus } from "../../modules/support/src/ticket-store.ts";
import { validateEngagementDocument, DIMENSION_KEYS } from "../../modules/assessment/src/persistence/engagement-schema.ts";
import { installedModules } from "../../apps/platform/opentenant-modules.ts";
import { rebuildHelpdeskProjection, runHelpdeskProjectionPass } from "../../apps/platform/lib/helpdesk-projection.ts";
import { workerAudit } from "../../apps/platform/lib/tenant-worker-store.ts";
import { seedPrivateBrandAssets, privateBrandAssets } from "./brand-assets.mjs";

const users = [];
const extraTenants = [
  { slug: "fresh", tenantId: "tenant_uat_fresh", displayName: "Example Fresh" },
  { slug: "pending", tenantId: "tenant_uat_pending", displayName: "Example Pending Owner" },
  { slug: "suspended", tenantId: "tenant_uat_suspended", displayName: "Example Suspended" },
];
const permissions = role => [...new Set(installedModules.modules.flatMap(m => m.permissions.roles[role] ?? []))];
const documents = {};
const fixtureEpoch = Date.parse("2026-11-15T12:00:00.000Z");
async function prepareHelpdeskFixture(tenantId, actor) {
  const rebuilt = await rebuildHelpdeskProjection(tenantId, actor);
  if (rebuilt.rebuilt !== 5 || rebuilt.rejected) throw new Error("Incomplete fixture helpdesk projection");
  for (let pass = 0; pass < 10; pass++) {
    const result = await runHelpdeskProjectionPass(tenantId);
    if (result.failed) throw new Error("Fixture projection delivery failed");
    if (!result.claimed) return;
  }
  throw new Error("Fixture projection did not drain within its bound");
}
await provisionFixtures({ extraTenants, hostSuffix: "localhost", pendingSlugs: ["pending"], afterSeed: async ({ db, auth, accounts, fixtures, cookies, actor }) => {
  for (const fixture of fixtures.filter(f => f.slug !== "pending")) {
    const row = (await db.query("select user_id from platform_users where email=$1", [fixture.email])).rows[0];
    users.push({ id: `${fixture.slug}-owner`, slug: fixture.slug, tenant: fixture.tenantId, user: row.user_id, email: fixture.email, name: fixture.name, role: "tenant_owner", isPlatformAdmin: fixture.slug === "workspace", permissions: [...permissions("tenant_owner"), "brand.proposal.upload", "brand.proposal.review"], token: randomBytes(32).toString("hex"), cookie: cookies[fixture.slug] });
  }
  for (const [id, role, slug, platform] of [["tenant-admin", "tenant_admin", "alpha", false], ["tenant-member", "tenant_member", "alpha", false], ["managed-support", null, "alpha", true], ["no-memberships", null, "alpha", false]]) {
    const email = `${id}@example.test`;
    const signup = await auth.api.signUpEmail({ body: { email, name: `Example ${id}`, password: process.env.E2E_PASSWORD } });
    const user = await accounts.userIdForExternalSubject(signup.user.id, email, `Example ${id}`);
    await db.query("update platform_users set is_platform_admin=$2 where user_id=$1", [user, platform]);
    const response = await auth.api.signInEmail({ body: { email, password: process.env.E2E_PASSWORD }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
    if (role) {
      const org = (await db.query("select external_organization_id from identity_org_mappings where tenant_id='tenant_e2e_alpha'")).rows[0].external_organization_id;
      await db.query('insert into ba_member(id,"organizationId","userId",role,"createdAt") values($1,$2,$3,$4,now())', [id, org, signup.user.id, role === "tenant_admin" ? "admin" : "member"]);
      await auth.api.setActiveOrganization({ body: { organizationId: org }, headers: new Headers({ cookie }) });
    }
    users.push({ id, slug, tenant: role ? "tenant_e2e_alpha" : null, user, email, name: `Example ${id}`, role, isPlatformAdmin: platform, permissions: role ? permissions(role) : [], token: randomBytes(32).toString("hex"), cookie: cookie.split("=", 2)[1] });
  }
  await db.query("insert into domains(host,tenant_id,kind,verification,active) values ('admin.localhost','tenant_e2e','opentenant_subdomain','verified',true)");
  await db.query("update tenants set managed_support_enabled=true where tenant_id='tenant_e2e_alpha'");
  await seedPrivateBrandAssets(db);
  await db.query("update tenants set status='suspended' where tenant_id='tenant_uat_suspended'");
  await workerAudit(db, actor, "tenant_uat_suspended", "tenant.suspended", "suspended");
  for (const fixture of fixtures.filter(f => ["workspace", "alpha", "beta"].includes(f.slug))) {
    const owner = users.find(u => u.slug === fixture.slug && u.role === "tenant_owner");
    const binding = (await db.query("select encrypted_connection from tenant_databases where tenant_id=$1", [fixture.tenantId])).rows[0];
    const runtime = new Pool({ connectionString: new CredentialCipher(process.env.TENANT_DB_ENCRYPTION_KEY).decrypt(binding.encrypted_connection.toString("utf8"), fixture.tenantId) });
    const client = await runtime.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true)", [fixture.tenantId]);
      const subjects = ["Invite email did not arrive", "Review workspace access", "Confirm assessment export format", "Brand colour update", "Initial setup walkthrough"];
      const states = ["open", "in_progress", "awaiting_reply", "resolved", "closed"];
      for (let index = 0; index < states.length; index++) {
        const actor = { kind: "user", userId: owner.user };
        const ticket = await createTicket(client, { tenantId: fixture.tenantId, createdBy: owner.user, subject: subjects[index], description: "Synthetic UAT request. Please review the example workspace configuration before the next workshop.", category: "how_to", actor });
        await addMessage(client, { tenantId: fixture.tenantId, ticketId: ticket.id, authorId: owner.user, body: "Example follow-up with reproduction details from the workshop.", actor, internal: false });
        if (states[index] !== "open") await setStatus(client, { tenantId: fixture.tenantId, ticketId: ticket.id, actor, status: states[index] });
        const time = new Date(fixtureEpoch - ["workspace", "alpha", "beta"].indexOf(fixture.slug) * 86400000 + index * 60000).toISOString();
        await client.query("update support.tickets set created_at=$3,updated_at=$3 where tenant_id=$1 and id=$2", [fixture.tenantId, ticket.id, time]);
      }
      await client.query("commit");
    } finally { client.release(); await runtime.end(); }
    await prepareHelpdeskFixture(fixture.tenantId, actor);
    const now = new Date(fixtureEpoch).toISOString();
    const scores = Object.fromEntries([...DIMENSION_KEYS].slice(0, 6).map((key, index) => [key, index % 3 + 2]));
    const document = { schemaVersion: 2, appVersion: "uat-1", tenantId: fixture.tenantId, engagementId: `eng_uat_${fixture.slug}`, brandLabel: fixture.displayName, session: { clientInfo: { name: `${fixture.displayName} Readiness Review`, department: "Operations", operatingProfile: "professional_services", date: now.slice(0, 10), facilitator: "Example Facilitator" }, scores, evidence: { [Object.keys(scores)[0]]: "Workshop notes: a documented process exists; adoption varies between teams." }, currentPillar: 1 }, respondents: [], legacyClaim: null, readout: null, createdAt: now, updatedAt: now };
    if (!validateEngagementDocument(document, fixture.tenantId).ok) throw new Error("Invalid UAT assessment");
    documents[fixture.tenantId] = document;
    await workerAudit(db, actor, fixture.tenantId, "uat.content_seeded", fixture.slug);
  }
  const request = (await db.query("insert into brand_seed_requests(tenant_id,source_url,status) values('tenant_e2e_alpha','https://example.test/uat-brand','completed') returning request_id")).rows[0];
  await db.query("insert into brand_proposals(request_id,tenant_id,proposed_values) values($1,'tenant_e2e_alpha',$2)", [request.request_id, JSON.stringify({ colorPrimary: { value: "#345678", sourceUrl: "https://example.test/uat-brand", retrievedAt: new Date().toISOString() } })]);
  await writeFile(join(process.env.E2E_DIRECTORY, "uat-seed.json"), JSON.stringify({ users, tenants: fixtures.map(f => ({ slug: f.slug, tenantId: f.tenantId, displayName: f.displayName, status: f.slug === "suspended" ? "suspended" : "active", empty: f.slug === "fresh", privateBrandAssetUrl: privateBrandAssets.find(a => a.tenantId === f.tenantId) ? `/api/settings/branding/assets/${privateBrandAssets.find(a => a.tenantId === f.tenantId).id}` : undefined })), documents }), { mode: 0o600 });
} });
