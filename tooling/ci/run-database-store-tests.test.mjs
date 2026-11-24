import { STEPS, stepEnvironment } from "./db-sequence.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STORE_SUITES,
  buildSuiteEnvironment,
  prepareDatabase,
  validateDatabaseUrl,
  validateConnectedDatabase,
  validateSuiteInventory,
  validateVitestReport,
  validateRuntimeVersions,
  validateDatabaseServer,
} from "./run-database-store-tests.mjs";

const suiteFile = "/repo/packages/database/src/admission-store.integration.test.ts";
const expectedTitles = [
  "replays the original decision across store instances and rejects fingerprint conflicts",
  "ignores expired replay evidence without deleting live records",
];

function passingReport() {
  return {
    // Vitest 3 reports two suite counters for one test file in JSON output.
    numTotalTestSuites: 2,
    numPassedTestSuites: 2,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: expectedTitles.length,
    numPassedTests: expectedTitles.length,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{
      name: suiteFile,
      status: "passed",
      assertionResults: expectedTitles.map((title) => ({ title, status: "passed" })),
    }],
  };
}

test("inventories each database integration suite once with an isolated database", () => {
  assert.deepEqual(
    STORE_SUITES.map((suite) => suite.testPath),
    [
      "src/admission-store.integration.test.ts",
      "src/usage-ledger.integration.test.ts",
      "src/model-routing-store.integration.test.ts",
      "src/module-ownership-store.integration.test.ts",
      "src/module-capability-store.integration.test.ts",
      "src/brand-proposal-store.integration.test.ts",
      "src/helpdesk-projection-store.integration.test.ts",
      "src/audit-checkpoints.integration.test.ts",
      "src/quality-contract-store.integration.test.ts",
    ],
  );
  assert.equal(new Set(STORE_SUITES.map((suite) => suite.database)).size, STORE_SUITES.length);
  assert.equal(STORE_SUITES.reduce((count, suite) => count + suite.titles.length, 0), 50);
});

test("keeps each brand upload database proof visible in the guarded inventory", () => {
  const suite = STORE_SUITES.find(({ id }) => id === "brand-proposal");
  assert.deepEqual(suite?.titles, [
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
  ]);
});

test("wires the model-routing store database through the canonical CI sequence", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /run: pnpm ci:db-sequence/u);
  const env = stepEnvironment(STEPS[0], { ADMIN_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres" });
  assert.equal(new URL(env.MODEL_ROUTING_STORE_DATABASE_URL).pathname, "/opentenant_it_store_model_routing");
});

test("accepts an exact all-passing Vitest report", () => {
  assert.deepEqual(
    validateVitestReport(passingReport(), {
      file: suiteFile,
      titles: expectedTitles,
    }),
    { executed: 2, passed: 2, skipped: 0 },
  );
});

test("rejects skipped, failed, missing, and count-mismatched results", () => {
  const report = passingReport();
  const expected = { file: suiteFile, titles: expectedTitles };

  assert.throws(
    () => validateVitestReport({ ...report, numPendingTests: 1 }, expected),
    /skipped or pending test/u,
  );
  assert.throws(
    () => validateVitestReport({ ...report, numFailedTests: 1 }, expected),
    /failed test/u,
  );
  assert.throws(
    () => validateVitestReport({ ...report, testResults: [] }, expected),
    /missing test file/u,
  );
  assert.throws(
    () => validateVitestReport({ ...report, numTotalTests: 3 }, expected),
    /count mismatch/u,
  );
  assert.throws(
    () => validateVitestReport({
      ...report,
      testResults: [{ ...report.testResults[0], assertionResults: report.testResults[0].assertionResults.slice(1) }],
    }, expected),
    /assertion count/u,
  );
  assert.throws(
    () => validateVitestReport({ ...report, numPendingTestSuites: 1 }, expected),
    /skipped or pending suite/u,
  );
  assert.throws(
    () => validateVitestReport({
      ...report,
      numTotalTestSuites: 3,
      numPassedTestSuites: 3,
      testResults: [...report.testResults, { name: "/repo/unexpected.test.ts", assertionResults: [] }],
    }, expected),
    /exactly one test suite result/u,
  );
  assert.throws(
    () => validateVitestReport({
      ...report,
      numTotalTestSuites: 99,
      numPassedTestSuites: 99,
    }, expected),
    /suite counters do not match one result/u,
  );
});

test("requires the exact loopback synthetic database URL", () => {
  const database = "opentenant_it_store_admission";
  assert.deepEqual(
    validateDatabaseUrl(
      `postgresql://store%20user:p%40ssword@127.0.0.1:5432/${database}`,
      database,
    ),
    {
      host: "127.0.0.1",
      port: 5432,
      database,
      user: "store user",
      password: "p@ssword",
      ssl: false,
    },
  );
  assert.deepEqual(
    validateDatabaseUrl(`postgres://postgres:postgres@[::1]/${database}`, database),
    {
      host: "::1",
      port: 5432,
      database,
      user: "postgres",
      password: "postgres",
      ssl: false,
    },
  );
  assert.throws(() => validateDatabaseUrl(undefined, database), /is required/u);
  assert.throws(
    () => validateDatabaseUrl(`postgresql://postgres:postgres@database.example/${database}`, database),
    /loopback/u,
  );
  assert.throws(
    () => validateDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:5432/application", database),
    /must name opentenant_it_store_admission/u,
  );
});

test("rejects unsupported schemes and every URL connection option", () => {
  const database = "opentenant_it_store_admission";
  assert.throws(
    () => validateDatabaseUrl(`https://postgres:postgres@127.0.0.1:5432/${database}`, database),
    /postgres URL scheme/u,
  );
  for (const option of [
    "host=database.example",
    "hostaddr=203.0.113.10",
    "port=6432",
    "database=application",
    "service=production",
    "options=-c%20search_path%3Dother",
    "sslmode=require",
  ]) {
    assert.throws(
      () => validateDatabaseUrl(
        `postgresql://postgres:postgres@127.0.0.1:5432/${database}?${option}`,
        database,
      ),
      /connection options/u,
    );
  }
  assert.throws(
    () => validateDatabaseUrl(
      `postgresql://postgres:postgres@127.0.0.1:5432/${database}#ignored`,
      database,
    ),
    /fragment/u,
  );
});

test("verifies the effective connected database before destructive setup", async () => {
  const expected = {
    host: "localhost",
    port: 55432,
    database: "opentenant_it_store_admission",
  };
  const queries = [];
  const client = {
    connectionParameters: expected,
    connection: {
      stream: { remoteAddress: "127.0.0.1", remotePort: expected.port },
    },
    query: async (sql) => {
      queries.push(String(sql));
      return {
        rows: [{
          database_name: expected.database,
          server_address: "172.18.0.2",
          server_port: 5432,
        }],
      };
    },
  };

  await validateConnectedDatabase(client, expected);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /current_database\(\)/u);
  assert.match(queries[0], /inet_server_addr\(\)/u);
  assert.match(queries[0], /inet_server_port\(\)/u);
});

test("rejects a connected database whose effective target differs", async () => {
  const expected = {
    host: "127.0.0.1",
    port: 5432,
    database: "opentenant_it_store_admission",
  };
  const proof = async (overrides) => validateConnectedDatabase(
    {
      connectionParameters: overrides.connectionParameters ?? expected,
      connection: {
        stream: {
          remoteAddress: overrides.remoteAddress ?? "127.0.0.1",
          remotePort: overrides.remotePort ?? expected.port,
        },
      },
      query: async () => ({ rows: [{
        database_name: overrides.databaseName ?? expected.database,
        server_address: "127.0.0.1",
        server_port: expected.port,
      }] }),
    },
    expected,
  );

  await assert.rejects(
    proof({ databaseName: "application" }),
    /effective database does not match/u,
  );
  await assert.rejects(
    proof({ remoteAddress: "203.0.113.10" }),
    /connected socket address is not loopback/u,
  );
  await assert.rejects(
    proof({ remotePort: 6432 }),
    /connected socket port does not match/u,
  );
  await assert.rejects(
    proof({ connectionParameters: { ...expected, host: "database.example" } }),
    /connection parameters do not match/u,
  );
});

test("rejects missing, unexpected, duplicate, and shared-database suite inventory", () => {
  const actual = STORE_SUITES.map((suite) => suite.testPath);
  assert.doesNotThrow(() => validateSuiteInventory(actual, STORE_SUITES));
  assert.throws(
    () => validateSuiteInventory(actual.slice(1), STORE_SUITES),
    /missing integration suite/u,
  );
  assert.throws(
    () => validateSuiteInventory([...actual, "src/unexpected.integration.test.ts"], STORE_SUITES),
    /unexpected integration suite/u,
  );
  assert.throws(
    () => validateSuiteInventory(actual, [...STORE_SUITES, STORE_SUITES[0]]),
    /duplicate suite path/u,
  );
  assert.throws(
    () => validateSuiteInventory(actual, [
      STORE_SUITES[0],
      { ...STORE_SUITES[1], database: STORE_SUITES[0].database },
      ...STORE_SUITES.slice(2),
    ]),
    /database names must be unique/u,
  );
});

test("prepares only suites that do not reset and migrate their own schema", async () => {
  const statements = [];
  const client = { query: async (sql) => { statements.push(String(sql)); } };
  const migrations = [
    { id: "0001", sql: "create table first_table(id int)" },
    { id: "0002", sql: "create table second_table(id int)" },
  ];

  const suite = (id) => {
    const match = STORE_SUITES.find((candidate) => candidate.id === id);
    assert.ok(match);
    return match;
  };

  await prepareDatabase(client, suite("admission"), migrations);
  assert.deepEqual(statements, []);

  await prepareDatabase(client, suite("brand-proposal"), migrations);
  assert.deepEqual(statements.slice(0, 4), [
    "drop schema if exists public cascade",
    "create schema public",
    "begin",
    migrations[0].sql,
  ]);
  assert.deepEqual(statements.slice(4, 8), [
    "commit",
    "begin",
    migrations[1].sql,
    "commit",
  ]);

  statements.length = 0;
  await prepareDatabase(client, suite("module-ownership"), migrations);
  assert.match(statements.at(-2), /insert into tenants/u);
  assert.match(statements.at(-1), /insert into platform_users/u);

  statements.length = 0;
  await prepareDatabase(client, suite("module-capability"), migrations);
  assert.match(statements.at(-3), /insert into tenants/u);
  assert.match(statements.at(-2), /insert into platform_users/u);
  assert.match(statements.at(-1), /module_creator_capability_authorities/u);
});

test("rolls back a failed control-plane migration", async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(String(sql));
      if (sql === "broken migration") throw new Error("synthetic migration failure");
    },
  };

  await assert.rejects(
    prepareDatabase(
      client,
      STORE_SUITES.find((suite) => suite.id === "brand-proposal"),
      [{ id: "0001", sql: "broken migration" }],
    ),
    /synthetic migration failure/u,
  );
  assert.equal(statements.at(-1), "rollback");
});

test("passes only bounded process state and the current suite URL to Vitest", () => {
  const suite = STORE_SUITES[0];
  const child = buildSuiteEnvironment(
    suite,
    "postgresql://postgres:postgres@127.0.0.1:5432/opentenant_it_store_admission",
    {
      CI: "true",
      PATH: "/usr/bin",
      HOME: "/tmp/synthetic-home",
      SECRET_THAT_MUST_NOT_LEAK: "hidden",
      CONTROL_PLANE_INTEGRATION_DATABASE_URL: "postgresql://wrong.example/application",
    },
  );
  assert.deepEqual(child, {
    CI: "true",
    HOME: "/tmp/synthetic-home",
    PATH: "/usr/bin",
    CONTROL_PLANE_INTEGRATION_DATABASE_URL:
      "postgresql://postgres:postgres@127.0.0.1:5432/opentenant_it_store_admission",
  });
});

test("requires the accepted Node and pnpm runtime versions", () => {
  assert.doesNotThrow(() => validateRuntimeVersions("v22.23.2", "11.13.1"));
  assert.throws(() => validateRuntimeVersions("v23.0.0", "11.13.1"), /Node 22/u);
  assert.throws(() => validateRuntimeVersions("v22.23.2", "10.0.0"), /pnpm 11.13.1/u);
});

test("requires PostgreSQL 17 with pgvector available", () => {
  assert.doesNotThrow(() => validateDatabaseServer({ serverVersionNumber: 170006, vectorAvailable: true }));
  assert.throws(
    () => validateDatabaseServer({ serverVersionNumber: 160012, vectorAvailable: true }),
    /PostgreSQL 17/u,
  );
  assert.throws(
    () => validateDatabaseServer({ serverVersionNumber: 170006, vectorAvailable: false }),
    /pgvector/u,
  );
});

test('accepts a Unix backend only for an explicitly declared local proxy, with loopback still enforced', async () => {
  const expected = { host: '127.0.0.1', port: 55432, database: 'opentenant_it_store_admission' };
  const client = {
    connectionParameters: expected,
    connection: { stream: { remoteAddress: '127.0.0.1', remotePort: expected.port } },
    query: async () => ({ rows: [{ database_name: expected.database, server_address: null, server_port: null }] }),
  };
  await assert.rejects(validateConnectedDatabase(client, expected), /invalid server endpoint/);
  await validateConnectedDatabase(client, { ...expected, allowUnixSocketServer: true });
  client.connection.stream.remoteAddress = '203.0.113.10';
  await assert.rejects(validateConnectedDatabase(client, { ...expected, allowUnixSocketServer: true }), /not loopback/);
});
