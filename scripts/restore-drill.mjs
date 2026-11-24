// Synthetic only. The package script always starts the db:ephemeral harness.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { validateDatabaseUrl, validateConnectedDatabase } from '../tooling/ci/run-database-store-tests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { Pool } = require('pg');
const image = 'pgvector/pgvector:0.8.2-pg17-bookworm';
const inherited = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CI', 'DOCKER_HOST', 'DOCKER_CONTEXT'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
let phase = 'disposable database validation';

// Async children keep the db:ephemeral loopback proxy responsive. Never log
// command arguments, database errors or child stderr, which may contain secrets.
async function command(binary, args, { env = inherited, input, output, capture = false } = {}) {
  const child = spawn(binary, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300_000 });
  const chunks = [];
  child.stderr.resume();
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Drill child failed')));
  });
  const streams = [finished];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output) streams.push(pipeline(child.stdout, createWriteStream(output, { mode: 0o600, flags: 'wx' })));
  else child.stdout.on('data', chunk => { if (capture) chunks.push(chunk); });
  await Promise.all(streams);
  return Buffer.concat(chunks).toString('utf8');
}

function quoted(value) { return '"' + value.replaceAll('"', '""') + '"'; }
function databaseUrl(adminUrl, name) { const url = new URL(adminUrl); url.pathname = name; return url.href; }

async function postgresTool(binary, args, url, files = {}) {
  const parsed = new URL(url);
  const env = { ...inherited, PGHOST: parsed.hostname, PGPORT: parsed.port, PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.slice(1) };
  // Linux host networking reaches only the harness's random loopback port.
  // No pulls, volumes, Docker socket or application environment enter this client.
  return command('docker', ['run', '--rm', '--pull=never', '--network=host', '-i', ...['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'].flatMap(key => ['-e', key]), image, binary, ...args], { env, ...files });
}

async function migrationChecks(pool, catalog) {
  const expected = catalog.map(m => ({ id: m.id, checksum: createHash('sha256').update(m.sql).digest('hex') })).sort((a, b) => a.id.localeCompare(b.id));
  const actual = (await pool.query('select id, checksum from schema_migrations')).rows.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(actual, expected, 'Restored migration checksums differ from catalog');
  return actual.length;
}

async function rowCounts(pool) {
  const tables = (await pool.query("select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by schemaname, tablename")).rows;
  const counts = {};
  for (const { schemaname, tablename } of tables) counts[`${schemaname}.${tablename}`] = (await pool.query(`select count(*)::text as n from ${quoted(schemaname)}.${quoted(tablename)}`)).rows[0].n;
  return counts;
}

async function verifyRuntime(appUrl, owner, tenantId, otherId, otherDatabase) {
  const app = new Pool({ connectionString: appUrl, max: 1 });
  try {
    const flags = (await app.query('select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=current_user')).rows[0];
    assert.ok(Object.values(flags).every(value => value === false), 'Runtime role is elevated');
    const tables = (await owner.query("select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' where c.relkind='r' and n.nspname in ('tenant_core','brain','support')")).rows;
    assert.ok(tables.length > 0);
    for (const table of tables) assert.ok(table.relrowsecurity && table.relforcerowsecurity, 'Restored tenant table lost forced RLS');
    for (const table of tables) assert.equal((await app.query(`select * from ${quoted(table.nspname)}.${quoted(table.relname)}`)).rowCount, 0, 'Missing tenant context allowed reads');
    await app.query('begin');
    await app.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    assert.equal((await app.query('select * from support.tickets')).rowCount, 4, 'Own synthetic tickets are missing');
    assert.equal((await app.query('select * from support.tickets where tenant_id=$1', [otherId])).rowCount, 0);
    await app.query("select set_config('app.tenant_id',$1,true)", [otherId]);
    // The database anchor rejects a forged tenant context, even with a valid login.
    for (const table of tables) assert.equal((await app.query(`select * from ${quoted(table.nspname)}.${quoted(table.relname)}`)).rowCount, 0, 'Forged context allowed cross-tenant reads');
    await app.query('rollback');
    const foreignUrl = new URL(appUrl); foreignUrl.pathname = otherDatabase;
    const foreign = new Pool({ connectionString: foreignUrl.href, connectionTimeoutMillis: 5000 });
    try { await assert.rejects(foreign.query('select 1'), { code: '42501' }); }
    finally { await foreign.end(); }
    return tables.length;
  } finally { await app.end(); }
}

async function drill() {
  assert.equal(process.platform, 'linux', 'Drill client requires Linux Docker host networking');
  const adminConfig = validateDatabaseUrl(process.env.ADMIN_DATABASE_URL, 'postgres');
  assert.equal(process.env.OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT, '1', 'Use the disposable harness');
  assert.notEqual(adminConfig.port, 5432, 'Never use the default Postgres port');
  const admin = new Pool(adminConfig);
  const reportPath = process.env.RESTORE_DRILL_REPORT;
  const directory = await mkdtemp(join(tmpdir(), 'opentenant-restore-'));
  const suffix = randomBytes(5).toString('hex');
  const controlName = `opentenant_it_restore_${suffix}`;
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const controlUrl = databaseUrl(adminUrl, controlName);
  const tenants = ['alpha', 'beta'].map(name => ({ tenantId: `tenant_drill_${name}`, tenantSlug: `drill-${name}-${suffix}`, dataRegion: 'us' }));
  const targets = [];
  let control;
  let provider;
  let shared;
  try {
    const validationClient = await admin.connect();
    try { await validateConnectedDatabase(validationClient, { ...adminConfig, allowUnixSocketServer: process.env.OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT === '1' }); }
    finally { validationClient.release(); }
    const keyring = { TENANT_DB_ENCRYPTION_KEYS: `drill:${randomBytes(32).toString('base64')}`, TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: 'drill' };
    // Remove inherited provider and key configuration before loading composition.
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(inherited, key)) delete process.env[key];
    Object.assign(process.env, inherited, keyring, { NODE_ENV: 'test', IDENTITY_PROVIDER: 'local', PROVISIONING_PROVIDER: 'postgres', CONTROL_PLANE_DATABASE_URL: controlUrl, POSTGRES_ADMIN_DATABASE_URL: adminUrl, POSTGRES_TENANT_REGION: 'synthetic-loopback' });
    const { CredentialCipher, PgAuditStore } = await import('../packages/database/src/index.ts');
    const { PostgresProvisioner } = await import('../tooling/provisioning/src/index.ts');
    const { provisionTenantProject } = await import('../apps/platform/lib/provisioning.ts');
    const { applyMigrations } = await import('../tooling/migrations/src/runner.ts');
    const { loadControlPlaneMigrations } = await import('../tooling/migrations/src/local.mjs');
    const { TENANT_CORE_MIGRATIONS } = await import('../tooling/migrations/src/tenant-core.ts');
    const { TENANT_MODULE_CATALOGS } = await import('../tooling/migrations/src/tenant-modules.ts');
    const controlCatalog = await loadControlPlaneMigrations();
    const tenantCatalog = [...TENANT_CORE_MIGRATIONS, ...TENANT_MODULE_CATALOGS.flat()];
    provider = new PostgresProvisioner(adminUrl, 'synthetic-loopback');
    phase = 'canonical control-plane migrations and real Postgres provisioning';
    await admin.query(`create database ${quoted(controlName)}`);
    control = new Pool({ connectionString: controlUrl });
    await applyMigrations(control, controlCatalog);
    targets.push({ name: controlName, url: controlUrl, catalog: controlCatalog });
    const cipher = CredentialCipher.fromEnv(keyring);
    for (const tenant of tenants) {
      await control.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ($1,$2,'Synthetic restore drill','provisioning','us')", [tenant.tenantId, tenant.tenantSlug]);
      const { projectId } = await provisionTenantProject(tenant);
      const url = await provider.getConnectionUri(projectId);
      targets.push({ name: projectId, url, catalog: tenantCatalog });
      const pool = new Pool({ connectionString: url });
      try {
        for (let number = 1; number <= 4; number++) await pool.query("insert into support.tickets (tenant_id,ticket_number,created_by,subject,description) values ($1,$2,'user_synthetic','Synthetic restore ticket','Never real data')", [tenant.tenantId, `SUP-${String(number).padStart(6, '0')}`]);
      } finally { await pool.end(); }
    }
    const audit = new PgAuditStore(control);
    for (const tenantId of [null, ...tenants.map(t => t.tenantId)]) for (let i = 0; i < 3; i++) await audit.append({ tenantId, occurredAt: new Date(), actor: { kind: 'system', id: 'restore-drill' }, action: 'restore.drill.synthetic', subject: 'synthetic-fixture', detail: { synthetic: true, index: i } });
    const lastCommittedAt = Date.now(); // Workload is now quiesced; no post-backup writes.
    phase = 'pre-backup external signed checkpoints';
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const auditEnv = { ...inherited, NODE_OPTIONS: `--import=${new URL('../tooling/provisioning/register.mjs', import.meta.url).href}`, AUDIT_DATABASE_URL: controlUrl, AUDIT_CHECKPOINT_ORIGIN: `example.test/restore-drill/${suffix}`, AUDIT_CHECKPOINT_DIRECTORY: join(directory, 'checkpoints'), AUDIT_CHECKPOINT_SINK: 'file', AUDIT_CHECKPOINT_PUBLIC_KEYS: JSON.stringify({ drill: publicKey.export({ type: 'spki', format: 'pem' }) }) };
    const anchored = await command('pnpm', ['audit:anchor'], { env: { ...auditEnv, AUDIT_CHECKPOINT_KEY_ID: 'drill', AUDIT_CHECKPOINT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, capture: true });
    assert.match(anchored, /anchored 3 audit scopes/);
    const notes = await readdir(auditEnv.AUDIT_CHECKPOINT_DIRECTORY);
    assert.equal(notes.length, 3);
    const noteHashes = await Promise.all(notes.map(async name => createHash('sha256').update(await readFile(join(auditEnv.AUDIT_CHECKPOINT_DIRECTORY, name))).digest('hex')));
    phase = 'three custom-format logical backups';
    for (const target of targets) {
      const pool = new Pool({ connectionString: target.url });
      try { target.before = await rowCounts(pool); await migrationChecks(pool, target.catalog); }
      finally { await pool.end(); }
      target.archive = join(directory, `${target.name}.dump`);
      await postgresTool('pg_dump', ['-Fc', '--create'], target.url, { output: target.archive });
    }
    shared = globalThis[Symbol.for('opentenant.control-plane-pool')];
    await shared?.end();
    delete globalThis[Symbol.for('opentenant.control-plane-pool')];
    await control.end(); control = undefined;
    phase = 'database destruction and restore into fresh databases';
    const recoveryStarted = performance.now();
    const recoveryPointAgeSeconds = (Date.now() - lastCommittedAt) / 1000;
    for (const target of targets) await admin.query(`drop database ${quoted(target.name)} with (force)`);
    phase = 'pg_restore custom archives';
    for (const target of targets) await postgresTool('pg_restore', ['--create', '--exit-on-error', '--dbname=postgres'], adminUrl, { input: target.archive });
    phase = 'restored counts, migration catalogs, keyring, checkpoints and isolation';
    let tablesChecked = 0;
    let migrationsChecked = 0;
    for (const target of targets) {
      const pool = new Pool({ connectionString: target.url });
      try {
        assert.deepEqual(await rowCounts(pool), target.before, 'Restored table counts differ');
        tablesChecked += Object.keys(target.before).length;
        migrationsChecked += await migrationChecks(pool, target.catalog);
      } finally { await pool.end(); }
    }
    control = new Pool({ connectionString: controlUrl });
    const records = (await control.query('select tenant_id, encrypted_connection from tenant_databases order by tenant_id')).rows;
    assert.equal(records.length, 2);
    let rlsTables = 0;
    for (const [i, tenant] of tenants.entries()) {
      const record = records.find(row => row.tenant_id === tenant.tenantId);
      const appUrl = cipher.decrypt(record.encrypted_connection.toString('utf8'), tenant.tenantId);
      assert.throws(() => cipher.decrypt(record.encrypted_connection.toString('utf8'), tenants[1-i].tenantId));
      const owner = new Pool({ connectionString: targets[i+1].url });
      try { rlsTables += await verifyRuntime(appUrl, owner, tenant.tenantId, tenants[1-i].tenantId, targets[2-i].name); }
      finally { await owner.end(); }
    }
    // No signing key is supplied after destruction, and no checkpoints are re-anchored.
    const verified = await command('pnpm', ['audit:verify'], { env: auditEnv, capture: true });
    assert.match(verified, /verified 3 audit scopes/);
    assert.deepEqual(await Promise.all(notes.map(async name => createHash('sha256').update(await readFile(join(auditEnv.AUDIT_CHECKPOINT_DIRECTORY, name))).digest('hex'))), noteHashes);
    const report = { synthetic: true, databases: 3, tickets: 8, auditEvents: 9, signedScopes: 3, migrationsChecked, tablesChecked, forcedRlsTables: rlsTables, decryptedConnections: 2, lostRows: 0, measuredRpoSeconds: 0, measuredRtoSeconds: Number(((performance.now() - recoveryStarted) / 1000).toFixed(3)), recoveryPointAgeSeconds, rpoMethod: 'Quiesced synthetic workload; every pre-backup table count recovered. No post-backup writes.', rtoMethod: 'Before database destruction through successful verification.', productionTargets: 'Owner-decided' };
    console.log(JSON.stringify(report, null, 2));
    if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  } finally {
    await control?.end();
    const cached = globalThis[Symbol.for('opentenant.control-plane-pool')];
    if (cached && cached !== shared) await cached.end();
    delete globalThis[Symbol.for('opentenant.control-plane-pool')];
    if (provider) for (const tenant of tenants) {
      const found = await provider.findProjectByName(`opentenant-tenant-${tenant.tenantSlug}`);
      if (found) await provider.deleteProject(found.projectId);
    }
    await admin.query(`drop database if exists ${quoted(controlName)} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}

try { await drill(); }
catch { console.error(`restore-drill FAILED during ${phase}. No proof was skipped; credentials and database errors are suppressed.`); process.exitCode = 1; }
