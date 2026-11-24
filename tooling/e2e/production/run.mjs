import { spawn } from "node:child_process";
import { open, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cpus, totalmem } from "node:os";
import { connect } from "node:net";
import { hostEnvironment } from "../safety.mjs";

// Invoke this whole launcher inside forge-job. It owns the built UAT stack,
// browser, and foreground wait; it never adopts an existing manual stack.
const root = resolve(import.meta.dirname, "../../..");
const output = join(root, "tooling/e2e/test-results/production");
await mkdir(output, { recursive: true });
await writeFile(join(output, "measurements.jsonl"), "");
const log = await open(join(output, "stack.log"), "w", 0o600);
const stack = spawn(process.execPath, ["tooling/e2e/production/stack.mjs", ...(process.argv.includes("--build") ? ["--build"] : [])], {
  cwd: root, env: hostEnvironment(process.env), stdio: ["ignore", log.fd, log.fd],
});
let tests;
let interrupted = false;
const stop = () => { interrupted = true; tests?.kill("SIGTERM"); stack.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const exited = child => new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
const stackExit = exited(stack);
let acquired = false;
let ports = [];
try {
  for (let i = 0; i < 1200; i++) {
    if (interrupted || stack.exitCode !== null || stack.signalCode) throw new Error("Built UAT startup failed; inspect private test-results/production/stack.log");
    try {
      acquired = JSON.parse(await readFile(join(root, ".uat/active/owner.json"), "utf8")).pid === stack.pid;
      if (acquired) {
        const manifest = JSON.parse(await readFile(join(root, ".uat/manifest.json"), "utf8"));
        if (manifest.mode !== "start" || manifest.identityProvider !== "better-auth") throw new Error("Expected built Better Auth stack");
        ports = Object.values(manifest.ports);
        break;
      }
    } catch { /* Wait for this launcher's atomic manifest, never reuse another. */ }
    if (i === 1199) throw new Error("Built UAT startup timed out");
    await delay(500);
  }
  const cgroup = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1);
  const profile = {
    node: process.version, cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, hostMemoryBytes: totalmem(),
    cgroupMemoryMax: (await readFile(`/sys/fs/cgroup${cgroup}/memory.max`, "utf8")).trim(),
    cgroupCpuMax: (await readFile(`/sys/fs/cgroup${cgroup}/cpu.max`, "utf8")).trim(),
    mode: "next start", identity: "Better Auth database fixtures; persona GET, no identity form POST/sign-out",
    ports, startedAt: new Date().toISOString(),
  };
  await writeFile(join(output, "profile.json"), JSON.stringify(profile, null, 2));
  tests = spawn("pnpm", ["exec", "playwright", "test", "--config", "production/config.ts", ...(process.argv.includes("--rendering-only") ? ["--grep", "mobile lab|production CSV"] : [])], {
    cwd: join(root, "tooling/e2e"), stdio: "inherit", env: {
      ...process.env, PRODUCTION_RUNNER_PID: String(process.pid),
      PRODUCTION_BASELINE: process.argv.includes("--baseline") ? "1" : "0",
    },
  });
  process.exitCode = await exited(tests);
} finally {
  stop();
  await Promise.race([stackExit, delay(45_000, undefined, { ref: false }).then(() => { if (stack.exitCode === null && !stack.signalCode) stack.kill("SIGKILL"); })]);
  if (acquired) {
    const down = spawn(process.execPath, ["tooling/uat/down.mjs"], { cwd: root, stdio: "ignore" });
    if (await exited(down) !== 0) process.exitCode = 1;
  }
  await log.close();
  const listening = await Promise.all(ports.map(port => new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(port); });
    socket.once("error", () => resolve(null));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(port); });
  })));
  const openPorts = listening.filter(port => port !== null);
  await writeFile(join(output, "teardown.json"), JSON.stringify({ stopped: stack.exitCode !== null || Boolean(stack.signalCode), ports, openPorts }));
  if (openPorts.length) { console.error("Owned production ports remain open after teardown"); process.exitCode = 1; }
}
