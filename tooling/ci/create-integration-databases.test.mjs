import assert from "node:assert/strict";
import test from "node:test";

import { createIntegrationDatabases, DATABASES } from "./create-integration-databases.mjs";

function fakeClient({ remoteAddress = "127.0.0.1", database = "postgres", vector = true } = {}) {
  const queries = [];
  let constructed = 0;

  class Client {
    constructor(config) {
      constructed += 1;
      this.connectionParameters = {
        host: config.host,
        port: config.port,
        database: config.database,
      };
      this.connection = {
        stream: { remoteAddress, remotePort: config.port },
      };
    }

    async connect() {}

    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes("current_database()")) {
        return {
          rows: [{
            database_name: database,
            server_address: "172.18.0.2",
            server_port: 5432,
          }],
        };
      }
      if (String(sql).includes("pg_available_extensions")) return { rows: [{ version: "170006", vector }] };
      return { rows: [] };
    }

    async end() {}
  }

  return { Client, queries, constructed: () => constructed };
}

test("rejects admin URL overrides before constructing a client", async () => {
  const fake = fakeClient();
  await assert.rejects(
    createIntegrationDatabases(
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres?host=database.example",
      { Client: fake.Client },
    ),
    /connection options/u,
  );
  assert.equal(fake.constructed(), 0);
  assert.deepEqual(fake.queries, []);
});

test("verifies the effective admin target before dropping databases", async () => {
  const fake = fakeClient({ remoteAddress: "203.0.113.8" });
  await assert.rejects(
    createIntegrationDatabases(
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      { Client: fake.Client },
    ),
    /socket address is not loopback/u,
  );
  assert.equal(fake.queries.length, 0);
});

test("creates fixed integration databases only after connection proof", async () => {
  const fake = fakeClient();
  const created = await createIntegrationDatabases(
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    { Client: fake.Client, log: () => {} },
  );

  assert.equal(created, DATABASES.length);
  assert.equal(new Set(DATABASES).size, 27);
  assert.ok(DATABASES.includes("opentenant_it_worker_tenant"));
  assert.ok(DATABASES.includes("opentenant_it_identity_control"));
  assert.ok(DATABASES.includes("opentenant_it_postgres_control"));
  assert.match(fake.queries[0], /current_database\(\)/u);
  assert.equal(fake.queries.filter((sql) => sql.startsWith("drop database")).length, DATABASES.length);
  assert.equal(fake.queries.filter((sql) => sql.startsWith("create database")).length, DATABASES.length);
});

 test("missing pgvector fails before any database is dropped", async () => {
  const fake = fakeClient({ vector: false });
  await assert.rejects(createIntegrationDatabases("postgresql://postgres:postgres@127.0.0.1:55433/postgres", { Client: fake.Client }), /pgvector/u);
  assert.equal(fake.queries.some(sql => sql.startsWith("drop database")), false);
});
