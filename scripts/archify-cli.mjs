import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archifyCli = resolve(
  repositoryRoot,
  ".agents/skills/archify/bin/archify.mjs",
);
const forwardedArgs = process.argv.slice(2);
const args = forwardedArgs.filter((argument) => argument !== "--");

const result = spawnSync(process.execPath, [archifyCli, ...args], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
