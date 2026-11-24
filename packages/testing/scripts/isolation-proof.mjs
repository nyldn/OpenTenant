// @ts-check
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { validateDatabaseUrl, validateConnectedDatabase, validateVitestReport } from "../../../tooling/ci/run-database-store-tests.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateDatabaseUrl(process.env.ADMIN_DATABASE_URL, "postgres");
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "CI"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const databaseNames = ["opentenant_it_fuzz_control", "opentenant_it_fuzz_tenant", "opentenant_it_fuzz_other"];
const variables = ["ISOLATION_CONTROL_DATABASE_URL", "ISOLATION_TENANT_DATABASE_URL", "ISOLATION_OTHER_TENANT_DATABASE_URL"];
const client = new pg.Client(config);
await client.connect();
try {
  await validateConnectedDatabase(client, { ...config, allowUnixSocketServer: process.env.OPENTENANT_EPHEMERAL_SOCKET_TRANSPORT === "1" });
  for (const [index, database] of databaseNames.entries()) {
    await client.query(`drop database if exists ${database}`);
    await client.query(`create database ${database}`);
    const url = new URL("postgresql://localhost");
    url.hostname = config.host; url.port = String(config.port); url.username = config.user; url.password = config.password; url.pathname = database;
    env[variables[index]] = url.href;
  }
} finally { await client.end(); }
const directory = resolve(process.env.DATABASE_STORE_REPORT_DIRECTORY ?? "/tmp/opentenant-isolation-proof");
mkdirSync(directory, { recursive: true });
const report = resolve(directory, "isolation-fuzz.json");
rmSync(report, { force: true });
const result = spawnSync("pnpm", ["--filter", "@opentenant/testing", "exec", "vitest", "run", "src/isolation-fuzz.test.ts", "--reporter=default", "--reporter=json", `--outputFile=${report}`], {
  cwd: root, stdio: "inherit", timeout: 600_000,
  env: { ...env, ISOLATION_FUZZ_REQUIRED: "1", ...(process.env.ISOLATION_FUZZ_SEED === undefined ? {} : { ISOLATION_FUZZ_SEED: process.env.ISOLATION_FUZZ_SEED }) },
});
if (result.error || result.status !== 0) throw new Error(`Isolation fuzz process failed: ${result.status}`, { cause: result.error });
const titles = [
  "uses production provisioning and a non-owner runtime role",
  ...["support", "brand", "voice", "audit", "usage", "admission", "capabilities"].map(family => `fuzzes ${family} sequences without observing or changing another tenant`),
  "fails closed for null, empty, mismatched, look-alike and SQL tenant IDs",
];
const counts = validateVitestReport(JSON.parse(readFileSync(report, "utf8")), { file: resolve(root, "packages/testing/src/isolation-fuzz.test.ts"), titles });
console.log(`isolation-fuzz: ${counts.executed} executed, ${counts.skipped} skipped; 175 family sequences + 5 malformed-ID sequences`);
