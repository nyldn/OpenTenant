import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STEPS } from "./db-sequence.mjs";
import { STORE_SUITES } from "./run-database-store-tests.mjs";
import { DATABASE_TEST_EXEMPTIONS } from "./db-sequence-exemptions.mjs";
import { sourceInventory, inspectEnvironment, isTestSource, repositoryRoot } from "./runtime-env-inventory.mjs";

/** @param {string | undefined} filter */
export function workspace(filter) {
  if (filter === "platform") return "apps/platform";
  if (filter === "support") return "modules/support";
  if (filter === "migrations") return "tooling/migrations";
  return `packages/${filter}`;
}

test("every integration test and database URL test has an explicit CI owner", () => {
  const registered = [
    ...STEPS.flatMap(step => step.files?.map(file => `${workspace(step.filter)}/${file}`) ?? []),
    ...STORE_SUITES.map(suite => `packages/database/${suite.testPath}`),
    "packages/testing/src/isolation-fuzz.test.ts",
  ];
  assert.equal(new Set(registered).size, registered.length, "duplicate database test registration");
  const discovered = sourceInventory().filter(path => isTestSource(path, readFileSync(resolve(repositoryRoot, path), "utf8")))
    .filter(path => /\.integration\.(?:test\.)?[cm]?[jt]sx?$/u.test(path) || inspectEnvironment(path).databaseVariables.length > 0);
  const exceptions = DATABASE_TEST_EXEMPTIONS.map(entry => entry.path);
  assert.equal(new Set(exceptions).size, exceptions.length);
  for (const entry of DATABASE_TEST_EXEMPTIONS) {
    assert.ok(entry.reason.length > 40, entry.path);
    assert.ok(discovered.includes(entry.path), `remove stale exemption: ${entry.path}`);
    assert.ok(!registered.includes(entry.path), `remove registered exemption: ${entry.path}`);
  }
  assert.deepEqual(discovered.filter(path => !registered.includes(path) && !exceptions.includes(path)), [], "register every new database test with required URLs and expected counts");
});

test("database discovery includes computed URLs, helper arguments, and alternate test extensions", () => {
  assert.deepEqual(inspectEnvironment("fixture.test.ts", 'const a = process.env["EXAMPLE_DATABASE_URL"]; integrationDatabaseUrl("OTHER_DATABASE_URL");').databaseVariables, ["EXAMPLE_DATABASE_URL", "OTHER_DATABASE_URL"]);
});
