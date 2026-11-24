import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
  authorizePostgresProofCommand,
  assertTrustedControllerCommitted,
  buildAgentArgs,
  buildSanitizedEnvironment,
  buildSequentialGraphifyInvocation,
  buildTaskPrompt,
  buildRuntimePath,
  buildVerificationCommand,
  buildVerificationEnvironment,
  buildVerificationSandboxArgs,
  acquireRunLock,
  evaluateTaskResult,
  findIgnoredStateChanges,
  findOutOfScopePaths,
  incrementalTypeScriptCachePaths,
  parseRunOptions,
  runIsolatedVerificationProcess,
  runTasks,
  validateTrustedPostgresProofHelperSource,
} from "./runner.mjs";

/** @type {import("./backlog.mjs").UnattendedTask} */
const task = {
  id: "OPS-01",
  priority: 10,
  title: "Owner terminology",
  lane: "spec",
  status: "pending",
  objective: "Introduce installation-owner contracts.",
  source: "docs/architecture/multi-tenant-operations.md#18-delivery-sequence",
  acceptanceCriteria: ["Existing tenant behavior remains covered."],
  dependencies: [],
  ownerGate: false,
  allowedPaths: ["packages/auth/", "docs/"],
  timeoutMinutes: 60,
  verification: [["pnpm", "--filter", "@opentenant/platform", "test"]],
};

test("keeps the active Node runtime available to sanitized child processes", () => {
  const runtimeDirectory = dirname(process.execPath);
  const path = buildRuntimePath(["/custom/bin", runtimeDirectory]);

  assert.equal(path.split(delimiter)[0], runtimeDirectory);
  assert.equal(path.split(delimiter).filter((entry) => entry === runtimeDirectory).length, 1);
  assert.ok(path.split(delimiter).includes("/custom/bin"));
});

test("builds an ephemeral deny-by-default Codex invocation", () => {
  const args = buildAgentArgs(
    "/repo",
    ["/repo-git"],
    ["/repo/packages/auth"],
    ["/repo/node_modules"],
  );
  assert.deepEqual(args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.ok(args.some((argument) => argument.startsWith("permissions.opentenant.filesystem=")));
  assert.ok(args.some((argument) => argument.includes('"/repo-git"="read"')));
  assert.ok(args.some((argument) => argument.includes('"/repo/packages/auth"="write"')));
  assert.ok(args.some((argument) => argument.includes('"/repo/node_modules"="read"')));
  assert.ok(args.some((argument) => argument.includes('":workspace_roots"={"."="read"}')));
  assert.ok(args.includes('default_permissions="opentenant"'));
  assert.ok(args.includes("permissions.opentenant.network.enabled=false"));
  assert.deepEqual(args.slice(-3), ["--cd", "/repo", "-"]);
});

test("does not forward provider or database credentials to child processes", () => {
  assert.deepEqual(
    buildSanitizedEnvironment({
      HOME: "/home/example",
      PATH: "/bin",
      DATABASE_URL: "secret",
      VERCEL_TOKEN: "secret",
      WORKOS_API_KEY: "secret",
      NODE_OPTIONS: "--require=/tmp/untrusted.cjs",
      NODE_PATH: "/tmp/untrusted-modules",
    }),
    {
      GRAPHIFY_SKIP_HOOK: "1",
      HOME: "/home/example",
      PATH: "/bin",
    },
  );
});

test("rejects non-builtin and runtime-loaded imports in the trusted PostgreSQL helper", () => {
  assert.doesNotThrow(() => validateTrustedPostgresProofHelperSource([
    'import { spawnSync } from "node:child_process";',
    'import { lstatSync } from "node:fs";',
  ].join("\n")));
  assert.throws(
    () => validateTrustedPostgresProofHelperSource('import value from "./mutable.mjs";'),
    /node: builtins/u,
  );
  assert.throws(
    () => validateTrustedPostgresProofHelperSource('await import("./mutable.mjs");'),
    /dynamic import/u,
  );
  assert.throws(
    () => validateTrustedPostgresProofHelperSource('import { createRequire } from "node:module";'),
    /createRequire/u,
  );
});

test("verification uses an empty home instead of ambient credential locations", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-verify-home-"));
  try {
    const environment = buildVerificationEnvironment(
      {
        HOME: "/Users/example",
        CODEX_HOME: "/Users/example/.codex",
        XDG_CONFIG_HOME: "/Users/example/.config",
        PATH: "/bin",
        GH_TOKEN: "secret",
      },
      root,
    );
    assert.equal(environment.HOME, root);
    assert.equal(environment.CODEX_HOME, join(root, "codex"));
    assert.equal(environment.XDG_CONFIG_HOME, join(root, "xdg"));
    assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(environment.CI, undefined);
    assert.equal(environment.TERM, "dumb");
    assert.equal(environment.PAGER, "cat");
    assert.equal(environment.GIT_PAGER, "cat");
    assert.equal(environment.npm_config_manage_package_manager_versions, "false");
    assert.equal(environment.GH_TOKEN, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grants only configured incremental TypeScript cache files", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-tsbuildinfo-"));
  try {
    mkdirSync(join(root, "apps/incremental"), { recursive: true });
    mkdirSync(join(root, "apps/non-incremental"), { recursive: true });
    mkdirSync(join(root, "apps/jsonc"), { recursive: true });
    mkdirSync(join(root, "apps/escaped"), { recursive: true });
    writeFileSync(
      join(root, "apps/incremental/tsconfig.json"),
      JSON.stringify({ compilerOptions: { incremental: true } }),
    );
    writeFileSync(
      join(root, "apps/non-incremental/tsconfig.json"),
      JSON.stringify({ compilerOptions: { incremental: false } }),
    );
    writeFileSync(
      join(root, "apps/jsonc/tsconfig.json"),
      '{\n  "compilerOptions": {\n    "incremental": true, // TypeScript accepts JSONC\n  },\n}\n',
    );
    writeFileSync(
      join(root, "apps/escaped/tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          incremental: true,
          tsBuildInfoFile: "../../outside-sensitive-file",
        },
      }),
    );

    const paths = incrementalTypeScriptCachePaths(root);
    assert.deepEqual(paths, [
      join(root, "apps/incremental/tsconfig.tsbuildinfo"),
      join(root, "apps/jsonc/tsconfig.tsbuildinfo"),
    ]);
    assert.equal(paths.some((path) => !path.startsWith(`${root}/`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routes every verification executable through the restricted OS sandbox", () => {
  const args = buildVerificationSandboxArgs(
    "/repo",
    ["/runtime"],
    ["/repo/.next"],
    "graphify",
    ["check-update", "."],
    {
      graphify: "/runtime/graphify",
      git: "/runtime/git",
      node: "/runtime/node",
      pnpm: "/runtime/pnpm",
    },
  );

  assert.deepEqual(args.slice(0, 5), [
    "sandbox",
    "--permission-profile",
    "opentenant",
    "--cd",
    "/repo",
  ]);
  assert.ok(args.includes("permissions.opentenant.network.enabled=false"));
  assert.deepEqual(args.slice(-4), ["--", "/runtime/graphify", "check-update", "."]);
});

test("authorizes only an exact task-bound PostgreSQL proof command", () => {
  const root = dirname(dirname(dirname(dirname(new URL(import.meta.url).pathname))));
  const node = process.execPath;
  const canonicalNode = realpathSync(node);
  const exact = authorizePostgresProofCommand(
    root,
    "PLATFORM-ADMISSION-PG-10",
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "admission"],
    node,
  );

  assert.deepEqual(exact, {
    executable: canonicalNode,
    args: ["tooling/ci/run-local-postgres-proof.mjs", "admission"],
    profile: "admission",
  });
  assert.equal(authorizePostgresProofCommand(
    root,
    "PLATFORM-ADMISSION-HARDEN-15",
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "admission"],
    node,
  )?.profile, "admission");
  assert.equal(authorizePostgresProofCommand(
    root,
    "PLATFORM-USAGE-HARDEN-16",
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "usage"],
    node,
  )?.profile, "usage");
  assert.equal(authorizePostgresProofCommand(
    root,
    "PLATFORM-USAGE-13",
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "admission"],
    node,
  ), null);
  assert.equal(authorizePostgresProofCommand(
    root,
    "PLATFORM-ADMISSION-PG-10",
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "admission", "extra"],
    node,
  ), null);
  assert.equal(authorizePostgresProofCommand(
    root,
    "PLATFORM-ADMISSION-PG-10",
    "node",
    ["-e", "console.log('not trusted')"],
    node,
  ), null);
});

test("requires trusted controller files to match committed HEAD and the protected remote ref", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-controller-integrity-"));
  try {
    mkdirSync(join(root, "tooling/unattended/src"), { recursive: true });
    mkdirSync(join(root, "tooling/ci"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "opentenant" }));
    for (const path of [
      "tooling/unattended/src/runner.mjs",
      "tooling/unattended/src/postgres-proof.mjs",
      "tooling/ci/run-local-postgres-proof.mjs",
    ]) writeFileSync(join(root, path), `${path}\n`);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "trusted"], { cwd: root });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: root });
    assert.doesNotThrow(() => assertTrustedControllerCommitted(root));
    writeFileSync(join(root, "tooling/unattended/src/runner.mjs"), "modified\n");
    assert.throws(() => assertTrustedControllerCommitted(root), /match committed HEAD/u);
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "untrusted"], { cwd: root });
    assert.throws(() => assertTrustedControllerCommitted(root), /do not match refs\/remotes\/origin\/main/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("kills background descendants from an isolated verification process group", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-process-group-"));
  const sentinel = join(root, "survived");
  try {
    const childSource = [
      'const { spawn } = require("node:child_process");',
      `spawn("/bin/sh", ["-c", ${JSON.stringify(`sleep 1; touch ${sentinel}`)}], { stdio: "ignore" }).unref();`,
    ].join("\n");
    const result = runIsolatedVerificationProcess(
      process.execPath,
      process.execPath,
      ["-e", childSource],
      root,
      process.env,
      5_000,
    );
    assert.equal(result.status, 0);
    execFileSync("/bin/sleep", ["1.2"]);
    assert.equal(existsSync(sentinel), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adds only an explicitly authorized Unix socket and executes Node by absolute path", () => {
  const args = buildVerificationSandboxArgs(
    "/repo",
    ["/runtime"],
    ["/proof-home"],
    "node",
    ["tooling/ci/run-local-postgres-proof.mjs", "smoke"],
    {
      graphify: "/runtime/graphify",
      git: "/runtime/git",
      node: "/runtime/node22",
      pnpm: "/runtime/pnpm",
    },
    ["/proof-home/postgres-socket/.s.PGSQL.55439"],
  );

  assert.ok(args.includes("permissions.opentenant.network.enabled=false"));
  assert.deepEqual(
    args.slice(args.indexOf("--allow-unix-socket"), args.indexOf("--")),
    ["--allow-unix-socket", "/proof-home/postgres-socket/.s.PGSQL.55439"],
  );
  assert.deepEqual(args.slice(-4), [
    "--",
    "/runtime/node22",
    "tooling/ci/run-local-postgres-proof.mjs",
    "smoke",
  ]);
});

test("checks whitespace errors across the committed task range", () => {
  assert.deepEqual(
    buildVerificationCommand("git", ["diff", "--check"], "before", "after"),
    { executable: "git", args: ["diff", "--check", "before..after"] },
  );
  assert.deepEqual(
    buildVerificationCommand("pnpm", ["test"], "before", "after"),
    { executable: "pnpm", args: ["test"] },
  );
});

test("refreshes Graphify sequentially inside the macOS sandbox", () => {
  const invocation = buildSequentialGraphifyInvocation(
    "/runtime/graphifyy/bin/graphify",
  );

  assert.equal(invocation.executable, "/runtime/graphifyy/bin/python");
  assert.equal(invocation.args[0], "-c");
  const script = invocation.args[1];
  assert.equal(typeof script, "string");
  if (!script) throw new Error("missing sequential Graphify script");
  assert.match(script, /parallel=False/);
  assert.match(script, /\["graphify", "update", "\."\]/);
});

test("builds a task contract that excludes external and destructive actions", () => {
  const prompt = buildTaskPrompt({ ...task, premiseVerificationCount: 1 }, true);

  assert.match(prompt, /OPS-01/);
  assert.match(prompt, /Existing tenant behavior remains covered/);
  assert.match(prompt, /Do not push, merge, deploy, publish/);
  assert.match(prompt, /Do not read \.env/);
  assert.match(prompt, /Update docs\/plans\/unattended-backlog\.json/);
  assert.match(prompt, /controller ran the first 1 verification command/);
  assert.match(prompt, /Do not rerun that trusted premise command/);
});

test("requires bounded positive task counts and explicit execution", () => {
  assert.deepEqual(parseRunOptions(["--", "--execute", "--max-tasks", "3"]), {
    execute: true,
    maxTasks: 3,
  });
  assert.throws(() => parseRunOptions(["--max-tasks", "0"]), /between 1 and 10/);
  assert.throws(() => parseRunOptions(["--unknown"]), /unknown option/);
});

test("allows only one active run lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "opentenant-unattended-"));
  const lock = join(directory, "state", "run.lock");
  const release = acquireRunLock(lock);
  try {
    assert.throws(() => acquireRunLock(lock), /EEXIST/);
  } finally {
    release();
  }
  const releaseAgain = acquireRunLock(lock);
  releaseAgain();
  rmSync(directory, { recursive: true, force: true });
});

test("recovers a stale lock whose process no longer exists", () => {
  const directory = mkdtempSync(join(tmpdir(), "opentenant-unattended-"));
  const lock = join(directory, "state", "run.lock");
  mkdirSync(join(directory, "state"));
  writeFileSync(lock, JSON.stringify({ pid: 2147483647, startedAt: "2026-07-20T00:00:00Z" }));
  const release = acquireRunLock(lock);
  release();
  rmSync(directory, { recursive: true, force: true });
});

test("serializes stale-lock recovery with an atomic recovery claim", () => {
  const directory = mkdtempSync(join(tmpdir(), "opentenant-unattended-"));
  const lock = join(directory, "state", "run.lock");
  mkdirSync(join(directory, "state"));
  writeFileSync(lock, JSON.stringify({ pid: 2147483647, startedAt: "2026-07-20T00:00:00Z" }));
  mkdirSync(`${lock}.recovery`);

  assert.throws(() => acquireRunLock(lock), /EEXIST/);
  assert.equal(readFileSync(lock, "utf8").includes("2147483647"), true);
  rmSync(directory, { recursive: true, force: true });
});

test("detects committed changes outside the declared path scope", () => {
  assert.deepEqual(
    findOutOfScopePaths(
      ["packages/auth/src/index.ts", "docs/HANDOFF.md", "apps/platform/app/page.tsx"],
      task.allowedPaths,
    ),
    ["apps/platform/app/page.tsx"],
  );
  assert.deepEqual(
    findOutOfScopePaths(
      ["packages/auth/.env.local", "packages/auth/.env.example"],
      task.allowedPaths,
    ),
    ["packages/auth/.env.local"],
  );
});

test("detects new, removed, or renamed ignored state", () => {
  assert.deepEqual(
    findIgnoredStateChanges(
      ["node_modules/", "apps/platform/.next/"],
      ["node_modules/", "apps/platform/.next/", "apps/platform/hidden-cache/"],
    ),
    ["added apps/platform/hidden-cache/"],
  );
  assert.deepEqual(
    findIgnoredStateChanges(["node_modules/"], ["apps/platform/node_modules/"]),
    ["added apps/platform/node_modules/", "removed node_modules/"],
  );
});

test("accepts a task only after status, commit, verification, and cleanliness gates", () => {
  assert.deepEqual(
    evaluateTaskResult({
      agentExitCode: 0,
      beforeHead: "aaa",
      afterHead: "bbb",
      taskStatus: "not_verified",
      dirtyPaths: [],
      verificationExitCodes: [0, 0],
    }),
    { ok: true, reasons: [] },
  );
});

test("stops on any incomplete task evidence", () => {
  assert.deepEqual(
    evaluateTaskResult({
      agentExitCode: 1,
      beforeHead: "aaa",
      afterHead: "aaa",
      taskStatus: "in_progress",
      dirtyPaths: ["src/file.ts"],
      verificationExitCodes: [0, 1],
    }),
    {
      ok: false,
      reasons: [
        "agent exited with code 1",
        "task did not create a checkpoint commit",
        "task status is in_progress, not not_verified",
        "worktree is dirty after task (src/file.ts)",
        "verification command 2 failed with code 1",
      ],
    },
  );
});

function fakeAgentFixture() {
  const root = mkdtempSync(join(tmpdir(), "opentenant-runner-"));
  const bin = join(root, "fake-bin");
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  mkdirSync(bin);
  const backlog = {
    version: 1,
    updatedAt: "2026-07-21",
    tasks: [
      {
        ...task,
        allowedPaths: ["docs/", "feature.txt"],
        premiseVerificationCount: 1,
        verification: [["git", "diff", "--check"]],
      },
    ],
  };
  writeFileSync(
    join(root, "docs/plans/unattended-backlog.json"),
    `${JSON.stringify(backlog, null, 2)}\n`,
  );
  writeFileSync(join(root, ".gitignore"), ".opentenant/unattended/\n");
  writeFileSync(join(root, "README.md"), "fixture\n");
const fakeCodex = join(bin, "codex");
  writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
if (process.argv[2] === "sandbox") {
  fs.mkdirSync(".opentenant/unattended", { recursive: true });
  fs.writeFileSync(".opentenant/unattended/premise-ran", "yes\\n");
  const separator = process.argv.indexOf("--");
  const child = spawnSync(process.argv[separator + 1], process.argv.slice(separator + 2), {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status ?? 1);
}
if (!fs.existsSync(".opentenant/unattended/premise-ran")) process.exit(9);
const path = "docs/plans/unattended-backlog.json";
const backlog = JSON.parse(fs.readFileSync(path, "utf8"));
backlog.tasks[0].status = "not_verified";
fs.writeFileSync(path, JSON.stringify(backlog, null, 2) + "\\n");
fs.writeFileSync("feature.txt", "implemented\\n");
`,
  );
  chmodSync(fakeCodex, 0o755);

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "initial"], { cwd: root });
  return { root, bin };
}

test("runs one fake agent checkpoint then commits independent verification", () => {
  const { root, bin } = fakeAgentFixture();

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    assert.deepEqual(runTasks(root, { execute: true, maxTasks: 1 }), {
      ok: true,
      completed: 1,
      reason: "task limit reached",
    });
    const finalBacklog = JSON.parse(
      readFileSync(join(root, "docs/plans/unattended-backlog.json"), "utf8"),
    );
    assert.equal(finalBacklog.tasks[0].status, "completed");
    assert.equal(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      "3",
    );
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a blocking work review withholds completion and leaves the checkpoint awaiting verification", () => {
  const { root, bin } = fakeAgentFixture();
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  /** @type {string[]} */
  const reviewed = [];
  try {
    const result = runTasks(root, {
      execute: true,
      maxTasks: 1,
      reviewWork: (reviewedTask) => {
        reviewed.push(reviewedTask.id);
        return { stage: "work", blocking: true, ok: false, reasons: ["reviewer found a defect"] };
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons, ["work review blocked", "reviewer found a defect"]);
    assert.deepEqual(reviewed, ["OPS-01"]);
    const finalBacklog = JSON.parse(
      readFileSync(join(root, "docs/plans/unattended-backlog.json"), "utf8"),
    );
    assert.equal(finalBacklog.tasks[0].status, "not_verified");
    assert.equal(
      execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" }).trim(),
      "chore(unattended): checkpoint OPS-01",
    );
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed trusted premise stops before the implementation agent launches", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-premise-failure-"));
  const bin = join(root, "fake-bin");
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    join(root, "docs/plans/unattended-backlog.json"),
    `${JSON.stringify({
      version: 1,
      updatedAt: "2026-08-06T00:00:00Z",
      tasks: [{
        ...task,
        premiseVerificationCount: 1,
        verification: [["node", "-e", "process.exit(0)"]],
      }],
    }, null, 2)}\n`,
  );
  writeFileSync(join(root, ".gitignore"), ".opentenant/unattended/\n");
  writeFileSync(join(root, "README.md"), "fixture\n");
  const fakeCodex = join(bin, "codex");
  writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "sandbox") process.exit(17);
fs.writeFileSync("agent-launched", "unsafe\\n");
`,
  );
  chmodSync(fakeCodex, 0o755);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "initial"], { cwd: root });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    assert.deepEqual(runTasks(root, { execute: true, maxTasks: 1 }), {
      ok: false,
      completed: 0,
      task: "OPS-01",
      reasons: ["premise verification command 1 failed with code 17"],
    });
    assert.equal(existsSync(join(root, "agent-launched")), false);
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovers only a controller checkpoint against its trusted parent backlog", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-recovery-"));
  const bin = join(root, "fake-bin");
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  mkdirSync(bin);
  const backlog = {
    version: 1,
    updatedAt: "2026-07-21",
    tasks: [{
      ...task,
      allowedPaths: ["docs/", "feature.txt"],
      verification: [["git", "diff", "--check"]],
    }],
  };
  const backlogPath = join(root, "docs/plans/unattended-backlog.json");
  writeFileSync(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);
  writeFileSync(join(root, ".gitignore"), ".opentenant/unattended/\n");
  const fakeCodex = join(bin, "codex");
  writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const separator = process.argv.indexOf("--");
const child = spawnSync(process.argv[separator + 1], process.argv.slice(separator + 2), {
  stdio: "inherit",
  env: process.env,
});
process.exit(child.status ?? 1);
`,
  );
  chmodSync(fakeCodex, 0o755);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "initial"], { cwd: root });
  const recoveryTask = backlog.tasks[0];
  assert.ok(recoveryTask);
  recoveryTask.status = "not_verified";
  writeFileSync(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);
  writeFileSync(join(root, "feature.txt"), "implemented\n");
  execFileSync("git", ["add", "docs/plans/unattended-backlog.json", "feature.txt"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-qm", "chore(unattended): checkpoint OPS-01"],
    { cwd: root },
  );

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    assert.deepEqual(runTasks(root, { execute: true, maxTasks: 1 }), {
      ok: true,
      completed: 1,
      reason: "task limit reached",
    });
    assert.equal(JSON.parse(readFileSync(backlogPath, "utf8")).tasks[0].status, "completed");
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery rejects a checkpoint that changed its immutable task contract", () => {
  const root = mkdtempSync(join(tmpdir(), "opentenant-recovery-reject-"));
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  const backlog = {
    version: 1,
    updatedAt: "2026-07-21",
    tasks: [{ ...task, allowedPaths: ["docs/"], verification: [["git", "diff", "--check"]] }],
  };
  const backlogPath = join(root, "docs/plans/unattended-backlog.json");
  writeFileSync(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);
  writeFileSync(join(root, ".gitignore"), ".opentenant/unattended/\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "initial"], { cwd: root });
  const recoveryTask = backlog.tasks[0];
  assert.ok(recoveryTask);
  recoveryTask.status = "not_verified";
  recoveryTask.title = "Tampered owner gate";
  writeFileSync(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);
  execFileSync("git", ["add", "docs/plans/unattended-backlog.json"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-qm", "chore(unattended): checkpoint OPS-01"],
    { cwd: root },
  );
  try {
    const result = runTasks(root, { execute: true, maxTasks: 1 });
    assert.equal(result.ok, false);
    assert.ok("reasons" in result);
    assert.match(result.reasons.join("\n"), /contract changed outside status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed work returns to the same agent with context and blocks after two repair retries", () => {
  const { root, bin } = fakeAgentFixture();
  const fakeCodex = join(bin, 'codex');
  const script = readFileSync(fakeCodex, 'utf8').replace(
    'fs.writeFileSync("feature.txt", "implemented\\n");',
    'const prompt = fs.readFileSync(0, "utf8"); if (fs.existsSync("feature.txt") && !prompt.includes("reviewer found a defect")) process.exit(8); fs.appendFileSync("feature.txt", "implemented\\n");',
  );
  writeFileSync(fakeCodex, script);
  execFileSync("git", ["add", "fake-bin/codex"], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "fixture repair agent"], { cwd: root });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    const originalContract = JSON.parse(readFileSync(join(root, 'docs/plans/unattended-backlog.json'), 'utf8')).tasks[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = runTasks(root, { execute: true, maxTasks: 1, reviewWork: () => ({ ok: false, reasons: ['reviewer found a defect'] }) });
      assert.equal(result.ok, false);
      assert.ok(result.reasons?.includes('work review blocked'), JSON.stringify(result));
    }
    const finalTask = JSON.parse(readFileSync(join(root, 'docs/plans/unattended-backlog.json'), 'utf8')).tasks[0];
    assert.equal(finalTask.status, 'blocked');
    assert.deepEqual({ ...finalTask, status: originalContract.status }, originalContract);
    const packets = readFileSync(join(root, '.opentenant/unattended/failures.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(packets.length, 3);
    assert.equal(packets[2].attempt, 3);
    assert.ok(packets[2].filesTouched.includes('feature.txt'));
  } finally { process.env.PATH = originalPath; rmSync(root, { recursive: true, force: true }); }
});
