import { request } from "node:http";
import { readFile } from "node:fs/promises";
const control = new URL("../../.uat/active/control.json", import.meta.url);
export async function resetFixtures() {
  const { appPort, stopToken } = JSON.parse(await readFile(control, "utf8"));
  return new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${appPort}/__uat/reset`, { method: "POST", headers: { host: `admin.localhost:${appPort}`, authorization: `Bearer ${stopToken}` }, timeout: 180_000 }, res => {
      res.on("aborted", () => reject(new Error("UAT reset response interrupted")));
      res.on("error", reject);
      let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; });
      res.on("end", () => { if (res.statusCode !== 200) reject(new Error("UAT reset failed")); else resolve(JSON.parse(body)); });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("UAT reset timed out"))); req.end();
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(JSON.stringify(await resetFixtures())); console.log("Reopen each private persona link to reset Assessment storage in that test origin."); }
  catch { console.error("UAT reset failed. Start the stack with pnpm uat:start; inspect the private service log."); process.exitCode = 1; }
}
