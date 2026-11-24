import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { CredentialCipher } from "./credential-cipher";
import { PgAuditStore } from "./audit-store";

export interface RotationOptions {
  mode: "dry-run" | "apply";
  actorId: string;
  runId?: string;
  newRunId?: string;
  batchSize?: number;
  /** Stop between committed batches. Resume with the returned runId. */
  maxBatches?: number;
}
export interface RotationResult {
  runId: string;
  status: "running" | "completed";
  scanned: number;
  rotated: number;
}
interface Run {
  run_id: string;
  active_key_id: string;
  active_key_fingerprint: string;
  mode: string;
  actor_id: string;
  cursor: string;
  scanned: number;
  rotated: number;
  status: "running" | "completed";
}
interface RecordRow {
  sort_key: string;
  source: "database" | "oauth" | "model";
  tenant_id: string | null;
  provider: string;
  field: string;
  ciphertext: string;
  aad: string;
}
// Static inventory: bytea columns contain the UTF-8 wire string, not raw GCM bytes.
const INVENTORY = `select * from (
 select json_build_array('database',tenant_id,'connection')::text collate "C" as sort_key,
   'database' as source, tenant_id, '' as provider, 'connection' as field,
   convert_from(encrypted_connection,'UTF8') as ciphertext, tenant_id as aad from tenant_databases
 union all
 select json_build_array('oauth',tenant_id,provider,t.field)::text collate "C",
   'oauth', tenant_id, provider, t.field, t.ciphertext, 'oauth:'||tenant_id||':'||provider
   from oauth_token_vault cross join lateral (values
     ('access',encrypted_access_token),('refresh',encrypted_refresh_token)) t(field,ciphertext)
   where t.ciphertext is not null
 union all
 select json_build_array('model',tenant_id,provider)::text collate "C", 'model', tenant_id, provider,
   'credential', convert_from(encrypted_credential,'UTF8'), 'model:'||coalesce(tenant_id,'installation')||':'||provider
   from model_provider_credentials
) inventory where sort_key > $1 collate "C" order by sort_key limit $2`;

async function replaceRecord(
  client: PoolClient,
  row: RecordRow,
  ciphertext: string,
): Promise<void> {
  let result;
  if (row.source === "database") {
    result = await client.query(
      `update tenant_databases set encrypted_connection=$1, updated_at=now()
      where tenant_id=$2 and encrypted_connection=$3`,
      [Buffer.from(ciphertext), row.tenant_id, Buffer.from(row.ciphertext)],
    );
  } else if (row.source === "model") {
    result = await client.query(
      `update model_provider_credentials set encrypted_credential=$1, updated_at=now()
      where tenant_id is not distinct from $2 and provider=$3 and encrypted_credential=$4`,
      [
        Buffer.from(ciphertext),
        row.tenant_id,
        row.provider,
        Buffer.from(row.ciphertext),
      ],
    );
  } else {
    // Both identifiers come exclusively from the static inventory above.
    const column =
      row.field === "access"
        ? "encrypted_access_token"
        : "encrypted_refresh_token";
    result = await client.query(
      `update oauth_token_vault set ${column}=$1, updated_at=now()
      where tenant_id=$2 and provider=$3 and ${column}=$4`,
      [ciphertext, row.tenant_id, row.provider, row.ciphertext],
    );
  }
  if (result.rowCount !== 1)
    throw new Error("Concurrent credential change; resume rotation");
}

function audit(
  client: PoolClient,
  pool: Pool,
  run: Run,
  action: string,
  detail: Record<string, string | number>,
) {
  return new PgAuditStore(pool).appendWithClient(client, {
    tenantId: null,
    occurredAt: new Date(),
    actor: { kind: "system", job: run.actor_id },
    action: `credentials.rotation.${action}`,
    subject: run.run_id,
    detail: { mode: run.mode, activeKeyId: run.active_key_id, ...detail },
  });
}

async function batch(
  pool: Pool,
  cipher: CredentialCipher,
  options: RotationOptions,
  runId: string,
  batchSize: number,
  first: boolean,
): Promise<RotationResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(731035600241205)");
    const run = (
      await client.query<Run>(
        "select * from credential_rotation_runs where run_id=$1 for update",
        [runId],
      )
    ).rows[0];
    if (
      !run ||
      run.active_key_id !== cipher.activeKeyId ||
      run.active_key_fingerprint !== cipher.activeKeyFingerprint ||
      run.mode !== options.mode ||
      run.actor_id !== options.actorId
    )
      throw new Error("rotation configuration mismatch");
    if (run.status !== "completed") {
      if (first && options.runId) await audit(client, pool, run, "resumed", {});
      const { rows } = await client.query<RecordRow>(INVENTORY, [
        run.cursor,
        batchSize,
      ]);
      let rotated = 0;
      for (const row of rows) {
        const plaintext = cipher.decrypt(row.ciphertext, row.aad);
        if (cipher.needsRotation(row.ciphertext)) {
          if (options.mode === "apply")
            await replaceRecord(
              client,
              row,
              cipher.encrypt(plaintext, row.aad),
            );
          rotated++;
        }
      }
      run.scanned += rows.length;
      run.rotated += rotated;
      run.cursor = rows.at(-1)?.sort_key ?? run.cursor;
      run.status = rows.length < batchSize ? "completed" : "running";
      await client.query(
        `update credential_rotation_runs set cursor=$2,scanned=$3,rotated=$4,status=$5,updated_at=now() where run_id=$1`,
        [runId, run.cursor, run.scanned, run.rotated, run.status],
      );
      await audit(
        client,
        pool,
        run,
        run.status === "completed" ? "completed" : "batch",
        { scanned: run.scanned, rotated: run.rotated },
      );
    }
    await client.query("commit");
    return {
      runId,
      status: run.status,
      scanned: run.scanned,
      rotated: run.rotated,
    };
  } catch {
    await client.query("rollback").catch(() => undefined);
    throw new Error(
      "credential rotation failed; resume with the same run ID after correcting the cause",
    );
  } finally {
    client.release();
  }
}

export async function rotateCredentials(
  pool: Pool,
  cipher: CredentialCipher,
  options: RotationOptions,
): Promise<RotationResult> {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000 ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1 ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(options.actorId) ||
    !["apply", "dry-run"].includes(options.mode) ||
    (options.runId !== undefined && !/^[a-f0-9-]{36}$/.test(options.runId)) ||
    (options.newRunId !== undefined &&
      (!/^[a-f0-9-]{36}$/.test(options.newRunId) ||
        options.runId !== undefined))
  )
    throw new Error("Invalid rotation options");
  const runId = options.runId ?? options.newRunId ?? randomUUID();
  if (!options.runId) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const run = (
        await client.query<Run>(
          `insert into credential_rotation_runs (run_id,active_key_id,active_key_fingerprint,mode,actor_id)
        values ($1,$2,$3,$4,$5) returning *`,
          [
            runId,
            cipher.activeKeyId,
            cipher.activeKeyFingerprint,
            options.mode,
            options.actorId,
          ],
        )
      ).rows[0]!;
      await audit(client, pool, run, "started", {});
      await client.query("commit");
    } catch {
      await client.query("rollback").catch(() => undefined);
      throw new Error("credential rotation initialization failed");
    } finally {
      client.release();
    }
  }
  let result: RotationResult;
  for (let index = 0; ; index++) {
    try {
      result = await batch(
        pool,
        cipher,
        options,
        runId,
        batchSize,
        index === 0,
      );
    } catch {
      // Content-free failure evidence; never persist database/provider errors.
      await new PgAuditStore(pool).append({
        tenantId: null,
        occurredAt: new Date(),
        actor: { kind: "system", job: options.actorId },
        action: "credentials.rotation.failed",
        subject: runId,
        detail: { mode: options.mode, activeKeyId: cipher.activeKeyId },
      });
      throw new Error(
        "credential rotation failed or rotation configuration mismatch; resume using the run ID",
      );
    }
    if (result.status === "completed" || index + 1 >= maxBatches) return result;
  }
}
