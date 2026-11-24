import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
// Only generated outputs are removed; tooling/migrations/sql is canonical input.
for (const parent of ["packages", "modules", "tooling", "examples"]) {
  for (const entry of readdirSync(join(root, parent))) {
    const path = join(root, parent, entry);
    if (!existsSync(join(path, "package.json"))) continue;
    rmSync(join(path, "dist"), { recursive: true, force: true });
    if (parent === "modules") rmSync(join(path, "sql"), { recursive: true, force: true });
  }
}
const result = execFileSync("pnpm", ["turbo", "build", "--filter=./packages/*", "--filter=./modules/*", "--filter=./examples/*", "--filter=@opentenant/migrations", "--filter=@opentenant/provisioning", "--cache=local:rw", "--summarize"], { cwd: root, encoding: "utf8" });
process.stdout.write(result);
const runs = join(root, ".turbo/runs");
const report = readdirSync(runs).filter(f => f.endsWith(".json")).sort().at(-1);
const summary = JSON.parse(readFileSync(join(runs, report), "utf8"));
assert(summary.tasks.length >= 23);
for (const task of summary.tasks) assert.equal(task.cache.status, "HIT", `${task.taskId}: expected a cache restore`);
execFileSync("pnpm", ["package:check"], { cwd: root, stdio: "inherit" });
console.log(`PASS cache restore: ${summary.tasks.length} cache hits; package:check passed after deleting generated dist/sql`);
