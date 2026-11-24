import { describe, expect, it } from "vitest";
import {
  OUTBOX_MAX_ATTEMPTS,
  claimPendingOutboxEvents,
  latestOutboxEventId,
  listDeadOutboxEvents,
  markOutboxDelivered,
  markOutboxFailed,
} from "./outbox";
import type { SupportClient } from "./ticket-store";

/** Records statements and returns scripted rows in call order. */
class ScriptedClient implements SupportClient {
  queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  constructor(private readonly scripted: Array<Array<Record<string, unknown>>>) {}

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: TRow[] }> {
    this.queries.push({ sql, params });
    return { rows: (this.scripted.shift() ?? []) as TRow[] };
  }
}

const outboxRow = {
  id: "7",
  tenant_id: "ten_a",
  ticket_id: "t_1",
  ticket_number: "SUP-000001",
  ticket_version: "3",
  kind: "status_change",
  payload: { schemaVersion: 1 },
  occurred_at: new Date("2026-07-27T10:00:00Z"),
  status: "pending",
  attempts: 1,
  claimed_at: new Date("2026-07-27T10:00:01Z"),
  delivered_at: null,
  last_error: null,
};

describe("outbox claim", () => {
  it("claims pending rows in id order with skip locked and bounded limit", async () => {
    const client = new ScriptedClient([[outboxRow]]);
    const claimed = await claimPendingOutboxEvents(client, "ten_a", 1000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: 7, ticketVersion: 3, status: "pending" });
    const { sql, params } = client.queries[0]!;
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("order by id");
    expect(sql).toContain("attempts = attempts + 1");
    expect(params[0]).toBe("ten_a");
    expect(params[1]).toBe(100); // limit is clamped
  });

  it("only reclaims stale claims through the claim timeout", async () => {
    const client = new ScriptedClient([[]]);
    await claimPendingOutboxEvents(client, "ten_a", 5);
    expect(client.queries[0]!.sql).toContain("claimed_at is null");
    expect(client.queries[0]!.sql).toContain("make_interval");
  });
});

describe("outbox delivery state", () => {
  it("marks a pending event delivered exactly once", async () => {
    const client = new ScriptedClient([[{ id: "7" }]]);
    await markOutboxDelivered(client, "ten_a", 7);
    expect(client.queries[0]!.sql).toContain("status = 'delivered'");
    expect(client.queries[0]!.sql).toContain("and status = 'pending'");
  });

  it("throws when the event is not claimable", async () => {
    const client = new ScriptedClient([[]]);
    await expect(markOutboxDelivered(client, "ten_a", 7)).rejects.toThrow(
      "outbox event not claimable",
    );
  });

  it("keeps a failed event pending inside the retry budget", async () => {
    const client = new ScriptedClient([[{ status: "pending" }]]);
    const status = await markOutboxFailed(client, "ten_a", 7, "boom");
    expect(status).toBe("pending");
    const { params } = client.queries[0]!;
    expect(params[3]).toBe(false);
    expect(params[4]).toBe(OUTBOX_MAX_ATTEMPTS);
  });

  it("dead-letters an explicitly permanent failure", async () => {
    const client = new ScriptedClient([[{ status: "dead" }]]);
    const status = await markOutboxFailed(client, "ten_a", 7, "schema mismatch", {
      permanent: true,
    });
    expect(status).toBe("dead");
    expect(client.queries[0]!.params[3]).toBe(true);
  });

  it("truncates long error strings to the column bound", async () => {
    const client = new ScriptedClient([[{ status: "pending" }]]);
    await markOutboxFailed(client, "ten_a", 7, "x".repeat(2000));
    expect(String(client.queries[0]!.params[2])).toHaveLength(500);
  });
});

describe("outbox visibility", () => {
  it("lists dead-letter events with a bounded limit", async () => {
    const client = new ScriptedClient([[{ ...outboxRow, status: "dead" }]]);
    const dead = await listDeadOutboxEvents(client, "ten_a", 10_000);
    expect(dead[0]!.status).toBe("dead");
    expect(client.queries[0]!.params[1]).toBe(200);
  });

  it("reports the reconciliation checkpoint as zero for an empty outbox", async () => {
    const client = new ScriptedClient([[{ max_id: null }]]);
    await expect(latestOutboxEventId(client, "ten_a")).resolves.toBe(0);
  });
});
