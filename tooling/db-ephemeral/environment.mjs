import { STORE_SUITES } from '../ci/run-database-store-tests.mjs';

export const INTEGRATION_DATABASES = {
  RATE_LIMIT_DATABASE_URL: "opentenant_it_rate_limits",
  OBSERVABILITY_DATABASE_URL: "opentenant_it_observability",
  TENANT_WORKER_DATABASE_URL: 'opentenant_it_tenant_worker',
  USAGE_EXPORT_DATABASE_URL: 'opentenant_it_usage_export',
  CONTROL_PLANE_INTEGRATION_DATABASE_URL: 'opentenant_it_control_plane',
  TENANT_CORE_INTEGRATION_DATABASE_URL: 'opentenant_it_tenant_core',
  TENANT_SUPPORT_INTEGRATION_DATABASE_URL: 'opentenant_it_tenant_support',
  PROVISIONING_CONTROL_DATABASE_URL: 'opentenant_it_provisioning_control',
  PROVISIONING_TENANT_DATABASE_URL: 'opentenant_it_provisioning_tenant',
};

/** @param {string} adminUrl @param {NodeJS.ProcessEnv} source */
export function proofEnvironment(adminUrl, source) {
  const environment = { ...source, OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT: process.platform === "linux" ? "1" : "0", ADMIN_DATABASE_URL: adminUrl, DATABASE_URL: adminUrl };
  const databases = { ...INTEGRATION_DATABASES, ...Object.fromEntries(STORE_SUITES.map(s => [s.urlVariable, s.database])) };
  for (const [variable, database] of Object.entries(databases)) {
    const url = new URL(adminUrl); url.pathname = `/${database}`;
    environment[variable] = url.toString();
  }
  return environment;
}
