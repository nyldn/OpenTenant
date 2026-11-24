// Explicit Docker proof. Run separately from offline unit tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { startEphemeralPostgres, queryPostgres } from './postgres.mjs';

test('real cluster has no network and an empty restricted app database, then tears down', async () => {
  const db = await startEphemeralPostgres();
  try {
    assert.notEqual(db.port, 5432);
    const mode = spawnSync('docker', ['inspect', db.containerName, '--format', '{{.HostConfig.NetworkMode}}'], { encoding: 'utf8' });
    assert.equal(mode.stdout.trim(), 'none');
    const role = await queryPostgres(db.appUrl, 'select rolsuper, rolbypassrls, rolcreatedb from pg_roles where rolname = current_user');
    assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false, rolcreatedb: false });
    const schema = await queryPostgres(db.appUrl, "select to_regclass('public.schema_migrations') as migrations");
    assert.equal(schema.rows[0].migrations, null);
  } finally { await db.dispose(); }
  await db.dispose();
  assert.notEqual(spawnSync('docker', ['inspect', db.containerName], { stdio: 'ignore' }).status, 0);
});

test('guardian removes resources after SIGKILL of the database owner', async () => {
  const script = `import {startEphemeralPostgres} from ${JSON.stringify(new URL('./postgres.mjs', import.meta.url).href)}; const db=await startEphemeralPostgres(); console.log(db.containerName);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const name = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('database owner exited before startup')));
    child.stdout.once('data', data => resolve(data.toString().trim()));
  });
  assert.match(name, /^opentenant-proof-/);
  child.kill('SIGKILL'); await once(child, 'exit');
  let removed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnSync('docker', ['inspect', name], { stdio: 'ignore' }).status !== 0) { removed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(removed, true);
});
