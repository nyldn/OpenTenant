import assert from 'node:assert/strict';
import test from 'node:test';
import { startEphemeralPostgres, validateHostPort } from './postgres.mjs';

test('rejects port 5432 and invalid host ports', () => {
  for (const port of [5432, 0, -1, 65536, NaN]) assert.throws(() => validateHostPort(port));
  assert.equal(validateHostPort(55432), 55432);
});

test('Docker failure is actionable and never a successful skip', async () => {
  await assert.rejects(startEphemeralPostgres({ start: async () => { throw new Error('offline'); } }), /Docker.*pgvector/);
});

test('validates pgvector and tears down on startup failure', async () => {
  let stopped = 0;
  const container = { getMappedPort: () => 55432, stop: async () => { stopped++; } };
  await assert.rejects(startEphemeralPostgres({ start: async () => container, query: async () => ({ rows: [] }) }), /pgvector/);
  assert.equal(stopped, 1);
});

test('starts empty, returns distinct admin/app URLs and idempotent disposal', async () => {
  let stopped = 0;
  const sql = [];
  const db = await startEphemeralPostgres({
    start: async () => ({ getMappedPort: () => 55432, stop: async () => { stopped++; } }),
    query: async (_url, statement) => { sql.push(statement); return { rows: [{ name: 'vector' }] }; },
  });
  assert.equal(new URL(db.adminUrl).hostname, '127.0.0.1');
  assert.notEqual(db.adminUrl, db.appUrl);
  assert.equal(sql.some(s => /schema_migrations/.test(s)), false);
  await db.dispose(); await db.dispose();
  assert.equal(stopped, 1);
});
