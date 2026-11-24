// Executed by the production TypeScript loader, outside Playwright's loader.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { inspectProvisionedDatabase } from "./provisioned-database.ts";
import { applyMigrations } from "@opentenant/migrations";
import { loadControlPlaneMigrations } from "@opentenant/migrations/control-plane";
import { PgAccountLinkStore } from "@opentenant/database";
import { createBetterAuth } from "@opentenant/auth-better-auth";
import { identityGateway } from "../../apps/platform/lib/identity.ts";
import { controlPlanePool, withControlPlaneTransaction } from "../../apps/platform/lib/control-plane.ts";
import { queueTenantJob } from "../../apps/platform/lib/tenant-worker-store.ts";
import { claimTenantOwnerInvite } from "../../apps/platform/lib/tenant-owner-invite.ts";
import { tenantWorkerTasks } from "../../apps/platform/workflows/tenant-worker.ts";
import { defineModules, defineModule } from "@opentenant/module-sdk";
import { installedModules } from "../../apps/platform/opentenant-modules.ts";
import { seedModuleCatalog } from "@opentenant/platform-core";
import { tenants } from "./tenants.mjs";
const require = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
const { runMigrations, runOnce } = require("graphile-worker");
const fixtureModules = defineModules([...installedModules.modules, defineModule({
  manifest: { key: "e2e-stub", version: "1.0.0", runtime: "remote", permissions: [], navigation: [] },
  routes: [], adminPages: [], settingsPanels: [], migrations: { controlPlane: [], tenant: [] },
  permissions: { declared: [], roles: {} }, catalog: { displayName: "Example local module", enabledByDefault: false },
})]);
export async function provisionFixtures({ extraTenants = [], hostSuffix = "example.test", pendingSlugs = [], afterSeed = async () => {} } = {}) {
const db = controlPlanePool();
const once = () => runOnce({ pgPool: db, taskList: tenantWorkerTasks, concurrency: 1, noHandleSignals: true });

const accounts = new PgAccountLinkStore(db, "better-auth");
const fixtures = [{ slug: "workspace", tenantId: "tenant_e2e", displayName: "Example Organisation", email: "admin@example.test", name: "Example Admin" }, ...[...tenants, ...extraTenants].map(t => ({ ...t, email: `${t.slug}@example.test`, name: `${t.displayName} Owner` }))];
try {
  await applyMigrations(db, await loadControlPlaneMigrations());
  await runMigrations({ pgPool: db });
  // Installation configuration: these native modules are available by default.
  // Tenant schemas, role grants and database bindings are worker-owned.
  const catalogClient = await db.connect();
  try {
    await catalogClient.query("begin");
  await seedModuleCatalog(installedModules, catalogClient);
  for (const definition of fixtureModules.modules.filter(m => m.manifest.runtime === "remote")) {
    const { key, version, runtime } = definition.manifest;
    await catalogClient.query("insert into module_catalog(module_key,version,runtime,enabled_by_default,ownership_scope,remote_url,authorization_manifest) values($1,$2,$3,false,'platform','https://module.example.test/',$4)", [key, version, runtime, JSON.stringify(definition.manifest)]);
    await catalogClient.query("insert into module_versions(module_key,version,artifact_digest,remote_url) values($1,$2,$3,'https://module.example.test/')", [key, version, "a".repeat(64)]);
  }
    await catalogClient.query("commit");
  } catch (error) { await catalogClient.query("rollback"); throw error; }
  finally { catalogClient.release(); }
  await db.query("update module_catalog set enabled_by_default=true where module_key=any($1::text[])", [installedModules.modules.map(m => m.manifest.key)]);
  const auth = createBetterAuth(db, { secret: process.env.BETTER_AUTH_SECRET, baseURL: process.env.LOCAL_PUBLIC_ORIGIN, production: false });
  const cookies = {};
  let actor;
  for (const fixture of fixtures) {
    const signup = await auth.api.signUpEmail({ body: { email: fixture.email, name: fixture.name, password: process.env.E2E_PASSWORD } });
    const userId = await accounts.userIdForExternalSubject(signup.user.id, fixture.email, fixture.name);
    if (!actor) {
      actor = { kind: "installation_owner", userId };
      await db.query("update platform_users set is_platform_admin=true where user_id=$1", [userId]);
    }
    await withControlPlaneTransaction(async client => {
      await client.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values ($1,$2,$3,'provisioning','eu')", [fixture.tenantId, fixture.slug, fixture.displayName]);
      await client.query("insert into domains(host,tenant_id,kind,verification,active) values ($1,$2,'opentenant_subdomain','verified',true)", [`${fixture.slug}.${hostSuffix}`, fixture.tenantId]);
      const injection = ";--injected:red;background:url(https://example.test)";
      await client.query("insert into brand_policies(tenant_id,defaults) values ($1,$2)", [fixture.tenantId, JSON.stringify({ displayName: fixture.displayName, ...fixture.colorPrimary ? { colorPrimary: fixture.colorPrimary } : {}, ...fixture.slug === "hostile" ? { colorBackground: injection, colorForeground: fixture.colorPrimary, fontFamilyBody: injection, fontFamilyHeading: fixture.colorPrimary } : {} })]);
      await client.query("insert into tenant_modules(tenant_id,module_key,module_version,enabled) select $1,module_key,version,true from module_catalog where module_key=any($2::text[])", [fixture.tenantId, fixtureModules.modules.filter(m => m.catalog.enabledByDefault || m.manifest.runtime === "native" || fixture.slug === "workspace").map(m => m.manifest.key)]);
      await queueTenantJob(client, { tenantId: fixture.tenantId, kind: "provision", actor, input: { ownerEmail: fixture.email } });
    });
    if (fixture.slug === "workspace") {
      await db.query("insert into developer_mcp.switches values('installation',true),('tenant:tenant_e2e',true)");
      await db.query("insert into developer_mcp.projects(id,tenant_id,user_id,client_id,profile,consent_scopes,active) values($1,'tenant_e2e',$2,'browser-example','developer.builder@1',array['module.dev.workspace.create','module.dev.preview.open'],true)", ["c".repeat(32), userId]);
      await db.query("insert into developer_mcp.oauth_clients values('browser-example','http://127.0.0.1:3123/callback')");
    }
    await once();
    const job = await db.query("select status from tenant_worker_jobs where tenant_id=$1 and kind='provision'", [fixture.tenantId]);
    if (job.rows[0]?.status !== "completed") throw new Error("Fixture provisioning job did not complete");
    if (pendingSlugs.includes(fixture.slug)) continue;
    const response = await auth.api.signInEmail({ body: { email: fixture.email, password: process.env.E2E_PASSWORD }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
    const invitation = await db.query('select id from ba_invitation where email=$1 and status=\'pending\'', [fixture.email]);
    await auth.api.acceptInvitation({ body: { invitationId: invitation.rows[0].id }, headers: new Headers({ cookie }) });
    const org = await db.query("select external_organization_id from identity_org_mappings where tenant_id=$1", [fixture.tenantId]);
    await auth.api.setActiveOrganization({ body: { organizationId: org.rows[0].external_organization_id }, headers: new Headers({ cookie }) });
    const invite = await db.query("select id from tenant_owner_invites where tenant_id=$1", [fixture.tenantId]);
    const claim = JSON.parse(await readFile(join(process.env.TENANT_OWNER_INVITE_DIRECTORY, `${invite.rows[0].id}.json`), "utf8"));
    const session = await identityGateway().validateSession(cookie, fixture.tenantId);
    if (session.status !== "valid") throw new Error("Fixture identity unavailable");
    await claimTenantOwnerInvite(fixture.tenantId, claim.token, session.session);
    await once();
    cookies[fixture.slug] = cookie.split("=", 2)[1];
  }
  // Assert all three canonical schemas exist through the stored runtime binding.
  for (const { tenantId } of fixtures) {
    const proof = await inspectProvisionedDatabase(db, tenantId);
    if (proof.schemas.join(",") !== "brain,support,tenant_core" || proof.role.rolsuper || proof.role.rolbypassrls) throw new Error("Incomplete provisioned tenant");
  }
  await afterSeed({ db, auth, accounts, fixtures, cookies, actor, once });
  await writeFile(join(process.env.E2E_DIRECTORY, "sessions.json"), JSON.stringify(cookies), { mode: 0o600 });
  console.log(`Fixtures: ${fixtures.length} tenants provisioned through Graphile and Better Auth.`);
} finally { await db.end(); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await provisionFixtures();
