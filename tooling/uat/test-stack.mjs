import { spawn } from "node:child_process";
import { open, readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hostEnvironment } from "../e2e/safety.mjs";
const root = resolve(import.meta.dirname, "../..");
export async function startTestStack(logPath, { audit = false } = {}) {
  await mkdir(resolve(logPath, ".."), { recursive: true });
  const log = await open(logPath, "w", 0o600);
  const child = spawn(process.execPath, [join(import.meta.dirname, "serve.mjs"), "--better-auth", ...(audit ? ["--audit"] : [])], { cwd: root, stdio: ["ignore", log.fd, log.fd], env: { ...hostEnvironment(process.env), pnpm_config_verify_deps_before_run: "false", ...(audit ? { E2E_USE_POSTGRES_SERVICE: process.env.E2E_USE_POSTGRES_SERVICE, E2E_POSTGRES_PORT: process.env.E2E_POSTGRES_PORT, E2E_SERVICE_PASSWORD: process.env.E2E_SERVICE_PASSWORD } : {}) } });
  // serve.mjs records its own pid in .uat/active/owner.json once it holds the
  // worktree lock. Only that proof lets this launcher read the manifest or run
  // worktree-wide teardown; otherwise a manual UAT session would be destroyed.
  const ownsStack = async () => {
    try { return JSON.parse(await readFile(join(root, ".uat/active/owner.json"), "utf8")).pid === child.pid; }
    catch { return false; }
  };
  let acquired = false;
  const dispose = async () => {
    if (child.exitCode === null && !child.signalCode) {
      child.kill("SIGTERM");
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(45_000, undefined, { ref: false }).then(() => { if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL"); })]);
    }
    if (!acquired) { await log.close(); return; }
    const down = spawn(process.execPath, [join(import.meta.dirname, "down.mjs")], { cwd: root, stdio: "ignore" });
    const code = await new Promise(resolve => down.once("exit", resolve));
    await log.close(); if (code !== 0) throw new Error("UAT test cleanup failed");
  };
  try {
    for (let i = 0; i < 360; i++) {
      if (child.exitCode !== null || child.signalCode) throw new Error(`UAT startup failed; inspect ${logPath}`);
      if (!acquired) acquired = await ownsStack();
      if (acquired) {
        try { const manifest = JSON.parse(await readFile(join(root, ".uat/manifest.json"), "utf8")); return { manifest, dispose }; } catch { /* bounded wait */ }
      }
      await delay(500);
    }
    throw new Error("UAT test startup timed out");
  } catch (error) { await dispose(); throw error; }
}
