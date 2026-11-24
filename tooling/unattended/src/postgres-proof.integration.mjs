// Explicit live proof, run with node --test. Never silently skips Docker.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preparePostgresProofCluster, buildPostgresProofEnvironment, completePostgresProofCluster, cleanupPostgresProofCluster } from './postgres-proof.mjs';
import { queryPostgres } from '../../db-ephemeral/postgres.mjs';

test('disposable controller cluster restricts SQL and corroborates three real migration cases', async () => {
  const cluster = preparePostgresProofCluster(process.cwd(), 'smoke');
  const home = mkdtempSync(join(tmpdir(), 'ot-proof-report-'));
  try {
    const env = buildPostgresProofEnvironment({ ...process.env, HOME: home }, cluster);
    const url = new URL(`postgresql://opentenant_proof:${env.PGPASSWORD}@localhost:55439/opentenant_it_proof_smoke`);
    url.searchParams.set('host', cluster.socketDirectory);
    for (const sql of ['create database forbidden', 'create role forbidden', "copy (select 1) to program '/usr/bin/true'", 'set role postgres']) {
      await assert.rejects(queryPostgres(url.toString(), sql));
    }
    const report = join(home, 'smoke.json');
    const result = spawnSync('pnpm', ['--filter', '@opentenant/migrations', 'exec', 'vitest', 'run', 'src/control-plane-module-capabilities.integration.test.ts', '--configLoader', 'runner', '--reporter=json', `--outputFile=${report}`], {
      env: { ...env, OPENTENANT_LOCAL_POSTGRES_PROOF: 'smoke', CONTROL_PLANE_INTEGRATION_DATABASE_URL: url.toString() },
      encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, 'restricted migration proof must pass');
    const counts = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(counts.numPassedTests, 3); assert.equal(counts.numPendingTests, 0);
    completePostgresProofCluster(cluster);
  } finally { cleanupPostgresProofCluster(cluster); rmSync(home, { recursive: true, force: true }); }
});

test('empty database fails controller corroboration and is still removed', () => {
  const cluster = preparePostgresProofCluster(process.cwd(), 'smoke');
  try { assert.throws(() => completePostgresProofCluster(cluster), /failed/); }
  finally { assert.equal(cleanupPostgresProofCluster(cluster).retained, false); }
});
