import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createIntegrationDatabases } from "./create-integration-databases.mjs";
import { SEQUENCE_COUNTS } from "./db-sequence-counts.mjs";
import { validateDatabaseUrl, STORE_SUITES } from "./run-database-store-tests.mjs";

// CI and local proofs execute this same ordered inventory. Never inherit suite
// URLs: every destructive suite receives an explicitly assigned database.
export const STEPS = [
  { id: "stores", command: ["pnpm", "database:store-proof"], databases: Object.fromEntries(STORE_SUITES.map(s => [s.urlVariable, s.database])) },
  { id: "custom-domains", filter: "platform", files: ["lib/custom-domains.integration.test.ts"], databases: { CUSTOM_DOMAINS_DATABASE_URL: "opentenant_it_control_plane" } },
  { id: "authorization-outbox", filter: "platform", files: ["lib/authz-outbox.integration.test.ts"], databases: { CONTROL_PLANE_INTEGRATION_DATABASE_URL: "opentenant_it_control_plane" } },
  { id: "provisioning-neon", filter: "platform", files: ["lib/provisioning.integration.test.ts"], databases: { PROVISIONING_CONTROL_DATABASE_URL: "opentenant_it_provisioning_control", PROVISIONING_TENANT_DATABASE_URL: "opentenant_it_provisioning_tenant" } },
  { id: "provisioning-postgres", filter: "platform", files: ["lib/provisioning-postgres.integration.test.ts"], databases: { PROVISIONING_CONTROL_DATABASE_URL: "opentenant_it_postgres_control", PROVISIONING_TENANT_DATABASE_URL: "opentenant_it_postgres_tenant" } },
  { id: "identity", filter: "testing", files: ["src/identity-adapters.test.ts", "src/better-auth.integration.test.ts"], databases: { PROVISIONING_CONTROL_DATABASE_URL: "opentenant_it_identity_control" } },
  { id: "worker", filter: "platform", files: ["lib/tenant-worker.integration.test.ts", "lib/tenant-lifecycle.integration.test.ts"], databases: { TENANT_WORKER_DATABASE_URL: "opentenant_it_tenant_worker", PROVISIONING_TENANT_DATABASE_URL: "opentenant_it_worker_tenant" } },
  { id: "support-delivery", filter: "support", files: ["src/delivery.integration.test.ts"], databases: { TENANT_SUPPORT_INTEGRATION_DATABASE_URL: "opentenant_it_support_delivery" } },
  { id: "support-ai-review", filter: "support", files: ["src/support-ai-review.integration.test.ts"], databases: { SUPPORT_AI_DATABASE_URL: "opentenant_it_support_ai" } },
  { id: "tenant-export", filter: "platform", files: ["lib/tenant-export.integration.test.ts"], databases: { TENANT_WORKER_DATABASE_URL: "opentenant_it_export_control", PROVISIONING_TENANT_DATABASE_URL: "opentenant_it_export_tenant" } },
  { id: "usage-export", filter: "usage-export", files: ["src/job.integration.test.ts"], databases: { USAGE_EXPORT_DATABASE_URL: "opentenant_it_usage_export" } },
  { id: "key-rotation", filter: "database", files: ["src/credential-cipher-rotation.postgres.test.ts"], databases: { KEY_ROTATION_DATABASE_URL: "opentenant_it_key_rotation" } },
  { id: "rate-limit", filter: "platform", files: ["lib/rate-limit.integration.test.ts"], databases: { RATE_LIMIT_DATABASE_URL: "opentenant_it_rate_limits" } },
  { id: "pg-observability", filter: "observability", files: ["src/pg.integration.test.ts"], databases: { OBSERVABILITY_DATABASE_URL: "opentenant_it_observability" } },
  { id: "migrations", filter: "migrations", files: ["src/audit-truncate.integration.test.ts", "src/control-plane-admission.integration.test.ts", "src/control-plane-authorization.integration.test.ts", "src/control-plane-brand-upload.integration.test.ts", "src/control-plane-meaning-bearing-bans.integration.test.ts", "src/control-plane-model-routing-store.integration.test.ts", "src/control-plane-model-routing.integration.test.ts", "src/control-plane-module-capabilities.integration.test.ts", "src/control-plane-module-ownership.integration.test.ts", "src/control-plane-usage-ledger.integration.test.ts", "src/control-plane-voice-profile.integration.test.ts", "src/hosted.integration.test.ts", "src/local.integration.test.ts", "src/module-installation.integration.test.ts", "src/tenant-core.integration.test.ts", "src/tenant-support-outbox.integration.test.ts"], databases: { CONTROL_PLANE_INTEGRATION_DATABASE_URL: "opentenant_it_control_plane", TENANT_CORE_INTEGRATION_DATABASE_URL: "opentenant_it_tenant_core", TENANT_SUPPORT_INTEGRATION_DATABASE_URL: "opentenant_it_tenant_support" } },
  { id: "developer-mcp", filter: "developer-mcp", files: ["src/brain.integration.test.ts", "src/oauth.integration.test.ts", "src/runtime.integration.test.ts"], databases: {} },
  { id: "isolation-fuzz", command: ["node", "packages/testing/scripts/isolation-proof.mjs"], databases: {} },
];

/** @param {typeof STEPS[number]} step @param {NodeJS.ProcessEnv} source */
export function stepEnvironment(step, source) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...source, ISOLATION_FUZZ_SEED: "20261111" };
  for (const key of Object.keys(env)) if (key.endsWith("DATABASE_URL") && key !== "ADMIN_DATABASE_URL") delete env[key];
  validateDatabaseUrl(source.ADMIN_DATABASE_URL, "postgres");
  for (const [key, database] of Object.entries(step.databases)) {
    const url = new URL(source.ADMIN_DATABASE_URL ?? "");
    url.pathname = `/${database}`;
    env[key] = url.href;
  }
  return env;
}

/**
 * @param {Record<string, unknown>} report
 * @param {{suites: number, files: Record<string, number>}} expected
 */
export function validateSequenceReport(report, expected) {
  const tests = Object.values(expected.files).reduce((sum, count) => sum + count, 0);
  const counters = { numTotalTestSuites: expected.suites, numPassedTestSuites: expected.suites,
    numTotalTests: tests, numPassedTests: tests, numFailedTestSuites: 0,
    numPendingTestSuites: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };
  if (report.success !== true || Object.entries(counters).some(([key, value]) => report[key] !== value)) {
    throw new Error("Incomplete DB proof: expected exact suite/case counts and zero failures/skips/todos");
  }
  const results = Array.isArray(report.testResults) ? report.testResults : [];
  const seen = new Set();
  for (const result of results) {
    const file = relative(resolve(import.meta.dirname, "../.."), String(result.name));
    const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
    if (seen.has(file) || !Object.hasOwn(expected.files, file) || result.status !== "passed"
      || assertions.length !== expected.files[file] || assertions.some(assertion => assertion.status !== "passed")) {
      throw new Error(`Incomplete DB proof: unexpected, duplicate or non-passing file ${file}`);
    }
    seen.add(file);
  }
  if (seen.size !== Object.keys(expected.files).length) throw new Error("Incomplete DB proof: missing test files");
  return { suites: expected.suites, files: expected.files, tests, skipped: 0 };
}

/** @param {string} directory */
function storeSummary(directory) {
  const results = STORE_SUITES.map(suite => ({ id: suite.id, ...validateSequenceReport(
    JSON.parse(readFileSync(resolve(directory, `${suite.id}.json`), "utf8")),
    { suites: 2, files: { [`packages/database/${suite.testPath}`]: suite.titles.length } },
  ) }));
  return { suites: results.reduce((sum, result) => sum + result.suites, 0),
    tests: results.reduce((sum, result) => sum + result.tests, 0), skipped: 0, stores: results };
}

export async function main() {
  await createIntegrationDatabases(process.env.ADMIN_DATABASE_URL, {
    allowUnixSocketServer: process.env.OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT === "1",
  });
  const directory = resolve(process.env.DATABASE_STORE_REPORT_DIRECTORY ?? "artifacts/database-store-tests");
  mkdirSync(directory, { recursive: true });
  const summary = [];
  const summaryFile = resolve(directory, "sequence-summary.json");
  writeFileSync(summaryFile, JSON.stringify({ completed: false, steps: summary }), { mode: 0o600 });
  for (const step of STEPS) {
    console.log(`DB sequence: ${step.id}`);
    const report = resolve(directory, `${step.id}.json`);
    rmSync(report, { force: true });
    if (step.id === "stores") for (const suite of STORE_SUITES) rmSync(resolve(directory, `${suite.id}.json`), { force: true });
    const argv = step.command ?? ["pnpm", "--filter", `@opentenant/${step.filter}`, "exec", "vitest", "run", ...step.files ?? [], "--hookTimeout=120000", "--testTimeout=120000", "--reporter=default", "--reporter=json", `--outputFile=${report}`];
    const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", env: stepEnvironment(step, { ...process.env, DATABASE_STORE_REPORT_DIRECTORY: directory }) });
    if (result.error || result.status !== 0) throw new Error(`DB sequence failed: ${step.id}`, { cause: result.error });
    const counts = step.id === "stores" ? storeSummary(directory)
      : validateSequenceReport(JSON.parse(readFileSync(report, "utf8")), SEQUENCE_COUNTS[step.id]);
    summary.push({ id: step.id, requiredEnvironment: ["ADMIN_DATABASE_URL", ...Object.keys(step.databases)], ...counts });
    writeFileSync(summaryFile, `${JSON.stringify({ completed: summary.length === STEPS.length, steps: summary }, null, 2)}\n`, { mode: 0o600 });
    console.log(`DB sequence ${step.id}: ${counts.suites} suite counters, ${counts.tests} passed, 0 failed, 0 skipped`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Database sequence failed; inspect the step report."); process.exitCode = 1; });
}
