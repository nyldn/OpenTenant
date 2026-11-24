import { supervise } from "./lifecycle.mjs";
import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const { expiresAt } = JSON.parse(await readFile(join(root, ".uat/service.json"), "utf8"));
const log = await open(join(root, ".uat/service.log"), "w", 0o600);
const warning = setTimeout(() => { console.error("UAT expires in 30 minutes. Finish reset verification and save sanitized findings."); }, Math.max(0, expiresAt - Date.now() - 30 * 60_000));
try {
  await supervise({ expiresAt,
    launch: () => {
      const child = spawn("pnpm", ["uat:serve", "--better-auth"], { cwd: root, stdio: ["ignore", log.fd, log.fd] });
      return { exited: new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); }) };
    },
    shutdown: async () => {
      const down = spawn(process.execPath, [join(import.meta.dirname, "down.mjs")], { cwd: root, stdio: "inherit" });
      await new Promise(resolve => down.once("exit", resolve));
    },
  });
} finally { clearTimeout(warning); await log.close(); }
