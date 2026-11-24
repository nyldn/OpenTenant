import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "opentenant-mcp-proof-"));
try {
  for (const [name, count] of [["developer-mcp", 141], ["brain", 25]]) {
    const report = join(directory, `${name}.json`);
    const result = spawnSync("pnpm", ["--filter", `@opentenant/${name}`, "exec", "vitest", "run", "--testTimeout=120000", "--hookTimeout=120000", "--reporter=default", "--reporter=json", `--outputFile=${report}`], { stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`${name} suite failed`);
    const data = JSON.parse(readFileSync(report, "utf8"));
    if (!data.success || data.numTotalTests !== count || data.numPassedTests !== count || data.numFailedTests || data.numPendingTests || data.numTodoTests) throw new Error(`${name}: expected exactly ${count} passes and zero skips; got ${data.numPassedTests}/${data.numFailedTests}/${data.numPendingTests}`);
    console.log(`PASS ${name}: ${count} tests, zero failures/skips`);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
