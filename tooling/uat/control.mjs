import { request } from "node:http";
import { resolve } from "node:path";
import { readOwnedRun } from "./control-guard.mjs";

export const help = `Usage: pnpm uat:control <command>
  fail-next-provision [slug]  Arm a migration-table conflict for a NEW tenant.
                             Default slug: uat-provision-retry. Use it in Create tenant.
  status                     Show only safe control/job state.
  clear                      Remove the conflict, then use the product retry.
  expire-exports <slug>      Expire this tenant's existing export downloads.
  --help                     Show this help.
Controls require this worktree's active disposable loopback UAT stack.
Reset removes all control state. No production feature flags are used.`;

export function parseCommand(args) {
  const [action, slug] = args;
  const validLength = action === "expire-exports" ? args.length === 2
    : action === "fail-next-provision" ? args.length <= 2 : args.length === 1;
  if (!["fail-next-provision", "status", "clear", "expire-exports"].includes(action) || !validLength) throw new Error("Invalid UAT command. Use pnpm uat:control --help.");
  if (slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Error("Invalid synthetic tenant slug.");
  return { action, ...(slug === undefined ? {} : { slug }) };
}

export async function operatorCommand(root, command) {
  const { manifest, control } = await readOwnedRun(root);
  return new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${control.appPort}/__uat/control`, { method: "POST", headers: { host: `admin.localhost:${control.appPort}`, authorization: `Bearer ${control.stopToken}`, "content-type": "application/json" }, timeout: 60_000 }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; if (body.length > 8192) req.destroy(new Error("Invalid UAT receipt")); });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("UAT control response interrupted")));
      res.on("end", () => {
        try {
          const receipt = JSON.parse(body);
          if (res.statusCode !== 200 || receipt.runId !== manifest.runId) throw new Error("UAT command refused");
          resolve(receipt);
        } catch { reject(new Error("UAT command failed. Inspect the private UAT log; use --help for requirements.")); }
      });
    });
    req.on("error", () => reject(new Error("UAT stack unavailable.")));
    req.on("timeout", () => req.destroy());
    req.end(JSON.stringify(command));
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2).filter(a => a !== "--");
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) console.log(help);
  else {
    try { console.log(JSON.stringify(await operatorCommand(resolve(import.meta.dirname, "../.."), parseCommand(args)))); }
    catch { console.error("UAT control refused. Use this worktree's running disposable loopback stack and pnpm uat:control --help."); process.exitCode = 1; }
  }
}
