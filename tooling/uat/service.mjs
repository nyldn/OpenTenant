import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, open, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(import.meta.dirname, "../..");
const state = join(root, ".uat");
const record = join(state, "service.json");
const session = "opentenant-uat";
export const TTL_SECONDS = 8 * 60 * 60;
const tmux = args => execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const exists = () => { try { tmux(["has-session", "-t", `=${session}`]); return true; } catch { return false; } };
const sessionOwner = () => { try { return tmux(["show-options", "-v", "-t", session, "@opentenant-worktree"]).trim(); } catch { return undefined; } };
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
async function load() { try { return JSON.parse(await readFile(record, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
export async function stopSession() {
  const service = await load();
  await rm(record, { force: true });
  if (service?.root === root && exists() && sessionOwner() === root) tmux(["kill-session", "-t", session]);
  if (service?.root === root && /^forge-job-opentenant-uat-[a-f0-9]+\.service$/.test(service.unit ?? "")) execFileSync("systemctl", ["--user", "stop", service.unit], { stdio: "ignore", timeout: 60_000 });
}
async function ownerAlive() {
  let owner;
  try { owner = JSON.parse(await readFile(join(state, "active", "owner.json"), "utf8")); } catch { return true; } // unknown: fail closed
  if (process.platform !== "linux") { try { process.kill(owner.pid, 0); return true; } catch { return false; } }
  try { return (await readFile(`/proc/${owner.pid}/stat`, "utf8")).split(") ")[1].split(" ")[19] === owner.stamp; }
  catch { return false; }
}
async function main() {
  const action = process.argv[2];
  if (action === "status") {
    const service = await load();
    let manifest;
    try { manifest = JSON.parse(await readFile(join(state, "manifest.json"), "utf8")); } catch { /* stopped or starting */ }
    console.log(JSON.stringify({ state: service && exists() && manifest ? "running" : "stopped", session: service?.session, unit: service?.unit, remainingSeconds: service && exists() ? Math.max(0, Math.floor((service.expiresAt - Date.now()) / 1000)) : 0, ports: manifest?.ports ?? {}, manifest: join(state, "manifest.json") }, null, 2));
    return;
  }
  try { tmux(["-V"]); } catch { throw new Error("tmux is required for pnpm uat:start. Install tmux and retry."); }
  if (action !== "start") throw new Error("Usage: service.mjs start|status");
  if (exists()) throw new Error("UAT tmux session already exists; use pnpm uat:status or pnpm uat:down in its owning worktree.");
  let active = false;
  try { await access(join(state, "active")); active = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  // A lock whose recorded controller is gone (for example, killed by an agent
  // time limit) is stale. Run the normal labelled cleanup instead of refusing.
  if (active && !(await ownerAlive())) {
    execFileSync(process.execPath, [join(import.meta.dirname, "down.mjs")], { cwd: root, stdio: "inherit" });
    active = false;
  }
  if (active) throw new Error("UAT is already active in this worktree; use pnpm uat:status or pnpm uat:down.");
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = await open(record, "wx", 0o600).catch(() => { throw new Error("UAT service record exists; use pnpm uat:down in this worktree first."); });
  const service = { root, session, expiresAt: Date.now() + TTL_SECONDS * 1000 };
  await lock.writeFile(JSON.stringify(service)); await lock.close();
  try {
    // Keep the whole supervisor in the Forge cgroup. The owner explicitly chose
    // tmux and eight hours; the foreground supervisor owns every child.
    const command = `cd ${quote(root)} && exec forge-job run --seconds ${TTL_SECONDS + 120} opentenant-uat -- ${quote(process.execPath)} ${quote(join(import.meta.dirname, "watchdog.mjs"))}`;
    tmux(["new-session", "-d", "-s", session, command]);
    tmux(["set-option", "-t", session, "@opentenant-worktree", root]);
    for (let i = 0; i < 360; i++) {
      if (!service.unit && exists()) {
        service.unit = tmux(["capture-pane", "-p", "-t", session]).match(/forge-job-opentenant-uat-[a-f0-9]+\.service/)?.[0];
        if (service.unit) await writeFile(record, JSON.stringify(service), { mode: 0o600 });
      }
      if (!exists()) throw new Error("UAT service exited; inspect .uat/service.log");
      try { await readFile(join(state, "manifest.json")); console.log(`UAT ready in tmux ${session}; expires ${new Date(service.expiresAt).toISOString()}; private manifest: ${join(state, "manifest.json")}`); return; } catch { /* bounded startup */ }
      await delay(500);
    }
    throw new Error("UAT startup timed out; inspect .uat/service.log");
  } catch (error) {
    const child = spawn(process.execPath, [join(import.meta.dirname, "down.mjs")], { cwd: root, stdio: "inherit" });
    await new Promise(resolve => child.once("exit", resolve)); throw error;
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(e => { console.error(e.message); process.exitCode = 1; });
