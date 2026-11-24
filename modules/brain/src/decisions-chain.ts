import { createHash } from "node:crypto";
import { canonicalJsonStringify, type AuditActor } from "@opentenant/security";

const DECISION_CHAIN_LOCK_SCOPE = "brain.decisions";

export interface BrainDecisionEvent {
  sequence: number;
  tenantId: string;
  occurredAt: Date;
  actor: AuditActor;
  subject: string;
  decision: string;
  rationale: string;
  outcome: string | null;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  previousHash: string;
  hash: string;
}

export interface DecisionChainClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

export interface DecisionChainPool {
  connect(): Promise<DecisionChainClient & { release(): void }>;
}

export function decisionHash(
  previousHash: string,
  event: Omit<BrainDecisionEvent, "hash" | "previousHash">,
): string {
  // Canonical format applies to newly written decisions. Verification retains
  // the exact former format but cannot recover it after jsonb changes key order.
  const input = canonicalJsonStringify({
    previousHash,
    sequence: event.sequence,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor,
    subject: event.subject,
    decision: event.decision,
    rationale: event.rationale,
    outcome: event.outcome,
    detail: event.detail,
  });
  if (input === undefined) throw new TypeError("Decision hash input could not be serialized");
  return createHash("sha256").update(input).digest("hex");
}

function legacyDecisionHash(
  previousHash: string,
  event: Omit<BrainDecisionEvent, "hash" | "previousHash">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        previousHash,
        sequence: event.sequence,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt.toISOString(),
        actor: event.actor,
        subject: event.subject,
        decision: event.decision,
        rationale: event.rationale,
        outcome: event.outcome,
        detail: event.detail,
      }),
    )
    .digest("hex");
}

export class BrainDecisionChainStore {
  constructor(private readonly pool: DecisionChainPool) {}

  async append(
    event: Omit<BrainDecisionEvent, "sequence" | "hash" | "previousHash">,
  ): Promise<BrainDecisionEvent> {
    const client = await this.pool.connect();
    try {
      // The xact-scoped advisory lock and the FORCE RLS tenant context both
      // exist only inside an explicit transaction; without it the lock drops
      // after its own statement and the insert fails closed.
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [event.tenantId]);
      const full = await this.appendWithClient(client, event);
      await client.query("commit");
      return full;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Caller owns the transaction and must have set app.tenant_id. */
  async appendWithClient(
    client: DecisionChainClient,
    event: Omit<BrainDecisionEvent, "sequence" | "hash" | "previousHash">,
  ): Promise<BrainDecisionEvent> {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [DECISION_CHAIN_LOCK_SCOPE]);
    const { rows } = await client.query<{ sequence: string; hash: string }>(
      `select sequence, hash
         from brain.decisions_log
        where tenant_id = $1
        order by sequence desc
        limit 1`,
      [event.tenantId],
    );
    const previous = rows[0];
    const sequence = previous ? Number(previous.sequence) + 1 : 1;
    const previousHash = previous?.hash ?? "genesis";
    const full: BrainDecisionEvent = {
      ...event,
      sequence,
      previousHash,
      hash: decisionHash(previousHash, { ...event, sequence }),
    };
    await client.query(
      `insert into brain.decisions_log
         (tenant_id, sequence, occurred_at, actor, subject, decision, rationale, outcome, detail, previous_hash, hash)
       values
         ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        full.tenantId,
        full.sequence,
        full.occurredAt,
        JSON.stringify(full.actor),
        full.subject,
        full.decision,
        full.rationale,
        full.outcome,
        JSON.stringify(full.detail),
        full.previousHash,
        full.hash,
      ],
    );
    return full;
  }
}

export function verifyDecisionChain(
  entries: ReadonlyArray<BrainDecisionEvent>,
): { intact: boolean; brokenAtSequence: number | null } {
  let previousHash = "genesis";
  let expectedSequence = 1;
  let tenantId: string | undefined;
  for (const entry of [...entries].sort((a, b) => a.sequence - b.sequence)) {
    tenantId ??= entry.tenantId;
    if (
      entry.sequence !== expectedSequence ||
      entry.tenantId !== tenantId ||
      entry.previousHash !== previousHash
    ) {
      return { intact: false, brokenAtSequence: entry.sequence };
    }
    const event = omitHash(entry);
    if (
      decisionHash(previousHash, event) !== entry.hash &&
      legacyDecisionHash(previousHash, event) !== entry.hash
    ) {
      return { intact: false, brokenAtSequence: entry.sequence };
    }
    previousHash = entry.hash;
    expectedSequence += 1;
  }
  return { intact: true, brokenAtSequence: null };
}

function omitHash(entry: BrainDecisionEvent): Omit<BrainDecisionEvent, "hash" | "previousHash"> {
  return {
    sequence: entry.sequence,
    tenantId: entry.tenantId,
    occurredAt: entry.occurredAt,
    actor: entry.actor,
    subject: entry.subject,
    decision: entry.decision,
    rationale: entry.rationale,
    outcome: entry.outcome,
    detail: entry.detail,
  };
}
