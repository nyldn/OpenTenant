import { request } from "node:http";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { docker } from "./runtime.mjs";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const state = join(root, ".uat");
let serviceFixture;
try { serviceFixture = JSON.parse(await readFile(join(state, "active/fixture.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const label = `opentenant.uat.workspace=${createHash("sha256").update(root).digest("hex").slice(0, 20)}`;
try {
  if (process.platform === "linux") {
    const { pid, stamp } = JSON.parse(await readFile(join(state, "active/owner.json"), "utf8"));
    const sameProcess = async () => {
      try { return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1].split(" ")[19] === stamp; }
      catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
    };
    if (await sameProcess()) {
      process.kill(pid, "SIGTERM");
      for (let attempt = 0; attempt < 90 && await sameProcess(); attempt++) await delay(500);
      if (await sameProcess()) throw new Error("Live UAT controller did not stop within 45 seconds");
    }
  } else {
    const { appPort, stopToken } = JSON.parse(await readFile(join(state, "active/control.json"), "utf8"));
    await new Promise((resolve, reject) => {
      const req = request(`http://127.0.0.1:${appPort}/__uat/stop`, { method: "POST", headers: { host: `admin.localhost:${appPort}`, authorization: `Bearer ${stopToken}` }, timeout: 2000 }, res => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error("UAT stop rejected"));
      });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("UAT stop timed out"))); req.end();
    });
    for (let attempt = 0; attempt < 90; attempt++) {
      try { await readFile(join(state, "active/control.json")); } catch { break; }
      await delay(500);
      if (attempt === 89) throw new Error("Live UAT controller did not stop within 45 seconds");
    }
  }
} catch (error) {
  if (error.message.includes("did not stop")) throw error;
  if (error.code !== "ENOENT") console.error("UAT controller unavailable; removing labeled orphan containers.");
}
const containers = docker(["ps", "-aq", "--filter", "label=opentenant.uat=true", "--filter", `label=${label}`]).split(/\s+/u).filter(Boolean);
if (containers.length) docker(["rm", "-fv", ...containers]);
if (serviceFixture?.servicePostgres) {
  const { cleanupServicePostgres } = await import("./service-postgres.mjs");
  await cleanupServicePostgres(serviceFixture.controlUrl);
}
await rm(join(state, "active"), { recursive: true, force: true });
await rm(join(state, "manifest.json"), { force: true });
const { stopSession } = await import("./service.mjs");
await stopSession();
console.log(`UAT down: removed ${containers.length} orphan containers for this worktree.`);
