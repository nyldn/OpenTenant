import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BrainDecisionChainStore,
  decisionHash,
  verifyDecisionChain,
  type BrainDecisionEvent,
  type DecisionChainClient,
  type DecisionChainPool,
} from "./decisions-chain";

class FakeDecisionClient implements DecisionChainClient {
  readonly rows: BrainDecisionEvent[] = [];
  readonly statements: string[] = [];

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: TRow[] }> {
    this.statements.push(sql);
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [] as TRow[] };
    }
    if (sql.startsWith("select set_config('app.tenant_id'")) {
      return { rows: [] as TRow[] };
    }
    if (sql.startsWith("select pg_advisory_xact_lock")) {
      return { rows: [] as TRow[] };
    }
    if (sql.includes("from brain.decisions_log")) {
      const tenantId = String(params[0]);
      const tail = [...this.rows]
        .filter((row) => row.tenantId === tenantId)
        .sort((a, b) => b.sequence - a.sequence)[0];
      return {
        rows: tail
          ? ([{ sequence: String(tail.sequence), hash: tail.hash }] as TRow[])
          : ([] as TRow[]),
      };
    }
    if (sql.includes("insert into brain.decisions_log")) {
      this.rows.push({
        tenantId: String(params[0]),
        sequence: Number(params[1]),
        occurredAt: params[2] as Date,
        actor: JSON.parse(String(params[3])) as BrainDecisionEvent["actor"],
        subject: String(params[4]),
        decision: String(params[5]),
        rationale: String(params[6]),
        outcome: params[7] === null ? null : String(params[7]),
        detail: JSON.parse(String(params[8])) as BrainDecisionEvent["detail"],
        previousHash: String(params[9]),
        hash: String(params[10]),
      });
      return { rows: [] as TRow[] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

class FakeDecisionPool implements DecisionChainPool {
  constructor(private readonly client: FakeDecisionClient) {}

  async connect(): Promise<DecisionChainClient & { release(): void }> {
    const client = this.client;
    return {
      query: client.query.bind(client),
      release() {},
    };
  }
}

describe("BrainDecisionChainStore", () => {
  it("creates a genesis event and chains the next append", async () => {
    const client = new FakeDecisionClient();
    const store = new BrainDecisionChainStore(new FakeDecisionPool(client));

    const first = await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:00:00.000Z"),
      actor: { kind: "user", userId: "user_1" },
      subject: "decision_1",
      decision: "Adopt direct connectors.",
      rationale: "Slack and Google sources need native incremental sync.",
      outcome: "accepted",
      detail: { source: "adr-004" },
    });
    const second = await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:05:00.000Z"),
      actor: { kind: "user", userId: "user_2" },
      subject: "decision_2",
      decision: "Keep brain native.",
      rationale: "The platform owns identity and tenancy.",
      outcome: null,
      detail: { scope: "runtime" },
    });

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBe("genesis");
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);

    // append() must own the transaction and set the RLS tenant context
    // before the advisory lock; FORCE RLS rejects the insert otherwise.
    const firstAppend = client.statements.slice(0, 6);
    expect(firstAppend[0]).toBe("begin");
    expect(firstAppend[1]).toContain("set_config('app.tenant_id'");
    expect(firstAppend[2]).toContain("pg_advisory_xact_lock");
    expect(firstAppend[5]).toBe("commit");
  });

  it("verifies an intact chain", async () => {
    const client = new FakeDecisionClient();
    const store = new BrainDecisionChainStore(new FakeDecisionPool(client));

    await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:00:00.000Z"),
      actor: { kind: "user", userId: "user_1" },
      subject: "decision_1",
      decision: "Adopt direct connectors.",
      rationale: "Need incremental sync.",
      outcome: "accepted",
      detail: { source: "adr-004" },
    });
    await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:05:00.000Z"),
      actor: { kind: "user", userId: "user_2" },
      subject: "decision_2",
      decision: "Keep brain native.",
      rationale: "Platform boundary stays simple.",
      outcome: null,
      detail: { scope: "runtime" },
    });

    expect(verifyDecisionChain(client.rows)).toEqual({ intact: true, brokenAtSequence: null });
  });

  it("verifies a chain after jsonb reorders actor and detail object keys", async () => {
    const client = new FakeDecisionClient();
    const store = new BrainDecisionChainStore(new FakeDecisionPool(client));
    await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:00:00.000Z"),
      actor: { kind: "user", userId: "user_1" },
      subject: "decision_1",
      decision: "Adopt canonical hashing.",
      rationale: "JSONB does not preserve insertion order.",
      outcome: "accepted",
      detail: { source: "adr-004", enabled: true },
    });
    client.rows[0] = {
      ...client.rows[0]!,
      actor: { userId: "user_1", kind: "user" },
      detail: { enabled: true, source: "adr-004" },
    };

    expect(verifyDecisionChain(client.rows)).toEqual({ intact: true, brokenAtSequence: null });
  });

  it("verifies an independently computed legacy JSON.stringify digest", () => {
    const entry = legacyDecisionEntry(1, "genesis");

    expect(verifyDecisionChain([entry])).toEqual({ intact: true, brokenAtSequence: null });
  });

  it("rejects a hash-valid chain containing more than one tenant", () => {
    const first = decisionEntry(1, "genesis");
    const second = decisionEntry(2, first.hash, { tenantId: "tenant_other" });

    expect(verifyDecisionChain([first, second])).toEqual({
      intact: false,
      brokenAtSequence: 2,
    });
  });

  it("detects tampering", async () => {
    const client = new FakeDecisionClient();
    const store = new BrainDecisionChainStore(new FakeDecisionPool(client));

    await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:00:00.000Z"),
      actor: { kind: "user", userId: "user_1" },
      subject: "decision_1",
      decision: "Adopt direct connectors.",
      rationale: "Need incremental sync.",
      outcome: "accepted",
      detail: { source: "adr-004" },
    });
    await store.append({
      tenantId: "tenant_brain",
      occurredAt: new Date("2026-07-17T00:05:00.000Z"),
      actor: { kind: "user", userId: "user_2" },
      subject: "decision_2",
      decision: "Keep brain native.",
      rationale: "Platform boundary stays simple.",
      outcome: null,
      detail: { scope: "runtime" },
    });

    client.rows[1] = {
      ...client.rows[1]!,
      rationale: "tampered rationale",
    };

    expect(verifyDecisionChain(client.rows)).toEqual({ intact: false, brokenAtSequence: 2 });
  });

  it("rejects a self-consistent chain whose first sequence is missing", () => {
    const entry = decisionEntry(2, "genesis");

    expect(verifyDecisionChain([entry])).toEqual({ intact: false, brokenAtSequence: 2 });
  });

  it("rejects a self-consistent chain with an intermediate sequence gap", () => {
    const first = decisionEntry(1, "genesis");
    const third = decisionEntry(3, first.hash);

    expect(verifyDecisionChain([first, third])).toEqual({ intact: false, brokenAtSequence: 3 });
  });
});

function decisionEntry(
  sequence: number,
  previousHash: string,
  overrides: Partial<Omit<BrainDecisionEvent, "sequence" | "previousHash" | "hash">> = {},
): BrainDecisionEvent {
  const entry = {
    tenantId: "tenant_brain",
    sequence,
    occurredAt: new Date(`2026-07-17T00:0${sequence}:00.000Z`),
    actor: { kind: "user", userId: "user_1" } as const,
    subject: `decision_${sequence}`,
    decision: "Keep the sequence continuous.",
    rationale: "Missing entries must fail verification.",
    outcome: "accepted",
    detail: { source: "chain-test" },
    ...overrides,
  };
  return {
    ...entry,
    previousHash,
    hash: decisionHash(previousHash, entry),
  };
}

function legacyDecisionEntry(sequence: number, previousHash: string): BrainDecisionEvent {
  const event = {
    tenantId: "tenant_brain",
    sequence,
    occurredAt: new Date("2026-07-17T00:01:00.000Z"),
    actor: { kind: "user", userId: "user_1" } as const,
    subject: `decision_${sequence}`,
    decision: "Preserve legacy verification.",
    rationale: "Existing valid audit evidence must remain readable.",
    outcome: "accepted",
    detail: { source: "chain-test", compatible: true },
  };
  const hash = createHash("sha256")
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
  return { ...event, previousHash, hash };
}
