import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const images = {
  node: "node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb",
  alpine: "alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412",
  postgres: "pgvector/pgvector:0.8.2-pg17-bookworm@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966",
  mailpit: "axllent/mailpit:v1.27.8@sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707",
};
export function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 600_000 });
}
export function pull(image) {
  docker(["pull", image]);
}
export function ownedContainer() {
  const name = `opentenant-proof-${randomUUID()}`;
  // Existing controller-death janitor also handles SIGKILL of this launcher.
  const janitor = spawn(process.execPath, [new URL("../db-ephemeral/cleanup.mjs", import.meta.url).pathname, name], { stdio: ["pipe", "inherit", "inherit"] });
  const stop = () => {
    spawnSync("docker", ["rm", "-fv", name], { stdio: "ignore", timeout: 30_000 });
  };
  const interrupt = () => { stop(); process.exit(1); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  return { name, async dispose() {
    stop();
    janitor.stdin.end();
    await new Promise(resolve => janitor.once("exit", resolve));
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim()) throw new Error(`Container cleanup failed: ${name}`);
  } };
}
export function run(command, args, env = process.env, timeout = 600_000) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", timeout, killSignal: "SIGTERM" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}, signal ${result.signal}`);
}
export function assertReport(report, expected) {
  if (report.numPassedTests !== expected || report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0) {
    throw new Error(`Proof requires ${expected} passed, zero failed/skipped/todo; got ${report.numPassedTests}/${report.numFailedTests}/${report.numPendingTests}/${report.numTodoTests}`);
  }
}
