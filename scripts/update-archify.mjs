import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = ".agents/skills/archify";
const lockPath = "skills-lock.json";
const generatedGraphPath = "graphify-out/";
const archifyCli = resolve(repositoryRoot, skillPath, "bin/archify.mjs");
const nodeDirectory = dirname(process.execPath);
const npxPath = resolve(nodeDirectory, "npx");
// The updater runs unattended at login, so the installer CLI is pinned
// rather than resolved to whatever npm publishes next. Bump deliberately.
const skillsCli = "skills@1.7.0";
const updateCommand = ["--yes", skillsCli, "update", "archify", "--project", "--yes"];

// Only what npx and git need; the login environment's tokens and cloud
// credentials never reach third-party updater code.
const env = {
  HOME: process.env.HOME ?? "",
  USER: process.env.USER ?? "",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  PATH: [nodeDirectory, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    .filter(Boolean)
    .join(":"),
  GRAPHIFY_SKIP_HOOK: "1",
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
}

function log(message) {
  console.log(`[archify-update] ${message}`);
}

function gitStatus() {
  return run("git", ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trimEnd();
}

function changedPaths() {
  return gitStatus()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function isAllowedPath(path) {
  return path === lockPath || path.startsWith(`${skillPath}/`);
}

function isExpectedGeneratedPath(path) {
  return path.startsWith(generatedGraphPath);
}

function gitPath(name) {
  return resolve(repositoryRoot, run("git", ["rev-parse", "--git-path", name]).stdout.trim());
}

function fail(message) {
  console.error(`[archify-update] ${message}`);
  process.exitCode = 1;
}

const branch = run("git", ["branch", "--show-current"]).stdout.trim();
if (branch !== "main") {
  log(`skipping because the current branch is ${branch || "detached"}`);
  process.exit(0);
}

if (["CHERRY_PICK_HEAD", "MERGE_HEAD", "REVERT_HEAD", "BISECT_LOG", "sequencer"].some((name) => existsSync(gitPath(name)))) {
  log("skipping because Git has an operation in progress");
  process.exit(0);
}

if (changedPaths().some((path) => !isExpectedGeneratedPath(path))) {
  log("skipping because the checkout has uncommitted work");
  process.exit(0);
}

// Generated graph changes are tolerated in the worktree, but anything already
// staged would be swept into the Archify commit.
if (run("git", ["diff", "--cached", "--name-only"]).stdout.trim() !== "") {
  log("skipping because the index has staged changes");
  process.exit(0);
}

if (!existsSync(archifyCli)) {
  fail(`missing installed skill at ${skillPath}`);
  process.exit();
}

log("checking upstream Archify and updating the project-local copy");
const update = run(npxPath, updateCommand, { timeout: 120_000 });
if (update.stdout) process.stdout.write(update.stdout);
if (update.stderr) process.stderr.write(update.stderr);
if (update.error || update.status !== 0) {
  fail(`skills update failed${update.error ? `: ${update.error.message}` : ` with exit ${update.status}`}`);
  process.exit();
}

const paths = changedPaths();
const archifyChanges = paths.filter(isAllowedPath);
if (archifyChanges.length === 0) {
  log("no Archify update is available");
  process.exit(0);
}

const unexpected = paths.filter(
  (path) => !isAllowedPath(path) && !isExpectedGeneratedPath(path),
);
if (unexpected.length > 0) {
  fail(`refusing to commit unexpected paths: ${unexpected.join(", ")}`);
  process.exit();
}

const doctor = run(process.execPath, [archifyCli, "doctor"], { timeout: 120_000 });
if (doctor.stdout) process.stdout.write(doctor.stdout);
if (doctor.stderr) process.stderr.write(doctor.stderr);
if (doctor.error || doctor.status !== 0) {
  fail(`Archify doctor failed${doctor.error ? `: ${doctor.error.message}` : ` with exit ${doctor.status}`}`);
  process.exit();
}

const diffCheck = run("git", ["diff", "--check", "--", skillPath, lockPath]);
if (diffCheck.status !== 0) {
  if (diffCheck.stdout) process.stdout.write(diffCheck.stdout);
  if (diffCheck.stderr) process.stderr.write(diffCheck.stderr);
  fail("Archify update failed git diff --check");
  process.exit();
}

const stage = run("git", ["add", "-A", "--", skillPath, lockPath]);
if (stage.error || stage.status !== 0) {
  fail(`could not stage the Archify update${stage.error ? `: ${stage.error.message}` : ""}`);
  process.exit();
}

const commit = run("git", ["commit", "--no-verify", "-m", "chore: update Archify project skill", "--", skillPath, lockPath], {
  timeout: 120_000,
});
if (commit.stdout) process.stdout.write(commit.stdout);
if (commit.stderr) process.stderr.write(commit.stderr);
if (commit.error || commit.status !== 0) {
  fail(`could not commit the Archify update${commit.error ? `: ${commit.error.message}` : ` with exit ${commit.status}`}`);
  process.exit();
}

if (changedPaths().some((path) => !isExpectedGeneratedPath(path))) {
  fail("Archify update committed, but the checkout is still dirty");
  process.exit();
}

log("updated and committed locally; nothing was pushed");
