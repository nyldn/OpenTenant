// @ts-check

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const STORE_SUITES = [
  {
    id: "admission",
    testPath: "src/admission-store.integration.test.ts",
    database: "opentenant_it_store_admission",
    urlVariable: "ADMISSION_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "self",
    titles: [
      "replays the original decision across store instances and rejects fingerprint conflicts",
      "ignores expired replay evidence without deleting live records",
      "serializes distinct-key concurrency across store instances",
    ],
  },
  {
    id: "usage",
    testPath: "src/usage-ledger.integration.test.ts",
    database: "opentenant_it_store_usage",
    urlVariable: "USAGE_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "self",
    titles: [
      "commits one event when two stores race the same idempotency key",
      "commits distinct keys and aggregates half-open windows with corrections exactly once",
    ],
  },
  {
    id: "model-routing",
    testPath: "src/model-routing-store.integration.test.ts",
    database: "opentenant_it_store_model_routing",
    urlVariable: "MODEL_ROUTING_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "self",
    titles: [
      "keeps policy and selection reads bound to the requested tenant",
      "reads the newest allowlist and consent policy versions",
      "returns only the requested tenant's active consent and exact pairs",
      "maps installation scopes and writes linked stream evidence",
    ],
  },
  {
    id: "module-ownership",
    testPath: "src/module-ownership-store.integration.test.ts",
    database: "opentenant_ops04_store_ownership",
    urlVariable: "MODULE_OWNERSHIP_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "module-ownership",
    titles: [
      "creates, scopes, assigns, and promotes through the public store",
    ],
  },
  {
    id: "module-capability",
    testPath: "src/module-capability-store.integration.test.ts",
    database: "opentenant_ops05_store_capability",
    urlVariable: "MODULE_CAPABILITY_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "module-capability",
    titles: [
      "publishes, grants, authorizes, audits, and revokes through public stores",
      "appends replacements after expired creator and tenant grants",
    ],
  },
  {
    id: "brand-proposal",
    testPath: "src/brand-proposal-store.integration.test.ts",
    database: "opentenant_it_store_brand_proposal",
    urlVariable: "BRAND_PROPOSAL_STORE_DATABASE_URL",
    testEnvironment: "CONTROL_PLANE_INTEGRATION_DATABASE_URL",
    setup: "control-plane",
    titles: [
      "reviews and revokes with database timestamps and one canonical audit per transition",
      "deduplicates concurrent uploads of the same digest across real connections",
      "supersedes only the prior draft when a different digest is uploaded",
      "rolls back request and proposal creation when upload audit persistence fails",
      "allows exactly one of two real connections to apply the same review",
      "applies when the caller's clock trails the database review time",
      "rejects version drift without clobbering newer policy state",
      "changes no proposal, policy, or audit row for a cross-tenant transition",
      "reports the existing live draft when editing a reviewed proposal",
      "edits once with preserved provenance, cleared review, and one canonical audit",
      "gives edit versus apply one coherent winner while preserving upload provenance",
      "keeps the current draft when upload lacks supersede authority",
    ],
  },
  {
    id: "helpdesk-projection",
    testPath: "src/helpdesk-projection-store.integration.test.ts",
    database: "opentenant_ops06_store_helpdesk_projection",
    urlVariable: "HELPDESK_PROJECTION_STORE_DATABASE_URL",
    testEnvironment: "HELPDESK_INTEGRATION_DATABASE_URL",
    setup: "self",
    titles: [
      "applies, replays idempotently, and refuses to regress a newer row",
      "hides tombstoned rows from the queue without deleting canonical anything",
      "keeps tenants isolated in queue reads",
      "tombstones a tenant and appends verifiable audit evidence atomically",
      "rebuilds from canonical rows and re-baselines the checkpoint",
      "never regresses a row applied concurrently after the rebuild's canonical read",
      "has no content columns to leak",
    ],
  },
  {
    id: "audit-checkpoints",
    testPath: "src/audit-checkpoints.integration.test.ts",
    database: "opentenant_it_audit",
    urlVariable: "AUDIT_CHECKPOINT_DATABASE_URL",
    testEnvironment: "AUDIT_CHECKPOINT_DATABASE_URL",
    setup: "self",
    titles: [
      "anchors every scope, persists signed notes, retries, and verifies from the CLI",
      "detects dropped tail after an owner bypass, even if DB checkpoints are deleted",
      "detects edited row after an owner bypass, even if DB checkpoints are deleted",
      "detects reordering after an owner bypass, even if DB checkpoints are deleted",
      "detects entire scope deletion after an owner bypass, even if DB checkpoints are deleted",
      "extends an anchored chain, requires a fresh head, and never signs a broken chain",
      "detects a fully rewritten self-consistent chain against its external head",
      "anchors an empty platform chain and verifies it",
      "fails closed with no external checkpoints",
      "normalizes connection and configuration errors without echoing secrets",
    ],
  },
  {
    id: "quality-contract",
    testPath: "src/quality-contract-store.integration.test.ts",
    database: "opentenant_it_store_quality_contract",
    urlVariable: "QUALITY_CONTRACT_STORE_DATABASE_URL",
    testEnvironment: "QUALITY_CONTRACT_DATABASE_URL",
    setup: "self",
    titles: [
      "binds, evaluates and reads through the server-side journey with an intact audit chain",
      "refuses wrong owners, version/digest pairs, weak digests and shared modules",
      "serializes concurrent replay, rejects conflicting reuse and rolls audit back on failed insert",
      "preserves accepted, rejected and no-change evaluations, with replay and envelope deduplication",
      "recomputes effective contracts and retains early weakening rejection",
      "blocks ordinary UPDATE, DELETE, TRUNCATE and tenant deletion at the database",
      "erases quality lineage only through the authorized tenant lifecycle and preserves other tenants",
      "rejects an unrelated audit sequence and direct cross-tenant insertion",
      "fails closed on corrupted body, verdict, digest and failed read audit",
    ],
  },
];

/**
 * @param {string | undefined} value
 * @param {string} expectedDatabase
 */
export function validateDatabaseUrl(value, expectedDatabase) {
  if (!value) throw new Error(`database URL for ${expectedDatabase} is required`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`database URL for ${expectedDatabase} is invalid`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`database URL for ${expectedDatabase} must use a postgres URL scheme`);
  }
  if (parsed.search) {
    throw new Error(`database URL for ${expectedDatabase} must not include connection options`);
  }
  if (parsed.hash) {
    throw new Error(`database URL for ${expectedDatabase} must not include a fragment`);
  }
  const host = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`database URL for ${expectedDatabase} must use a loopback host`);
  }
  if (parsed.pathname.slice(1) !== expectedDatabase) {
    throw new Error(`database URL must name ${expectedDatabase}`);
  }
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`database URL for ${expectedDatabase} must use a valid TCP port`);
  }
  let user;
  let password;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error(`database URL for ${expectedDatabase} has invalid credentials`);
  }
  return {
    host,
    port,
    database: expectedDatabase,
    user,
    password,
    ssl: false,
  };
}

/**
 * @param {{
 *   query: (sql: string) => Promise<{rows: Array<Record<string, unknown>>}>,
 *   connectionParameters?: {host?: string, port?: number, database?: string},
 *   connection?: {stream?: {remoteAddress?: string, remotePort?: number}},
 * }} client
 * @param {{host: string, port: number, database: string, allowUnixSocketServer?: boolean}} expected
 */
export async function validateConnectedDatabase(client, expected) {
  const parameters = client.connectionParameters;
  if (parameters?.host !== expected.host
    || Number(parameters?.port) !== expected.port
    || parameters?.database !== expected.database) {
    throw new Error("effective connection parameters do not match the validated target");
  }
  const remoteAddress = String(client.connection?.stream?.remoteAddress ?? "");
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) {
    throw new Error("connected socket address is not loopback");
  }
  if (Number(client.connection?.stream?.remotePort) !== expected.port) {
    throw new Error("connected socket port does not match the validated target");
  }
  const result = await client.query(`
    select current_database() as database_name,
           inet_server_addr()::text as server_address,
           inet_server_port() as server_port
  `);
  if (result.rows.length !== 1) {
    throw new Error("database connection proof returned an invalid row count");
  }
  const [proof] = result.rows;
  if (proof.database_name !== expected.database) {
    throw new Error("effective database does not match the validated target");
  }
  if (expected.allowUnixSocketServer === true && proof.server_address === null && proof.server_port === null) return;
  const serverPort = Number(proof.server_port);
  if (!String(proof.server_address ?? "")
    || !Number.isSafeInteger(serverPort)
    || serverPort < 1
    || serverPort > 65535) {
    throw new Error("database connection proof returned an invalid server endpoint");
  }
}

/** @param {{host: string, port: number, database: string, user: string, password: string}} config */
function databaseUrlFromConfig(config) {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const parsed = new URL(`postgresql://${host}:${config.port}/${config.database}`);
  parsed.username = config.user;
  parsed.password = config.password;
  return parsed.href;
}

/**
 * @param {string[]} actualPaths
 * @param {typeof STORE_SUITES} suites
 */
export function validateSuiteInventory(actualPaths, suites) {
  const expectedPaths = suites.map((suite) => suite.testPath);
  if (new Set(expectedPaths).size !== expectedPaths.length) {
    throw new Error("database store inventory contains a duplicate suite path");
  }
  const databases = suites.map((suite) => suite.database);
  if (new Set(databases).size !== databases.length) {
    throw new Error("database store inventory database names must be unique");
  }
  const missing = expectedPaths.find((path) => !actualPaths.includes(path));
  if (missing) throw new Error(`database store inventory is missing integration suite ${missing}`);
  const unexpected = actualPaths.find((path) => !expectedPaths.includes(path));
  if (unexpected) throw new Error(`database store inventory has unexpected integration suite ${unexpected}`);
}

/**
 * @param {(typeof STORE_SUITES)[number]} suite
 * @param {string} databaseUrl
 * @param {NodeJS.ProcessEnv} source
 */
export function buildSuiteEnvironment(suite, databaseUrl, source) {
  const child = Object.fromEntries(
    ["CI", "HOME", "PATH", "TERM", "TMPDIR"]
      .flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]),
  );
  return { ...child, [suite.testEnvironment]: databaseUrl };
}

/** @param {string} nodeVersion @param {string} pnpmVersion */
export function validateRuntimeVersions(nodeVersion, pnpmVersion) {
  if (!/^v22\./u.test(nodeVersion)) {
    throw new Error(`database store proof requires Node 22, found ${nodeVersion}`);
  }
  if (pnpmVersion !== "11.13.1") {
    throw new Error(`database store proof requires pnpm 11.13.1, found ${pnpmVersion}`);
  }
}

/** @param {{serverVersionNumber: number, vectorAvailable: boolean}} proof */
export function validateDatabaseServer(proof) {
  if (!Number.isSafeInteger(proof.serverVersionNumber)
    || proof.serverVersionNumber < 170000
    || proof.serverVersionNumber >= 180000) {
    throw new Error(`database store proof requires PostgreSQL 17, found ${proof.serverVersionNumber}`);
  }
  if (!proof.vectorAvailable) throw new Error("database store proof requires pgvector");
}

const MODULE_OWNERSHIP_SEEDS = [
  `insert into tenants (tenant_id, slug, display_name, status, data_region)
   values ('ten_alpha', 'alpha', 'Alpha', 'active', 'us'),
          ('ten_beta', 'beta', 'Beta', 'active', 'us')`,
  `insert into platform_users (user_id, email, display_name, is_platform_admin)
   values ('user_reviewer', 'reviewer@example.test', 'Reviewer', true)`,
];

const MODULE_CAPABILITY_SEEDS = [
  `insert into tenants (tenant_id, slug, display_name, status, data_region)
   values ('ten_alpha', 'alpha', 'Alpha', 'active', 'us'),
          ('ten_beta', 'beta', 'Beta', 'active', 'us')`,
  `insert into platform_users (user_id, email, display_name, is_platform_admin)
   values ('user_creator', 'creator@example.test', 'Creator', false),
          ('user_other', 'other@example.test', 'Other', false),
          ('user_owner', 'owner@example.test', 'Owner', true)`,
  `insert into module_creator_capability_authorities
     (tenant_id, creator_user_id, capability, granted_by_user_id)
   values ('ten_alpha', 'user_creator', 'support.ticket.read', 'user_owner')`,
];

/**
 * @param {{query: (sql: string) => Promise<unknown>}} client
 * @param {(typeof STORE_SUITES)[number]} suite
 * @param {Array<{id: string, sql: string}>} migrations
 */
export async function prepareDatabase(client, suite, migrations) {
  if (suite.setup === "self") return;
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  for (const migration of migrations) {
    await client.query("begin");
    try {
      await client.query(migration.sql);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
  const seeds = suite.setup === "module-ownership"
    ? MODULE_OWNERSHIP_SEEDS
    : suite.setup === "module-capability"
      ? MODULE_CAPABILITY_SEEDS
      : [];
  for (const seed of seeds) await client.query(seed);
}

/**
 * @param {Record<string, unknown>} report
 * @param {{file: string, titles: string[]}} expected
 */
export function validateVitestReport(report, expected) {
  const suiteCounts = [
    Number(report.numTotalTestSuites),
    Number(report.numPassedTestSuites),
    Number(report.numFailedTestSuites),
    Number(report.numPendingTestSuites),
  ];
  const testCounts = [
    Number(report.numTotalTests),
    Number(report.numPassedTests),
    Number(report.numFailedTests),
    Number(report.numPendingTests),
  ];
  if (![...suiteCounts, ...testCounts].every(Number.isSafeInteger)) {
    throw new Error("Vitest report contains invalid counts");
  }
  const [totalSuites, passedSuites, failedSuites, pendingSuites] = suiteCounts;
  const [total, passed, failed, pending] = testCounts;
  if (failedSuites > 0) throw new Error(`Vitest report contains ${failedSuites} failed suite(s)`);
  if (pendingSuites > 0) throw new Error(`Vitest report contains ${pendingSuites} skipped or pending suite(s)`);
  if (failed > 0) throw new Error(`Vitest report contains ${failed} failed test(s)`);
  if (pending > 0) throw new Error(`Vitest report contains ${pending} skipped or pending test(s)`);
  if (totalSuites !== passedSuites + failedSuites + pendingSuites) {
    throw new Error("Vitest suite count mismatch");
  }
  if (total !== passed + failed + pending) throw new Error("Vitest test count mismatch");

  const results = Array.isArray(report.testResults) ? report.testResults : [];
  const testFile = results.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return resolve(String(candidate.name ?? "")) === resolve(expected.file);
  });
  if (!testFile) throw new Error(`Vitest report is missing test file ${expected.file}`);
  if (results.length !== 1) throw new Error("Vitest report must contain exactly one test suite result");
  if (totalSuites !== 2 || passedSuites !== 2) {
    throw new Error("Vitest suite counters do not match one result");
  }
  const assertions = Array.isArray(testFile.assertionResults) ? testFile.assertionResults : [];
  if (assertions.length !== total || assertions.length !== expected.titles.length) {
    throw new Error("Vitest assertion count does not match the inventory");
  }
  for (const title of expected.titles) {
    const assertion = assertions.find((candidate) => candidate?.title === title);
    if (!assertion) throw new Error(`Vitest report is missing expected test title: ${title}`);
    if (assertion.status !== "passed") throw new Error(`expected test did not pass: ${title}`);
  }
  if (assertions.some((assertion) => assertion?.status !== "passed")) {
    throw new Error("Vitest report contains a non-passing assertion");
  }
  return { executed: total, passed, skipped: pending };
}

function repositoryRoot() {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

/** @param {string} executable @param {string[]} args @param {NodeJS.ProcessEnv} env */
function run(executable, args, env) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot(),
    env,
    encoding: "utf8",
    shell: false,
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${executable} ${args.join(" ")} failed with code ${result.status ?? "unknown"}`,
      result.error instanceof Error ? result.error.message : "",
      String(result.stdout ?? "").trim(),
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return String(result.stdout ?? "").trim();
}

function loadControlPlaneMigrations() {
  const directory = join(repositoryRoot(), "tooling", "migrations", "sql", "control-plane");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ id: name.slice(0, -4), sql: readFileSync(join(directory, name), "utf8") }));
}

async function main() {
  const pnpmVersion = run("pnpm", ["--version"], process.env);
  validateRuntimeVersions(process.version, pnpmVersion);

  const databasePackage = join(repositoryRoot(), "packages", "database");
  const actualSuites = readdirSync(join(databasePackage, "src"))
    .filter((name) => name.endsWith(".integration.test.ts"))
    .map((name) => `src/${name}`)
    .sort((left, right) => left.localeCompare(right));
  validateSuiteInventory(actualSuites, STORE_SUITES);

  const reportDirectory = resolve(
    process.env.DATABASE_STORE_REPORT_DIRECTORY
      ?? join(repositoryRoot(), "artifacts", "database-store-tests"),
  );
  mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  const migrations = loadControlPlaneMigrations();
  const summary = [];

  for (const suite of STORE_SUITES) {
    const clientConfig = validateDatabaseUrl(process.env[suite.urlVariable], suite.database);
    const databaseUrl = databaseUrlFromConfig(clientConfig);
    const client = new pg.Client(clientConfig);
    await client.connect();
    try {
      await validateConnectedDatabase(client, { ...clientConfig, allowUnixSocketServer: process.env.OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT === "1" });
      const version = await client.query(
        "select current_setting('server_version_num') as server_version_num",
      );
      const vector = await client.query(
        "select exists (select 1 from pg_available_extensions where name = 'vector') as available",
      );
      validateDatabaseServer({
        serverVersionNumber: Number(version.rows[0]?.server_version_num),
        vectorAvailable: vector.rows[0]?.available === true,
      });
      await prepareDatabase(client, suite, migrations);
    } finally {
      await client.end();
    }

    const reportPath = join(reportDirectory, `${suite.id}.json`);
    if (existsSync(reportPath)) unlinkSync(reportPath);
    run("pnpm", [
      "--filter", "@opentenant/database",
      "exec", "vitest", "run", suite.testPath,
      "--configLoader", "runner",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ], buildSuiteEnvironment(suite, databaseUrl, process.env));
    if (!existsSync(reportPath)) throw new Error(`Vitest did not write ${reportPath}`);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const result = validateVitestReport(report, {
      file: join(databasePackage, suite.testPath),
      titles: suite.titles,
    });
    summary.push({ id: suite.id, database: suite.database, ...result });
    process.stdout.write(`${suite.id}: ${result.executed} executed, 0 skipped\n`);
  }

  const expected = STORE_SUITES.reduce((count, suite) => count + suite.titles.length, 0);
  const executed = summary.reduce((count, suite) => count + suite.executed, 0);
  const skipped = summary.reduce((count, suite) => count + suite.skipped, 0);
  if (executed !== expected || skipped !== 0) {
    throw new Error(`database store result mismatch: expected ${expected}, executed ${executed}, skipped ${skipped}`);
  }
  const summaryPath = join(reportDirectory, "summary.json");
  writeFileSync(summaryPath, `${JSON.stringify({ expected, executed, skipped, suites: summary }, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `Database store proof: ${STORE_SUITES.length} suites, ${executed} assertions, 0 skipped.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
