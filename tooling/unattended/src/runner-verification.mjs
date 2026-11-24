// @ts-check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  buildFilesystemPermissionConfig,
  buildRuntimePath,
  buildSanitizedEnvironment,
  executablePath,
  incrementalTypeScriptCachePaths,
  managedPnpmExecutable,
  packageTurboDirectories,
  sandboxReadablePaths,
} from "./runner-agent.mjs";
import { recordFailure, redactLog } from "./failures.mjs";
import { changedPaths } from "./runner-git-state.mjs";
import {
  buildPostgresProofEnvironment,
  cleanupPostgresProofCluster,
  completePostgresProofCluster,
  preparePostgresProofCluster,
} from "./postgres-proof.mjs";

const POSTGRES_PROOF_HELPER = "tooling/ci/run-local-postgres-proof.mjs";
const POSTGRES_PROOF_HELPER_SHA256 = "72fee350635a7b8139ab9547d3fbb6386419715436fbed44b227f3895c7081a3";
const TRUSTED_CONTROLLER_REF = "refs/remotes/origin/main";
const ISOLATED_PROCESS_LAUNCHER = [
  'const { spawn } = require("node:child_process");',
  "const [executable, encodedArgs, timeoutText] = process.argv.slice(1);",
  "const args = JSON.parse(encodedArgs);",
  "const timeoutMs = Number(timeoutText);",
  'const child = spawn(executable, args, { detached: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });',
  'let logTail = "";',
  'const collect = (chunk) => { logTail += chunk.toString(); if (process.env.PGPASSWORD) logTail = logTail.replaceAll(process.env.PGPASSWORD, "[REDACTED]"); logTail = logTail.slice(-16384); };',
  'child.stdout.on("data", collect); child.stderr.on("data", collect);',
  "let timedOut = false;",
  "let finishing = false;",
  "const signalGroup = (signal) => { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };",
  "const timer = setTimeout(() => { timedOut = true; signalGroup('SIGTERM'); setTimeout(() => signalGroup('SIGKILL'), 250); }, timeoutMs);",
  "const finish = (code) => {",
  "  if (finishing) return;",
  "  finishing = true;",
  "  clearTimeout(timer);",
  "  signalGroup('SIGTERM');",
  "  setTimeout(() => { signalGroup('SIGKILL'); process.stdout.write(logTail, () => process.exit(timedOut ? 124 : (Number.isInteger(code) ? code : 1))); }, 250);",
  "};",
  "child.once('error', (error) => { console.error(error); finish(1); });",
  "child.once('exit', (code) => finish(code));",
].join("\n");
const POSTGRES_PROOF_PROFILES = new Map([
  ["CONTROLLER-PG-SMOKE", "smoke"],
  ["PLATFORM-ADMISSION-PG-10", "admission"],
  ["PLATFORM-ADMISSION-HARDEN-15", "admission"],
  ["PLATFORM-USAGE-13", "usage"],
  ["PLATFORM-USAGE-HARDEN-16", "usage"],
]);

/**
 * Graphify's macOS process pool uses IPC that the deny-by-default sandbox
 * rejects. Run the installed CLI entry point unchanged apart from forcing its
 * AST extractor into the supported in-process path.
 *
 * @param {string} graphify
 */
export function buildSequentialGraphifyInvocation(graphify) {
  const script = [
    "import runpy, sys",
    "import graphify.extract as extract_module",
    "original_extract = extract_module.extract",
    "extract_module.extract = lambda *args, **kwargs: original_extract(*args, **dict(kwargs, parallel=False))",
    'sys.argv = ["graphify", "update", "."]',
    'runpy.run_module("graphify.__main__", run_name="__main__")',
  ].join("; ");
  return {
    executable: join(dirname(graphify), "python"),
    args: ["-c", script],
  };
}

/** @param {string} source */
export function validateTrustedPostgresProofHelperSource(source) {
  if (/\bimport\s*\(/u.test(source)) {
    throw new Error("trusted PostgreSQL proof helper cannot use dynamic import");
  }
  if (/\bcreateRequire\b/u.test(source)) {
    throw new Error("trusted PostgreSQL proof helper cannot use createRequire");
  }
  const specifiers = [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/gu),
  ].map((match) => match[1]);
  const invalid = specifiers.find((specifier) => !specifier?.startsWith("node:"));
  if (invalid) {
    throw new Error(`trusted PostgreSQL proof helper may import only node: builtins, not ${invalid}`);
  }
}

/**
 * @param {string} root
 * @param {string} taskId
 * @param {string} executable
 * @param {string[]} args
 * @param {string} nodeExecutable
 */
export function authorizePostgresProofCommand(
  root,
  taskId,
  executable,
  args,
  nodeExecutable,
) {
  const profile = POSTGRES_PROOF_PROFILES.get(taskId);
  if (
    !profile
    || executable !== "node"
    || args.length !== 2
    || args[0] !== POSTGRES_PROOF_HELPER
    || args[1] !== profile
  ) return null;

  let trustedNode;
  try {
    trustedNode = realpathSync(nodeExecutable);
  } catch {
    return null;
  }
  const version = spawnSync(trustedNode, ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (version.status !== 0 || !/^v22\./u.test(String(version.stdout).trim())) return null;

  const helperPath = join(root, POSTGRES_PROOF_HELPER);
  let source;
  try {
    source = readFileSync(helperPath, "utf8");
    validateTrustedPostgresProofHelperSource(source);
  } catch {
    return null;
  }
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== POSTGRES_PROOF_HELPER_SHA256) return null;

  return {
    executable: trustedNode,
    args: [...args],
    profile,
  };
}

/** @param {string} root */
export function assertTrustedControllerCommitted(root, trustedRef = TRUSTED_CONTROLLER_REF) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return;
  const packageName = JSON.parse(readFileSync(packagePath, "utf8")).name;
  if (packageName !== "opentenant") return;
  const paths = [
    "tooling/unattended/src",
    POSTGRES_PROOF_HELPER,
    "tooling/db-ephemeral",
    "pnpm-lock.yaml",
  ];
  const status = spawnSync("git", ["status", "--porcelain=v1", "--", ...paths], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (status.status !== 0 || String(status.stdout).trim() !== "") {
    throw new Error("trusted unattended controller and PostgreSQL proof files must match committed HEAD");
  }
  const trustedCommit = spawnSync("git", ["rev-parse", "--verify", `${trustedRef}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (trustedCommit.status !== 0) {
    throw new Error(`trusted unattended controller ref is unavailable: ${trustedRef}`);
  }
  const trustedDiff = spawnSync("git", ["diff", "--quiet", trustedRef, "--", ...paths], {
    cwd: root,
    shell: false,
  });
  if (trustedDiff.status !== 0) {
    throw new Error(`trusted unattended controller files do not match ${trustedRef}`);
  }
  for (const path of [
    "tooling/unattended/src/runner.mjs",
    "tooling/unattended/src/postgres-proof.mjs",
    POSTGRES_PROOF_HELPER,
  ]) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", path], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (tracked.status !== 0) throw new Error(`trusted controller file is not committed: ${path}`);
  }
}

/**
 * @param {string} nodeExecutable
 * @param {string} executable
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} environment
 * @param {number} timeoutMs
 */
export function runIsolatedVerificationProcess(
  nodeExecutable,
  executable,
  args,
  cwd,
  environment,
  timeoutMs,
) {
  return spawnSync(nodeExecutable, [
    "-e",
    ISOLATED_PROCESS_LAUNCHER,
    executable,
    JSON.stringify(args),
    String(timeoutMs),
  ], {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    timeout: timeoutMs + 10_000,
  });
}

/** @param {NodeJS.ProcessEnv} source @param {string} home */
export function buildVerificationEnvironment(source, home) {
  const environment = buildSanitizedEnvironment(source);
  environment.TERM = "dumb";
  environment.PAGER = "cat";
  environment.GIT_PAGER = "cat";
  environment.npm_config_manage_package_manager_versions = "false";
  environment.HOME = home;
  environment.CODEX_HOME = join(home, "codex");
  environment.XDG_CONFIG_HOME = join(home, "xdg");
  environment.TMPDIR = join(home, "tmp");
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  if (existsSync("/Library/Developer/CommandLineTools")) {
    environment.DEVELOPER_DIR = "/Library/Developer/CommandLineTools";
  }
  environment.XCRUN_NO_CACHE = "1";
  environment.NPM_CONFIG_USERCONFIG = join(home, ".npmrc-missing");
  environment.npm_config_manage_package_manager_versions = "false";
  for (const directory of [environment.CODEX_HOME, environment.XDG_CONFIG_HOME, environment.TMPDIR]) {
    if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return environment;
}

/**
 * @param {string} root
 * @param {string[]} readablePaths
 * @param {string[]} writablePaths
 * @param {string} executable
 * @param {string[]} args
 * @param {{graphify: string, git: string, node: string, pnpm: string}} executables
 * @param {string[]} [unixSockets]
 */
export function buildVerificationSandboxArgs(
  root,
  readablePaths,
  writablePaths,
  executable,
  args,
  executables,
  unixSockets = [],
) {
  const resolvedExecutable =
    executable === "graphify"
      ? executables.graphify
      : executable === "git"
        ? executables.git
        : executable === "node"
          ? executables.node
        : executable === "pnpm"
          ? executables.pnpm
          : executable;
  return [
    "sandbox",
    "--permission-profile",
    "opentenant",
    "--cd",
    root,
    "--config",
    buildFilesystemPermissionConfig(readablePaths, writablePaths, "read"),
    "--config",
    "permissions.opentenant.network.enabled=false",
    ...unixSockets.flatMap((socket) => ["--allow-unix-socket", socket]),
    "--",
    resolvedExecutable,
    ...args,
  ];
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {string} beforeHead
 * @param {string} afterHead
 */
export function buildVerificationCommand(executable, args, beforeHead, afterHead) {
  if (executable === "git" && args.length === 2 && args[0] === "diff" && args[1] === "--check") {
    return { executable, args: [...args, `${beforeHead}..${afterHead}`] };
  }
  return { executable, args };
}

/**
 * @param {string} root
 * @param {import("./backlog.mjs").UnattendedTask} task
 * @param {string} beforeHead
 * @param {string} afterHead
 */
export function runVerification(root, task, beforeHead, afterHead) {
  const stateDirectory = join(root, ".opentenant/unattended");
  mkdirSync(stateDirectory, { recursive: true });
  const home = realpathSync(mkdtempSync("/tmp/otv-"));
  const environment = buildVerificationEnvironment(process.env, home);
  const codex = executablePath("codex");
  const graphify = executablePath("graphify");
  const git = executablePath("git");
  const pnpm = managedPnpmExecutable(root);
  const node = realpathSync(process.execPath);
  const commandLineTools = "/Library/Developer/CommandLineTools/usr/bin";
  environment.PATH = buildRuntimePath([
    "/opt/homebrew/opt/node@22/bin",
    pnpm ? dirname(pnpm) : "",
    commandLineTools,
    "/opt/homebrew/bin",
    dirname(graphify),
  ]);
  const readablePaths = sandboxReadablePaths(root);
  const writablePaths = [
    home,
    join(root, "node_modules/.cache"),
    join(root, "apps/platform/.next"),
    join(root, "apps/platform/app/.well-known/workflow/v1"),
    join(root, "templates/tenant-module-nextjs/.next"),
    ...packageTurboDirectories(root),
    ...incrementalTypeScriptCachePaths(root),
  ];
  for (const path of writablePaths) {
    if (!path.endsWith(".tsbuildinfo")) mkdirSync(path, { recursive: true });
  }
  /** @type {Array<{command: string[], log: string}>} */
  const failures = [];
  const codes = task.verification.map(([executable, ...args]) => {
    if (!executable) return 1;
    const command = buildVerificationCommand(executable, args, beforeHead, afterHead);
    const isProofCommand = command.executable === "node"
      && command.args[0] === POSTGRES_PROOF_HELPER;
    const proof = authorizePostgresProofCommand(
      root,
      task.id,
      command.executable,
      command.args,
      node,
    );
    if (isProofCommand && !proof) {
      console.error(`refusing unauthorized PostgreSQL proof command for ${task.id}`);
      failures.push({ command: [executable, ...args], log: "unauthorized PostgreSQL proof command" });
      return 1;
    }
    let cluster;
    try {
      if (proof) {
        assertTrustedControllerCommitted(root);
        cluster = preparePostgresProofCluster(root, proof.profile);
      }
      const commandEnvironment = cluster
        ? buildPostgresProofEnvironment(environment, cluster)
        : environment;
      const sandboxArgs = buildVerificationSandboxArgs(
        root,
        readablePaths,
        writablePaths,
        proof?.executable ?? command.executable,
        proof?.args ?? command.args,
        {
          graphify,
          git,
          node,
          pnpm: pnpm || "pnpm",
        },
        cluster ? [cluster.socketPath] : [],
      );
      const timeoutMs = 30 * 60 * 1000;
      const result = runIsolatedVerificationProcess(
        node, codex, sandboxArgs, root, commandEnvironment, timeoutMs,
      );
      let status = result.status ?? 1;
      let log = redactLog(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, cluster ? [cluster.password] : []);
      if (cluster) {
        try {
          assertTrustedControllerCommitted(root);
          completePostgresProofCluster(cluster);
        } catch (error) {
          console.error(error instanceof Error ? error.stack ?? error.message : String(error));
          log += "\nController SQL corroboration failed";
          status = 1;
        }
      }
      if (status !== 0) failures.push({ command: [executable, ...args], log });
      if (log.trim()) console.log(log.slice(-8192));
      return status;
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      failures.push({ command: [executable, ...args], log: error instanceof Error ? error.message : String(error) });
      return 1;
    } finally {
      if (cluster) cleanupPostgresProofCluster(cluster);
    }
  });
  if (failures.length) recordFailure(root, { taskId: task.id, stage: "verification", command: failures[0]?.command ?? [], log: failures.map(f => f.log).join("\n"), filesTouched: changedPaths(root, beforeHead, afterHead), baseHead: beforeHead, checkpointHead: afterHead });
  rmSync(home, { recursive: true, force: true });
  return codes;
}

/**
 * Run a declared verification prefix in the trusted controller sandbox before
 * the restricted implementation agent starts. This is for immutable source or
 * environment premises that the agent sandbox cannot establish itself.
 *
 * @param {string} root
 * @param {import("./backlog.mjs").UnattendedTask} task
 * @param {string} head
 */
export function runPremiseVerification(root, task, head) {
  const count = task.premiseVerificationCount ?? 0;
  if (count === 0) return [];
  return runVerification(
    root,
    { ...task, verification: task.verification.slice(0, count) },
    head,
    head,
  );
}
