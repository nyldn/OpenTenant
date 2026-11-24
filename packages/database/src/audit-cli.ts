import { operatorConfig } from "./operator-config.ts";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { Pool } from "pg";
import { anchorAuditScopes, verifyAuditCheckpoints } from "@opentenant/database/audit-checkpoints";
import { AuditCheckpointError, type CheckpointPublicKeys } from "@opentenant/security/audit-checkpoint";
import { FileCheckpointSink, GitCheckpointSink } from "@opentenant/security/checkpoint-sinks";

async function main(): Promise<void> {
  let pool: Pool | undefined;
  try {
    const command = process.argv[2];
    if (command !== "anchor" && command !== "verify") throw new AuditCheckpointError("expected anchor or verify command");
    const env = operatorConfig();
    if (!env.AUDIT_DATABASE_URL || !env.AUDIT_CHECKPOINT_ORIGIN || !env.AUDIT_CHECKPOINT_DIRECTORY || !env.AUDIT_CHECKPOINT_PUBLIC_KEYS) throw new AuditCheckpointError("required audit checkpoint configuration is missing");
    const entries: unknown = JSON.parse(env.AUDIT_CHECKPOINT_PUBLIC_KEYS);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new AuditCheckpointError("invalid checkpoint public-key configuration");
    const publicKeys: CheckpointPublicKeys = Object.fromEntries(Object.entries(entries).map(([id, pem]) => {
      if (typeof pem !== "string") throw new AuditCheckpointError("invalid checkpoint public-key configuration");
      return [id, createPublicKey(pem)];
    }));
    const adapter = env.AUDIT_CHECKPOINT_SINK ?? "file";
    if (adapter !== "file" && adapter !== "git") throw new AuditCheckpointError("unsupported checkpoint sink");
    const sink = adapter === "git" ? new GitCheckpointSink(env.AUDIT_CHECKPOINT_DIRECTORY, env.PATH ?? "") : new FileCheckpointSink(env.AUDIT_CHECKPOINT_DIRECTORY);
    pool = new Pool({ connectionString: env.AUDIT_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
    const options = { pool, sink, origin: env.AUDIT_CHECKPOINT_ORIGIN, publicKeys };
    let count: number;
    if (command === "anchor") {
      if (!env.AUDIT_CHECKPOINT_KEY_ID || !env.AUDIT_CHECKPOINT_PRIVATE_KEY) throw new AuditCheckpointError("checkpoint signing key configuration is missing");
      count = await anchorAuditScopes({ ...options, keyId: env.AUDIT_CHECKPOINT_KEY_ID, privateKey: createPrivateKey(env.AUDIT_CHECKPOINT_PRIVATE_KEY) });
    } else {
      count = await verifyAuditCheckpoints(options);
    }
    console.log(`${command === "anchor" ? "anchored" : "verified"} ${count} audit scopes`);
  } catch (error) {
    // Never print provider errors, URLs, PEM values, row payloads, or stacks.
    console.error(error instanceof AuditCheckpointError ? error.message : "audit checkpoint operation failed: check database, sink, and key configuration");
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
await main();
