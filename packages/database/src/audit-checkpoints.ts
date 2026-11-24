import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import type { Pool } from "pg";
import type { AuditEvent } from "@opentenant/security";
import { verifyAuditEvents } from "@opentenant/security/audit-chain";
import { AuditCheckpointError, EMPTY_AUDIT_HASH, signCheckpoint, verifyCheckpoint, type AuditCheckpoint, type CheckpointPublicKeys } from "@opentenant/security/audit-checkpoint";
import type { CheckpointSink } from "@opentenant/security/checkpoint-sinks";

interface VerificationOptions {
  pool: Pool;
  sink: CheckpointSink;
  /** Stable, installation-specific origin prefix, retained across restores. */
  origin: string;
  publicKeys: CheckpointPublicKeys;
}
interface AnchorOptions extends VerificationOptions {
  keyId: string;
  privateKey: KeyObject;
}

function scopeOrigin(origin: string, tenantId: string | null): string {
  return `${origin}/${tenantId === null ? "platform" : `tenant/${Buffer.from(tenantId).toString("base64url")}`}`;
}
function fail(origin: string, reason: string): never {
  const scope = createHash("sha256").update(origin).digest("hex").slice(0, 16);
  throw new AuditCheckpointError(`audit scope ${scope}: ${reason}`);
}

/** One database snapshot for all scopes, so appends cannot race verification. */
async function snapshot(pool: Pool, origin: string): Promise<Map<string, AuditEvent[]>> {
  if (!/^[\x21-\x7e]{1,800}$/u.test(origin)) throw new AuditCheckpointError("invalid installation origin");
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const { rows } = await client.query<AuditEvent>(`select sequence::float8 as sequence, tenant_id as "tenantId", occurred_at as "occurredAt",
      actor, action, subject, detail, previous_hash as "previousHash", hash from audit_events order by tenant_id nulls first, sequence`);
    const scopes = new Map<string, AuditEvent[]>([[scopeOrigin(origin, null), []]]);
    for (const event of rows) {
      const name = scopeOrigin(origin, event.tenantId);
      const events = scopes.get(name) ?? [];
      events.push(event); scopes.set(name, events);
    }
    for (const [name, events] of scopes) {
      const result = verifyAuditEvents(events);
      if (!result.intact) fail(name, `${result.failure} at sequence ${result.brokenAtSequence}`);
      // Legacy hashes do not bind tenant scope. Do not claim a trusted anchor
      // over a history the existing verifier labels legacy-unbound.
      if (result.assurance === "legacy-unbound") fail(name, "legacy_unbound_chain");
    }
    await client.query("commit");
    return scopes;
  } catch (error) {
    await client.query("rollback").catch(() => undefined); throw error;
  } finally { client.release(); }
}

async function checkpoints(options: VerificationOptions): Promise<Map<string, AuditCheckpoint>> {
  const latest = new Map<string, AuditCheckpoint>();
  for (const note of await options.sink.read()) {
    const checkpoint = verifyCheckpoint(note, options.publicKeys);
    if (!checkpoint.origin.startsWith(`${options.origin}/`)) throw new AuditCheckpointError("checkpoint installation origin mismatch");
    const previous = latest.get(checkpoint.origin);
    if (previous?.sequence === checkpoint.sequence && previous.hash !== checkpoint.hash) fail(checkpoint.origin, "checkpoint_equivocation");
    if (!previous || checkpoint.sequence >= previous.sequence) latest.set(checkpoint.origin, checkpoint);
  }
  return latest;
}

function compare(scopes: Map<string, AuditEvent[]>, latest: Map<string, AuditCheckpoint>, requireHead: boolean): void {
  // Include external scopes even when the attacker deleted their entire DB history.
  for (const [origin, checkpoint] of latest) {
    const events = scopes.get(origin) ?? [];
    const head = events.at(-1);
    const size = head?.sequence ?? 0;
    if (size < checkpoint.sequence) fail(origin, `dropped_tail: checkpoint sequence ${checkpoint.sequence}, database sequence ${size}`);
    const anchored = checkpoint.sequence === 0 ? EMPTY_AUDIT_HASH : events[checkpoint.sequence - 1]?.hash;
    if (anchored !== checkpoint.hash) fail(origin, `checkpoint_head_mismatch at sequence ${checkpoint.sequence}`);
    if (requireHead && size > checkpoint.sequence) fail(origin, `unanchored_tail after sequence ${checkpoint.sequence}`);
  }
  if (requireHead) for (const origin of scopes.keys()) if (!latest.has(origin)) fail(origin, "missing_checkpoint");
}

export async function verifyAuditCheckpoints(options: VerificationOptions): Promise<number> {
  const latest = await checkpoints(options);
  const scopes = await snapshot(options.pool, options.origin);
  compare(scopes, latest, true);
  return scopes.size;
}

/** Run on a schedule under a separate signer identity. Sink first, DB receipt second.
 * A DB failure can leave a durable external note; retries are idempotent.
 */
export async function anchorAuditScopes(options: AnchorOptions): Promise<number> {
  const latest = await checkpoints(options);
  const scopes = await snapshot(options.pool, options.origin);
  compare(scopes, latest, false);
  // Validate the configured trust key before any external write.
  const publicKeys = options.publicKeys;
  if (!Object.hasOwn(publicKeys, options.keyId) || !publicKeys[options.keyId]?.equals(createPublicKey(options.privateKey))) throw new AuditCheckpointError("checkpoint signing key is not trusted");
  for (const [origin, events] of scopes) {
    const last = events.at(-1);
    const checkpoint = { origin, sequence: last?.sequence ?? 0, hash: last?.hash ?? EMPTY_AUDIT_HASH };
    const note = signCheckpoint(checkpoint, options.keyId, options.privateKey);
    verifyCheckpoint(note, publicKeys, origin);
    await options.sink.publish(note);
    await options.pool.query(`insert into audit_checkpoints (note_hash, origin, sequence, head_hash, key_id, signed_note)
      values ($1, $2, $3, $4, $5, $6) on conflict (note_hash) do nothing`, [createHash("sha256").update(note).digest("hex"), origin, checkpoint.sequence, checkpoint.hash, options.keyId, note]);
  }
  return scopes.size;
}
