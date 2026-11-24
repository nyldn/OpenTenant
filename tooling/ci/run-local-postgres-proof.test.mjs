import assert from "node:assert/strict";
import test from "node:test";

import {
  validateVitestReport,
} from "./run-local-postgres-proof.mjs";

test("rejects skipped, failed, missing, and forged Vitest corroboration", () => {
  const expected = {
    file: "/repo/example.integration.test.ts",
    titles: ["commits one durable row", "rejects a conflicting replay"],
    minimumTests: 2,
  };
  const passing = {
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{
      name: expected.file,
      status: "passed",
      assertionResults: expected.titles.map((title) => ({ title, status: "passed" })),
    }],
  };

  assert.deepEqual(validateVitestReport(passing, expected), { executed: 2, passed: 2 });
  assert.throws(
    () => validateVitestReport({ ...passing, numPendingTests: 1 }, expected),
    /skipped or pending/u,
  );
  assert.throws(
    () => validateVitestReport({ ...passing, numFailedTests: 1 }, expected),
    /failed/u,
  );
  assert.throws(
    () => validateVitestReport({ ...passing, numTotalTests: 99 }, expected),
    /inconsistent/u,
  );
  assert.throws(
    () => validateVitestReport({ ...passing, testResults: [] }, expected),
    /missing test file/u,
  );
});
