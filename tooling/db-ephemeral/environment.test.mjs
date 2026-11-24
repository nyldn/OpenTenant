import assert from 'node:assert/strict';
import test from 'node:test';
import { proofEnvironment } from './environment.mjs';
import { STORE_SUITES } from '../ci/run-database-store-tests.mjs';

test('exports every CI proof URL without inheriting stale database targets', () => {
  const env = proofEnvironment('postgresql://admin:synthetic@127.0.0.1:55432/postgres', { DATABASE_URL: 'stale' });
  assert.equal(env.ADMIN_DATABASE_URL, env.DATABASE_URL);
  for (const suite of STORE_SUITES) assert.equal(new URL(env[suite.urlVariable]).pathname, `/${suite.database}`);
  for (const variable of ['TENANT_WORKER_DATABASE_URL', 'USAGE_EXPORT_DATABASE_URL', 'CONTROL_PLANE_INTEGRATION_DATABASE_URL', 'TENANT_CORE_INTEGRATION_DATABASE_URL', 'TENANT_SUPPORT_INTEGRATION_DATABASE_URL', 'PROVISIONING_CONTROL_DATABASE_URL', 'PROVISIONING_TENANT_DATABASE_URL']) {
    assert.equal(new URL(env[variable]).port, '55432');
  }
});
