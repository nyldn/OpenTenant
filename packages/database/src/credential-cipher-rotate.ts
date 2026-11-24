import { operatorConfig } from "./operator-config.ts";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CredentialCipher } from "./credential-cipher";
import { rotateCredentials } from "./credential-cipher-rotation";

async function main() {
  const args = process.argv.slice(2);
  const mode =
    args[0] === "--apply"
      ? "apply"
      : args[0] === "--dry-run"
        ? "dry-run"
        : null;
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !name ||
      !value ||
      !["--resume", "--batch-size", "--max-batches"].includes(name) ||
      flags.has(name)
    )
      throw new Error();
    flags.set(name, value);
  }
  const env = operatorConfig();
  const connectionString = env.CONTROL_PLANE_DATABASE_URL;
  const actorId = env.KEY_ROTATION_ACTOR_ID;
  if (!mode || !connectionString || !actorId) throw new Error();
  const url = new URL(connectionString);
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error();
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error();
  const cipher = CredentialCipher.fromEnv(env);
  const runId = flags.get("--resume") ?? randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error();
  // Print only this non-secret recovery handle before any database work.
  process.stdout.write(`Rotation run: ${runId}\n`);
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
  try {
    // A caller-supplied run ID needs creation on first execution; rotation accepts
    // a separate newRunId so interrupted first batches remain recoverable.
    const result = await rotateCredentials(pool, cipher, {
      mode,
      actorId,
      ...(flags.has("--resume") ? { runId } : { newRunId: runId }),
      batchSize: Number(flags.get("--batch-size") ?? 100),
      ...(flags.has("--max-batches")
        ? { maxBatches: Number(flags.get("--max-batches")) }
        : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  process.stderr.write(
    "Rotation failed. Check configuration and the runbook, then resume with the run ID. No credential values are reported.\n",
  );
  process.exitCode = 1;
});
