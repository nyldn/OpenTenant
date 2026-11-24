// Parent-death cleanup. Only run-owned process identities and labels cross
// this pipe; no database credentials or persona tokens enter this process.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const label = process.argv[2];
if (!/^opentenant\.uat\.run=[a-f0-9]{24}$/u.test(label ?? "")) process.exit(1);
const children = new Map();
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  try {
    const { pid, stamp, remove } = JSON.parse(line);
    if (!Number.isSafeInteger(pid) || pid < 2 || typeof stamp !== "string") return;
    if (remove) children.delete(pid);
    else children.set(pid, stamp);
  } catch { /* Invalid ledger records grant no authority. */ }
});
lines.on("close", () => {
  for (const [pid, stamp] of children) {
    try {
      const current = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[19];
      if (current === stamp) process.kill(-pid, "SIGKILL");
    } catch { /* Already exited. Linux start-time check prevents PID reuse. */ }
  }
  try {
    const ids = execFileSync("docker", ["ps", "-aq", "--filter", "label=opentenant.uat=true", "--filter", `label=${label}`], { encoding: "utf8", timeout: 30_000 }).trim().split(/\s+/u).filter(Boolean);
    if (ids.length) execFileSync("docker", ["rm", "-fv", ...ids], { stdio: "ignore", timeout: 30_000 });
  } catch { process.exitCode = 1; }
});
