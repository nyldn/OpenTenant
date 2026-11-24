// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROFILES = {
  smoke: [
    {
      package: "@opentenant/migrations",
      testPath: "src/control-plane-module-capabilities.integration.test.ts",
      reportFile: "control-plane-module-capabilities.json",
      database: "opentenant_it_proof_smoke",
      environment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
      titles: [
        "publishes declarations atomically and blocks capability expansion or mutation",
        "requires an exact active entitlement and permits only one-way grant revocation",
        "binds declarations to the artifact creator and serializes publication races",
      ],
      minimumTests: 3,
      corroborationSql: `
        select (
          to_regclass('public.module_version_capabilities') is not null
          and exists (
            select 1 from module_versions
             where module_key = 'tenant-portal' and version = '1.0.0'
          )
        )::text`,
    },
  ],
  admission: [
    {
      package: "@opentenant/migrations",
      testPath: "src/control-plane-admission.integration.test.ts",
      reportFile: "control-plane-admission.json",
      database: "opentenant_it_proof_admission_migration",
      environment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
      titles: [
        "serializes concurrent admissions without exceeding the tenant limit",
        "rolls back leases and idempotency when the transaction fails",
      ],
      minimumTests: 2,
      corroborationSql: `
        select (
          to_regclass('public.admission_policies') is not null
          and to_regclass('public.admission_windows') is not null
          and exists (select 1 from admission_policies)
          and exists (select 1 from admission_windows)
        )::text`,
    },
    {
      package: "@opentenant/database",
      testPath: "src/admission-store.integration.test.ts",
      reportFile: "admission-store.json",
      database: "opentenant_it_proof_admission_store",
      environment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
      titles: [
        "replays the original decision across store instances and rejects fingerprint conflicts",
        "ignores expired replay evidence without deleting live records",
        "serializes distinct-key concurrency across store instances",
      ],
      minimumTests: 3,
      corroborationSql: `
        select (
          exists (select 1 from admission_leases)
          and exists (select 1 from admission_idempotency_records)
        )::text`,
    },
  ],
  usage: [
    {
      package: "@opentenant/migrations",
      testPath: "src/control-plane-usage-ledger.integration.test.ts",
      reportFile: "control-plane-usage-ledger.json",
      database: "opentenant_it_proof_usage_migration",
      environment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
      titles: [
        "rejects update, delete, and truncate while preserving correction evidence",
        "isolates corrections by tenant and metric",
      ],
      minimumTests: 2,
      corroborationSql: `
        select (
          to_regclass('public.usage_metric_definitions') is not null
          and to_regclass('public.exact_usage_events') is not null
          and exists (select 1 from exact_usage_events)
        )::text`,
    },
    {
      package: "@opentenant/database",
      testPath: "src/usage-ledger.integration.test.ts",
      reportFile: "usage-ledger.json",
      database: "opentenant_it_proof_usage_store",
      environment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
      titles: [
        "commits one event when two stores race the same idempotency key",
        "commits distinct keys and aggregates half-open windows with corrections exactly once",
      ],
      minimumTests: 2,
      corroborationSql: `
        select (
          exists (select 1 from exact_usage_events)
          and exists (
            select 1 from exact_usage_events where correction_of_event_id is not null
          )
        )::text`,
    },
  ],
};

/**
 * @param {Record<string, unknown>} report
 * @param {{file: string, titles: string[], minimumTests: number}} expected
 */
export function validateVitestReport(report, expected) {
  const total = Number(report.numTotalTests);
  const passed = Number(report.numPassedTests);
  const failed = Number(report.numFailedTests);
  const pending = Number(report.numPendingTests);
  if (![total, passed, failed, pending].every(Number.isSafeInteger)) {
    throw new Error("Vitest report contains invalid test counts");
  }
  if (failed > 0) throw new Error(`Vitest report contains ${failed} failed test(s)`);
  if (pending > 0) throw new Error(`Vitest report contains ${pending} skipped or pending test(s)`);
  if (total < expected.minimumTests || passed < expected.minimumTests) {
    throw new Error(`Vitest executed ${total}; expected at least ${expected.minimumTests}`);
  }
  const results = Array.isArray(report.testResults) ? report.testResults : [];
  const testFile = results.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return resolve(String(candidate.name ?? "")) === resolve(expected.file);
  });
  if (!testFile) throw new Error(`Vitest report is missing test file ${expected.file}`);
  const assertions = Array.isArray(testFile.assertionResults) ? testFile.assertionResults : [];
  if (assertions.length !== total || total !== passed + failed + pending) {
    throw new Error("Vitest report contains inconsistent totals and assertion results");
  }
  for (const title of expected.titles) {
    const assertion = assertions.find((candidate) => candidate?.title === title);
    if (!assertion) throw new Error(`Vitest report is missing expected test title: ${title}`);
    if (assertion.status !== "passed") throw new Error(`expected test did not pass: ${title}`);
  }
  if (assertions.some((assertion) => assertion?.status !== "passed")) {
    throw new Error("Vitest report contains a non-passing assertion");
  }
  return { executed: total, passed };
}

function repositoryRoot() {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

/** @param {string} executable @param {string[]} args @param {NodeJS.ProcessEnv} env @param {boolean} [expectFailure] */
function run(executable, args, env, expectFailure = false) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot(),
    env,
    encoding: "utf8",
    shell: false,
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (expectFailure) {
    if (result.status === 0) throw new Error(`${executable} ${args.join(" ")} unexpectedly succeeded`);
    return String(result.stderr ?? result.stdout ?? "").trim();
  }
  if (result.status !== 0) {
    throw new Error([
      `${executable} ${args.join(" ")} failed with code ${result.status ?? "unknown"}`,
      String(result.stdout ?? "").trim(),
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return String(result.stdout ?? "").trim();
}

function discoverPnpm() {
  const candidates = [
    "/opt/homebrew/bin/pnpm",
    ...String(process.env.PATH ?? "").split(delimiter).map((entry) => join(entry, "pnpm")),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) continue;
    const version = spawnSync(candidate, ["--version"], {
      env: process.env,
      encoding: "utf8",
      shell: false,
    });
    if (version.status === 0 && String(version.stdout).trim() === "11.13.1") return candidate;
  }
  throw new Error("local PostgreSQL proof requires pnpm 11.13.1");
}

function discoverPsql() {
  const candidates = [
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    "/usr/local/opt/postgresql@17/bin/psql",
    ...String(process.env.PATH ?? "").split(delimiter).map((entry) => join(entry, "psql")),
  ];
  const candidate = candidates.find((path) => existsSync(path));
  if (!candidate) throw new Error("local PostgreSQL proof requires PostgreSQL 17 psql");
  return candidate;
}

/** @param {string} database @param {string} role @param {string} socketDirectory @param {string} port */
function connectionUrl(database, role, socketDirectory, port) {
  const url = new URL(`postgresql://${role}@localhost:${port}/${database}`);
  url.searchParams.set("host", socketDirectory);
  return url.toString();
}

/** @param {string} psql @param {string} database @param {string} role @param {string} socketDirectory @param {string} port @param {string} sql @param {NodeJS.ProcessEnv} env @param {boolean} [expectFailure] */
function query(psql, database, role, socketDirectory, port, sql, env, expectFailure = false) {
  const args = [
    "-h", socketDirectory,
    "-p", port,
    "-U", role,
    "-d", database,
    "-A", "-t", "-X",
    "-v", "ON_ERROR_STOP=1",
    "-c", sql,
  ];
  return run(psql, args, env, expectFailure);
}

/** @param {string} profile */
function main(profile) {
  if (!(profile in PROFILES) || process.argv.length !== 3) {
    throw new Error("usage: run-local-postgres-proof.mjs smoke|admission|usage");
  }
  if (process.env.OPENTENANT_POSTGRES_PROOF_PROFILE !== profile) {
    throw new Error("controller PostgreSQL proof profile does not match helper argv");
  }
  if (!/^v22\./u.test(process.version)) {
    throw new Error(`local PostgreSQL proof requires Node 22, found ${process.version}`);
  }
  const home = process.env.HOME;
  const socketDirectory = process.env.OPENTENANT_POSTGRES_PROOF_SOCKET_DIRECTORY;
  const port = process.env.OPENTENANT_POSTGRES_PROOF_PORT;
  const role = process.env.OPENTENANT_POSTGRES_PROOF_ROLE;
  if (!home || !socketDirectory || !port || !role) {
    throw new Error("controller PostgreSQL proof metadata is incomplete");
  }
  const resultsDirectory = join(home, "postgres-results");
  mkdirSync(resultsDirectory, { mode: 0o700 });
  const pnpm = discoverPnpm();
  const psql = discoverPsql();
  const entries = PROFILES[profile];
  const baseEnvironment = Object.fromEntries([
    "CI",
    "PGPASSWORD",
    "HOME",
    "PATH",
    "TERM",
    "TMPDIR",
    "OPENTENANT_POSTGRES_PROOF_PROFILE",
    "OPENTENANT_POSTGRES_PROOF_SOCKET_DIRECTORY",
    "OPENTENANT_POSTGRES_PROOF_PORT",
    "OPENTENANT_POSTGRES_PROOF_ROLE",
  ].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  query(psql, entries[0].database, "opentenant_cluster_admin", socketDirectory, port, "select 1", baseEnvironment, true);
  query(psql, "template1", role, socketDirectory, port, "select 1", baseEnvironment, true);
  query(
    psql,
    entries[0].database,
    role,
    socketDirectory,
    port,
    "copy (select 1) to program '/usr/bin/true'",
    baseEnvironment,
    true,
  );

  let totalExecuted = 0;
  for (const manifest of entries) {
    const reportPath = join(resultsDirectory, manifest.reportFile);
    const environment = {
      ...baseEnvironment,
      OPENTENANT_LOCAL_POSTGRES_PROOF: profile,
      [manifest.environment]: connectionUrl(manifest.database, role, socketDirectory, port),
    };
    run(pnpm, [
      "--filter", manifest.package,
      "exec", "vitest", "run", manifest.testPath,
      "--configLoader", "runner",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ], environment);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const packageDirectory = manifest.package === "@opentenant/migrations"
      ? join(repositoryRoot(), "tooling/migrations")
      : join(repositoryRoot(), "packages/database");
    const corroboration = validateVitestReport(report, {
      file: join(packageDirectory, manifest.testPath),
      titles: manifest.titles,
      minimumTests: manifest.minimumTests,
    });
    const sqlProof = query(
      psql,
      manifest.database,
      role,
      socketDirectory,
      port,
      manifest.corroborationSql,
      baseEnvironment,
    );
    if (sqlProof !== "true") throw new Error(`helper SQL corroboration failed for ${manifest.database}`);
    totalExecuted += corroboration.executed;
    console.log(`PostgreSQL proof ${profile}/${manifest.reportFile}: ${corroboration.executed} executed, 0 skipped`);
  }
  console.log(`PostgreSQL proof ${profile}: ${totalExecuted} executed, 0 skipped; network remained denied`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv[2] ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
