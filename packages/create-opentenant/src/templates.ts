// Original OpenTenant templates. No third-party implementation source copied.
export const composition = `import { defineModules } from '@opentenant/module-sdk';
// module-audit-exclude: generated host composition declares installed packages, like opentenant-modules.ts.
import { ASSESSMENT_MODULE } from '@opentenant/assessment/manifest';
import { BRAIN_MODULE } from '@opentenant/brain/manifest';
import { SUPPORT_MODULE } from '@opentenant/support/manifest';
export const installedModules = defineModules([ASSESSMENT_MODULE, BRAIN_MODULE, SUPPORT_MODULE]);
`;
export const config = `export interface HostConfig { identity: 'local' | 'better-auth'; provisioning: 'postgres'; tenantId: string; slug: string; adminDatabaseUrl: string; port: number; }
export function hostConfig(env: NodeJS.ProcessEnv): HostConfig {
  const identity = env.IDENTITY_PROVIDER ?? '__IDENTITY__';
  if (!['local', 'better-auth'].includes(identity)) throw new Error('Invalid identity');
  const adminDatabaseUrl = env.POSTGRES_ADMIN_DATABASE_URL;
  if (!adminDatabaseUrl || !['postgres:', 'postgresql:'].includes(new URL(adminDatabaseUrl).protocol)) throw new Error('Set POSTGRES_ADMIN_DATABASE_URL');
  const slug = env.TENANT_SLUG ?? '__NAME__';
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) throw new Error('Invalid tenant slug');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  return { identity: identity as HostConfig['identity'], provisioning: 'postgres', tenantId: 'tenant_' + slug.replaceAll('-', '_'), slug, adminDatabaseUrl, port };
}
export const config = hostConfig(process.env);
`;
export const setup = `import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { applyMigrations } from '@opentenant/migrations';
import { loadControlPlaneMigrations } from '@opentenant/migrations/control-plane';
import { PostgresProvisioner, prepareTenantDatabase, createPostgresAppRole } from '@opentenant/provisioning';
import { seedModuleCatalog } from '@opentenant/platform-core';
import { installedModules } from './opentenant-modules.ts';
import { createBetterAuth, BetterAuthIdentityGateway } from '@opentenant/auth-better-auth';
import { PgTenantOrgResolver, PgAccountLinkStore } from '@opentenant/database';
import { config } from './config.ts';
const provisioner = new PostgresProvisioner(config.adminDatabaseUrl, 'synthetic-local');
const project = await provisioner.createTenantProject(config.slug, 'eu');
const control = await provisioner.createTenantProject(config.slug + '-control', 'eu');
const owner = new Pool({ connectionString: control.connectionUri });
const identitySecret = randomBytes(32).toString('hex');
try {
  await applyMigrations(owner, await loadControlPlaneMigrations());
  await seedModuleCatalog(installedModules, owner);
  await owner.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values($1,$2,'Example Organisation','active','eu') on conflict(tenant_id) do nothing", [config.tenantId, config.slug]);
  await prepareTenantDatabase(project.connectionUri, config.tenantId, 'eu');
  const tenantOwner = new Pool({ connectionString: project.connectionUri });
  try { for (const catalog of installedModules.migrations.tenant) await applyMigrations(tenantOwner, catalog); } finally { await tenantOwner.end(); }
  if (config.identity === 'better-auth') {
    const auth = createBetterAuth(owner, { baseURL: 'http://localhost:' + config.port, secret: identitySecret, production: false });
    const gateway = new BetterAuthIdentityGateway(auth, owner, new PgTenantOrgResolver(owner, 'better-auth'), new PgAccountLinkStore(owner, 'better-auth'));
    const exists = await owner.query('select tenant_id from identity_org_mappings where tenant_id=$1', [config.tenantId]);
    if (!exists.rowCount) {
      const password = randomBytes(24).toString('base64url');
      const signup = await auth.api.signUpEmail({ body: { name: 'Example Owner', email: 'owner@example.test', password } });
      const org = await gateway.createOrganization('Example Organisation');
      await owner.query("insert into identity_org_mappings values($1,'better-auth',$2)", [config.tenantId, org]);
      await owner.query('insert into ba_member(id,"organizationId","userId",role,"createdAt") values($1,$2,$3,$4,now())', [randomBytes(16).toString('hex'), org, signup.user.id, 'owner']);
      await writeFile('.opentenant-demo-identity.json', JSON.stringify({ email: 'owner@example.test', password }), { mode: 0o600 });
    }
  }
  const { appConnectionUri } = await createPostgresAppRole(project.connectionUri);
  // Local synthetic demo only. Tenant requests use the restricted role.
  // The separate control-plane identity pool uses the operator connection.
  await writeFile('.opentenant-runtime.json', JSON.stringify({ appConnectionUri, controlConnectionUri: control.connectionUri, identitySecret }), { mode: 0o600 });
  console.log('Canonical migrations applied; one synthetic tenant provisioned with forced RLS.');
} finally { await owner.end(); }
`;
export const server = `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from './config.ts';
import { handleBetterAuthRequest, createBetterAuth, BetterAuthIdentityGateway } from '@opentenant/auth-better-auth';
import { LocalIdentityGateway } from '@opentenant/auth';
import { PgTenantOrgResolver, PgAccountLinkStore } from '@opentenant/database';
import { installedModules } from './opentenant-modules.ts';
const binding = JSON.parse(await readFile('.opentenant-runtime.json', 'utf8'));
const pool = new Pool({ connectionString: binding.appConnectionUri, max: 2 });
const control = new Pool({ connectionString: binding.controlConnectionUri, max: 2 });
const origin = 'http://localhost:' + config.port;
const identityConfig = { baseURL: origin, secret: binding.identitySecret, production: false };
const identity = config.identity === 'better-auth'
  ? new BetterAuthIdentityGateway(createBetterAuth(control, identityConfig), control, new PgTenantOrgResolver(control, 'better-auth'), new PgAccountLinkStore(control, 'better-auth'))
  : new LocalIdentityGateway({ origin, sessionToken: binding.identitySecret, tenantId: config.tenantId as import('@opentenant/auth').TenantId, userId: 'user_demo' as import('@opentenant/auth').UserId, email: 'owner@example.test', displayName: 'Example Owner', permissions: [] });
// This minimal host exposes a public synthetic welcome page. Add authenticated
// module-host ports before serving real tenant content. The full platform has those ports.
const server = createServer(async (req, res) => {
  if (req.url === '/auth/local' && config.identity === 'local') {
    res.writeHead(303, { location: '/', 'set-cookie': 'opentenant_session=' + binding.identitySecret + '; Path=/; HttpOnly; SameSite=Lax' }).end(); return;
  }
  if (req.url === '/session') {
    const credential = config.identity === 'better-auth' ? req.headers.cookie ?? '' : /(?:^|; )opentenant_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    const result = await identity.validateSession(credential, config.tenantId as import('@opentenant/auth').TenantId);
    res.writeHead(result.status === 'valid' ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ authenticated: result.status === 'valid' })); return;
  }

  if (config.identity === 'better-auth' && req.url?.startsWith('/api/auth/better-auth/')) {
    const origin = 'http://localhost:' + config.port;
    if (req.headers.host !== 'localhost:' + config.port && req.headers.host !== '127.0.0.1:' + config.port) { res.writeHead(403).end(); return; }
    const parts: Buffer[] = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) { res.writeHead(413).end(); return; } parts.push(chunk); }
    const headers = new Headers(); for (const [key,value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key,value);
    const request = new Request(origin + req.url, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(parts) } : {}) });
    const response = await handleBetterAuthRequest(request, { pool: control, config: { secret: binding.identitySecret, baseURL: origin, production: false }, orgs: new PgTenantOrgResolver(control, 'better-auth'), tenantId: config.tenantId as import('@opentenant/auth').TenantId });
    res.statusCode = response.status; response.headers.forEach((value,key) => { if (key !== 'set-cookie') res.setHeader(key,value); }); res.setHeader('set-cookie',response.headers.getSetCookie()); res.end(Buffer.from(await response.arrayBuffer())); return;
  }
  if (req.url !== '/' && req.url !== '/health') { res.writeHead(404).end(); return; }
  const client = await pool.connect();
  try {
    await client.query('begin'); await client.query("select set_config('app.tenant_id',$1,true)", [config.tenantId]);
    const rows = await client.query('select tenant_id from tenant_core.tenant_meta where tenant_id=$1', [config.tenantId]);
    if (rows.rowCount !== 1) throw new Error('Tenant unavailable');
    await client.query('commit');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
    res.end('<!doctype html><title>Example Organisation</title><h1>Example Organisation</h1><p>Synthetic tenant ready.</p><p>Identity configuration: ' + config.identity + '</p><p>Installed modules: ' + installedModules.modules.map(m => m.manifest.key).join(', ') + '</p>');
  } catch { await client.query('rollback'); res.writeHead(503).end('Tenant unavailable'); } finally { client.release(); }
});
server.listen(config.port, '127.0.0.1');
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => { server.closeAllConnections(); server.close(() => { void Promise.all([pool.end(), control.end()]); }); });
`;
export const compose = `services:
  postgres:
    image: pgvector/pgvector:0.8.2-pg17-bookworm
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set a local password}
    ports: ["127.0.0.1:\${POSTGRES_PORT:-55432}:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 3s
      retries: 30
`;
export const environment = `# Placeholders only. Use a disposable database for the synthetic seed.
POSTGRES_PASSWORD=REPLACE_WITH_LOCAL_RANDOM_VALUE
POSTGRES_ADMIN_DATABASE_URL=postgresql://postgres:REPLACE_WITH_LOCAL_RANDOM_VALUE@127.0.0.1:55432/postgres
IDENTITY_PROVIDER=__IDENTITY__
PORT=3000
`;
