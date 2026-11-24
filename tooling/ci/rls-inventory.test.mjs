/**
 * Offline guard: every tenant-plane table a migration creates must be declared
 * in the RLS proof's TABLES inventory.
 *
 * The live RLS proof asserts the inventory is exact, but it needs PostgreSQL
 * and therefore only runs in CI. OPS-10 added five support.slack_* tables
 * without registering them, so the proof failed on main for three hours while
 * every declared task check passed, because no task's verification profile can
 * start a database.
 *
 * This test closes that gap. It parses the migration SQL and the proof's
 * inventory as text, needs no database, and runs inside the unattended
 * sandbox, so a new table is caught at the point it is added rather than after
 * it reaches main.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsRoot = join(here, "..", "migrations", "sql");

/** Migration directories whose tables live in a tenant data plane. */
const TENANT_PLANE_DIRECTORIES = ["tenant-core", "tenant-brain", "tenant-support"];

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const DROP_TABLE = /drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const DECLARED_TABLE = /\{\s*schema:\s*"([a-z_]+)",\s*table:\s*"([a-z_0-9]+)"/g;

function collect(pattern, sql, into) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(sql)) !== null) into(`${match[1]}.${match[2]}`);
}

function migratedTenantTables() {
  const live = new Set();
  for (const directory of TENANT_PLANE_DIRECTORIES) {
    let files;
    try {
      files = readdirSync(join(migrationsRoot, directory)).filter((name) => name.endsWith(".sql")).sort();
    } catch {
      continue; // A plane with no migrations yet is not a failure.
    }
    for (const file of files) {
      const sql = readFileSync(join(migrationsRoot, directory, file), "utf8");
      collect(CREATE_TABLE, sql, (name) => live.add(name));
      collect(DROP_TABLE, sql, (name) => live.delete(name));
    }
  }
  return live;
}

function declaredTables() {
  const source = readFileSync(join(here, "rls-proof.mjs"), "utf8");
  const declared = new Set();
  collect(DECLARED_TABLE, source, (name) => declared.add(name));
  return declared;
}

test("every migrated tenant table is declared in the RLS proof inventory", () => {
  const live = migratedTenantTables();
  const declared = declaredTables();

  assert.ok(live.size > 0, "no tenant tables were parsed; the migration layout has moved");

  const undeclared = [...live].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(
    undeclared,
    [],
    `these tables are created by a migration but missing from TABLES in rls-proof.mjs, so the live proof will fail on main: ${undeclared.join(", ")}`,
  );
});

test("the RLS proof inventory declares no table that no migration creates", () => {
  const live = migratedTenantTables();
  const declared = declaredTables();

  const stale = [...declared].filter((name) => !live.has(name)).sort();
  assert.deepEqual(
    stale,
    [],
    `these tables are declared in rls-proof.mjs but no migration creates them: ${stale.join(", ")}`,
  );
});

test("exhaustive proof provisions exclusively through canonical helpers", () => {
  const source = readFileSync(join(here, "rls-proof.mjs"), "utf8");
  assert(source.includes("await prepareTenantDatabase(ownerUrl, TENANT"));
  assert(source.includes("await createAppRole(ownerUrl)"));
  assert(!/readFileSync|migrationsIn|organization_id|grant |create role|alter role|\.sql["'`]/i.test(source));
  assert.equal(declaredTables().size, 41);
});
