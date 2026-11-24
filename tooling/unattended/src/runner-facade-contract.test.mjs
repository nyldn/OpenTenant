import assert from "node:assert/strict";
import { test } from "node:test";
import * as runner from "./runner.mjs";

test("runner compatibility facade preserves every runtime export and representative outcomes", () => {
  assert.deepEqual(Object.keys(runner).sort(), [
    "acquireRunLock",
    "assertTrustedControllerCommitted",
    "authorizePostgresProofCommand",
    "buildAgentArgs",
    "buildFilesystemPermissionConfig",
    "buildRuntimePath",
    "buildSanitizedEnvironment",
    "buildSequentialGraphifyInvocation",
    "buildTaskPrompt",
    "buildVerificationCommand",
    "buildVerificationEnvironment",
    "buildVerificationSandboxArgs",
    "evaluateTaskResult",
    "findIgnoredStateChanges",
    "findOutOfScopePaths",
    "incrementalTypeScriptCachePaths",
    "loadBacklog",
    "parseRunOptions",
    "runIsolatedVerificationProcess",
    "runPremiseVerification",
    "runTasks",
    "runVerification",
    "validateTrustedPostgresProofHelperSource",
  ].sort());

  assert.deepEqual(runner.parseRunOptions(["--execute"]), {
    execute: true,
    maxTasks: 1,
  });
  assert.deepEqual(
    runner.findOutOfScopePaths(
      ["modules/support/src/support-ai.ts", "README.md"],
      ["modules/support/"],
    ),
    ["README.md"],
  );
});
