import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluatePreflight,
  findSecretFiles,
  parsePorcelainPaths,
} from "./preflight.mjs";

/**
 * @param {Partial<import("./preflight.mjs").PreflightInput>} overrides
 * @returns {import("./preflight.mjs").PreflightInput}
 */
function input(overrides = {}) {
  return {
    branch: "codex/example",
    nodeVersion: "v22.23.1",
    pnpmVersion: "11.13.1",
    dirtyPaths: [],
    secretFiles: [],
    missingRequiredFiles: [],
    graphCheck: "fresh",
    codexAvailable: true,
    gitOperation: null,
    execute: true,
    ...overrides,
  };
}

test("accepts a clean isolated Node 22 feature worktree", () => {
  assert.deepEqual(evaluatePreflight(input()), { ok: true, reasons: [] });
});

test("rejects main, wrong tools, dirt, secrets, stale graph, and missing records", () => {
  const result = evaluatePreflight(
    input({
      branch: "main",
      nodeVersion: "v26.5.0",
      pnpmVersion: "10.0.0",
      dirtyPaths: ["README.md"],
      secretFiles: [".env"],
      missingRequiredFiles: ["docs/HANDOFF.md"],
      graphCheck: "stale",
      codexAvailable: false,
      gitOperation: "rebase",
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, [
    "refusing to run on main",
    "Node.js 22 is required (found v26.5.0)",
    "pnpm 11.13.1 is required (found 10.0.0)",
    "worktree must be clean (README.md)",
    "secret-bearing environment files are present (.env)",
    "required repository records are missing (docs/HANDOFF.md)",
    "Graphify reports stale repository knowledge",
    "Codex CLI is required for --execute",
    "unfinished Git operation detected (rebase)",
  ]);
});

test("does not require Codex for dry-run commands", () => {
  assert.equal(
    evaluatePreflight(input({ codexAvailable: false, execute: false })).ok,
    true,
  );
});

test("preserves leading dots in NUL-delimited Git status paths", () => {
  assert.deepEqual(
    parsePorcelainPaths(" M .gitignore\0?? tooling/unattended/\0"),
    [".gitignore", "tooling/unattended/"],
  );
});

test("finds nested environment files but ignores examples and dependency trees", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-preflight-"));
  mkdirSync(join(root, "apps/platform"), { recursive: true });
  mkdirSync(join(root, "node_modules/example"), { recursive: true });
  writeFileSync(join(root, "apps/platform/.env.local"), "secret");
  writeFileSync(join(root, "apps/platform/.env.example"), "safe");
  writeFileSync(join(root, "node_modules/example/.env"), "ignored");
  try {
    assert.deepEqual(findSecretFiles(root), ["apps/platform/.env.local"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a skipped graph check is not reported as staleness", () => {
  // Graphify is deliberately not run when secret files are present. Coding that
  // as stale sent the operator looking for a stale graph that was current.
  const result = evaluatePreflight(input({ graphCheck: "skipped", secretFiles: [".env"] }));
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes("secret-bearing")),
    "the real reason must still fire",
  );
  assert.ok(
    !result.reasons.some((reason) => reason.includes("Graphify")),
    "a skipped check must not add a staleness reason",
  );
});

test("a genuinely stale graph still fails", () => {
  const result = evaluatePreflight(input({ graphCheck: "stale" }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Graphify")));
});
