import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { startEphemeralPostgres } from "../tooling/db-ephemeral/postgres.mjs";
const start = performance.now(), root = resolve(import.meta.dirname, "..");
const packs = mkdtempSync(join(tmpdir(), "opentenant-dx-")), container = `opentenant-dx-${randomBytes(6).toString("hex")}`;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit", timeout: Math.max(1000, Math.floor(600_000 - (performance.now()-start))), env: { ...process.env, pnpm_config_verify_deps_before_run: "false" } });
let database, passed = false;
try {
  run("pnpm", ["turbo", "build", "--filter=./packages/*", "--filter=./modules/*", "--filter=@opentenant/migrations", "--filter=@opentenant/provisioning"]);
  for (const parent of ["packages", "modules", "tooling"]) for (const directory of readdirSync(join(root, parent))) {
    const path = join(root, parent, directory), manifest = join(path, "package.json");
    if (existsSync(manifest) && !JSON.parse(readFileSync(manifest,"utf8")).private) run("pnpm", ["pack", "--pack-destination", packs], path);
  }
  database = await startEphemeralPostgres();
  const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const envFile = join(packs, "runtime.env");
  writeFileSync(envFile, `POSTGRES_ADMIN_DATABASE_URL=${database.adminUrl}\nPORT=${port}\nIDENTITY_PROVIDER=${process.env.DX_IDENTITY ?? "local"}\npnpm_config_verify_deps_before_run=false\n`, { mode: 0o600 });
  // Linux host networking reaches the sibling disposable PostgreSQL on its random
  // loopback port. No host node_modules or package-manager cache is mounted.
  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["run", "--rm", "--name", container, "--network=host", "--env-file", envFile, "--mount", `type=bind,src=${packs},dst=/packs,readonly`, "--mount", `type=bind,src=${join(root,"scripts/dx-timed-container.mjs")},dst=/runner.mjs,readonly`, "--mount", `type=bind,src=${join(root,"scripts/scaffold-start-check.mjs")},dst=/scaffold-start-check.mjs,readonly`, "--tmpfs", "/work:exec,size=3g", "--workdir", "/work", "node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb", "node", "/runner.mjs"], { stdio: "inherit" });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("DX exceeded ten minutes")); }, Math.max(1, 600_000 - (performance.now()-start)));
    child.once("error", reject); child.once("exit", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Clean container failed")); });
  });
  passed = true;
} finally {
  try { execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" }); } catch { /* --rm already removed it */ }
  await database?.dispose(); rmSync(packs, { recursive: true, force: true });
  const seconds = (performance.now()-start)/1000;
  const report = { command: "pnpm dx:timed", image: "node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb", identity: process.env.DX_IDENTITY ?? "local", duration_seconds: Number(seconds.toFixed(3)), limit_seconds: 600, passed: passed && seconds <= 600 };
  const path = process.env.DX_TIMED_REPORT ?? join(tmpdir(), "opentenant-dx-timed.json"); writeFileSync(path, JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
