import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { STEPS, validateSequenceReport } from "./db-sequence.mjs";
import { SEQUENCE_COUNTS } from "./db-sequence-counts.mjs";
import { workspace } from "./db-sequence-inventory.test.mjs";
const root = resolve(import.meta.dirname, "../..");
const expected = { suites: 2, files: { "example.integration.test.ts": 2 } };
const passing = () => ({ success: true, numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numPendingTestSuites: 0, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ name: `${root}/example.integration.test.ts`, status: "passed", assertionResults: [{ status: "passed" }, { status: "passed" }] }] });

test("every sequence family declares exact suite and per-file case counts", () => {
  assert.deepEqual(Object.keys(SEQUENCE_COUNTS).sort(), STEPS.filter(step => step.id !== "stores").map(step => step.id).sort());
  for (const step of STEPS.filter(step => step.id !== "stores")) {
    const counts = SEQUENCE_COUNTS[step.id];
    assert.ok(Number.isSafeInteger(counts.suites) && counts.suites > 0);
    assert.ok(Object.values(counts.files).every(count => Number.isSafeInteger(count) && count > 0));
    if (step.files) assert.deepEqual(Object.keys(counts.files).sort(), step.files.map(file => `${workspace(step.filter)}/${file}`).sort());
  }
});

test("zero-skip proof validates file identity and every assertion, not only green totals", () => {
  assert.deepEqual(validateSequenceReport(passing(), expected), { ...expected, tests: 2, skipped: 0 });
  for (const key of ["numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"]) {
    assert.throws(() => validateSequenceReport({ ...passing(), [key]: 99 }, expected), /exact suite\/case/u, key);
  }
  const report = passing();
  assert.throws(() => validateSequenceReport({ ...report, testResults: [] }, expected), /missing test files/u);
  assert.throws(() => validateSequenceReport({ ...report, testResults: [...report.testResults, ...report.testResults] }, expected), /duplicate/u);
  report.testResults[0].assertionResults[0].status = "pending";
  assert.throws(() => validateSequenceReport(report, expected), /non-passing/u);
  report.testResults[0].name = `${root}/unexpected.integration.test.ts`;
  assert.throws(() => validateSequenceReport(report, expected), /unexpected/u);
});
