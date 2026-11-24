import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { dnsControl } from "./dns-control.mjs";

if (process.env.NODE_ENV === "production" || process.env.OPENTENANT_E2E !== "1") {
  throw new Error("E2E server is disabled outside the test launcher");
}
const dns = dnsControl();
await new Promise((resolve, reject) => {
  dns.once("error", reject);
  dns.listen(Number(process.env.E2E_DNS_PORT), "127.0.0.1", resolve);
});

await rm(resolve(import.meta.dirname, "../../apps/platform/.next"), { recursive: true, force: true });

// run.mjs passes an explicit environment with no host provider credentials.
const child = spawn(process.execPath, [join(import.meta.dirname, "next-server.mjs")], {
  cwd: resolve(import.meta.dirname, "../../apps/platform"),
  env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=4096 --import=${join(import.meta.dirname, "local-fetch.mjs")}` },
  stdio: "inherit", detached: true,
});
const forward = (signal) => {
  if (child.pid) process.kill(-child.pid, signal);
};
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
child.once("exit", (code, signal) => {
  if (signal !== "SIGTERM" && code !== 0) console.error(`E2E platform exited: ${signal ?? code}`);
  dns.close(); process.exitCode = code ?? (signal === "SIGTERM" ? 0 : 1);
});
