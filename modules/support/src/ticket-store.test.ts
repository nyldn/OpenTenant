import { describe, expect, it } from "vitest";
import {
  addMessage,
  assignTicket,
  createTicket,
  getTicket,
  getTicketByNumber,
  listTicketSummaries,
  listTickets,
  setPriority,
  setStatus,
  type SupportClient,
} from "./ticket-store";

/**
 * In-memory SQL fake covering the store's exact statements. Every mutation
 * must be accompanied by a ticket_events insert; the fake records statement
 * order so tests can assert the same-transaction pairing.
 */
class FakeSupportClient implements SupportClient {
  sequences = new Map<string, number>();
  tickets: Array<Record<string, unknown>> = [];
  messages: Array<Record<string, unknown>> = [];
  events: Array<Record<string, unknown>> = [];
  outbox: Array<{ ticket_id: unknown; ticket_version: unknown; kind: unknown; payload: string }> = [];
  statements: string[] = [];
  queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: TRow[] }> {
    this.statements.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
    this.queries.push({ sql, params });
    if (sql.includes("support.ticket_sequences")) {
      const tenant = String(params[0]);
      const next = (this.sequences.get(tenant) ?? 0) + 1;
      this.sequences.set(tenant, next);
      return { rows: [{ last_number: next }] as TRow[] };
    }
    if (sql.includes("insert into support.tickets")) {
      const row = {
        id: `t_${this.tickets.length + 1}`,
        tenant_id: params[0],
        ticket_number: params[1],
        created_by: params[2],
        assigned_to: null,
        subject: params[3],
        description: params[4],
        category: params[5],
        status: "open",
        priority: "medium",
        version: 1,
        created_at: new Date("2026-07-18T12:00:00Z"),
        updated_at: new Date("2026-07-18T12:00:00Z"),
      };
      this.tickets.push(row);
      return { rows: [row] as TRow[] };
    }
    if (sql.includes("insert into support.ticket_events")) {
      this.events.push({ tenant_id: params[0], ticket_id: params[1], kind: params[3] });
      return { rows: [] };
    }
    if (sql.includes("insert into support.outbox_events")) {
      this.outbox.push({
        ticket_id: params[1],
        ticket_version: params[3],
        kind: params[4],
        payload: String(params[5]),
      });
      return { rows: [] };
    }
    if (sql.includes("insert into support.messages")) {
      this.messages.push({ ticket_id: params[1], body: params[3], message_type: params[4] });
      return { rows: [] };
    }
    if (sql.startsWith("update support.tickets")) {
      const ticket = this.tickets.find((t) => t.tenant_id === params[0] && t.id === params[1]);
      if (!ticket) return { rows: [] };
      if (sql.includes("set status")) ticket.status = params[2];
      if (sql.includes("set priority")) ticket.priority = params[2];
      if (sql.includes("set assigned_to")) ticket.assigned_to = params[2];
      if (sql.includes("version = version + 1")) {
        ticket.version = Number(ticket.version) + 1;
      }
      return { rows: [ticket] as TRow[] };
    }
    if (sql.includes("from support.tickets")) {
      const filtered = this.tickets.filter((t) => t.tenant_id === params[0]);
      if (sql.includes("and id =")) {
        return { rows: filtered.filter((t) => t.id === params[1]) as TRow[] };
      }
      if (sql.includes("and ticket_number =")) {
        return { rows: filtered.filter((t) => t.ticket_number === params[1]) as TRow[] };
      }
      return { rows: filtered as TRow[] };
    }
    if (sql.includes("from support.messages")) return { rows: this.messages as TRow[] };
    if (sql.includes("from support.ticket_events")) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

const actor = { kind: "user", userId: "user_1" } as const;

describe("ticket store", () => {
  it("creates tickets with per-tenant sequential numbers and a created event", async () => {
    const client = new FakeSupportClient();
    const first = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "Cannot sign in",
      description: "SSO loops back to login.",
      category: "account_issue",
    });
    const second = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "Feature ask",
      description: "Export to CSV.",
      category: "feature_request",
    });

    expect(first.ticketNumber).toBe("SUP-000001");
    expect(second.ticketNumber).toBe("SUP-000002");
    expect(client.events.map((e) => e.kind)).toEqual(["created", "created"]);
  });

  it("pairs every mutation with its event", async () => {
    const client = new FakeSupportClient();
    const ticket = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "s",
      description: "d",
      category: "other",
    });

    await addMessage(client, {
      tenantId: "ten_a",
      ticketId: ticket.id,
      actor,
      authorId: "user_2",
      body: "On it.",
      internal: false,
    });
    await setStatus(client, { tenantId: "ten_a", ticketId: ticket.id, actor, status: "in_progress" });
    await setPriority(client, { tenantId: "ten_a", ticketId: ticket.id, actor, priority: "high" });
    await assignTicket(client, { tenantId: "ten_a", ticketId: ticket.id, actor, assignedTo: "user_2" });

    expect(client.events.map((e) => e.kind)).toEqual([
      "created",
      "reply",
      "status_change",
      "priority_change",
      "assignment",
    ]);
  });

  it("appends one versioned outbox envelope per mutation in the same client", async () => {
    const client = new FakeSupportClient();
    const ticket = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "s",
      description: "d",
      category: "other",
    });
    await addMessage(client, {
      tenantId: "ten_a",
      ticketId: ticket.id,
      actor,
      authorId: "user_2",
      body: "On it.",
      internal: false,
    });
    await setStatus(client, { tenantId: "ten_a", ticketId: ticket.id, actor, status: "in_progress" });
    await assignTicket(client, { tenantId: "ten_a", ticketId: ticket.id, actor, assignedTo: "user_2" });

    // Every mutation produced exactly one outbox row at the next canonical version.
    expect(client.outbox.map((o) => o.ticket_version)).toEqual([1, 2, 3, 4]);
    expect(client.outbox.map((o) => o.kind)).toEqual([
      "created",
      "reply",
      "status_change",
      "assignment",
    ]);
    // The ticket_events insert and the outbox insert always follow the
    // mutation on the same client, so one transaction commits all three.
    expect(client.statements.some((s) => s.startsWith("insert into support.ticket_events"))).toBe(true);
    expect(
      client.statements.filter((s) => s.startsWith("insert into support.outbox_events")),
    ).toHaveLength(4);
  });

  it("keeps the outbox envelope content-free and queue-shaped", async () => {
    const client = new FakeSupportClient();
    await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "Secret subject",
      description: "Secret description",
      category: "billing",
    });
    const envelope = JSON.parse(client.outbox[0]!.payload) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      tenantId: "ten_a",
      ticketNumber: "SUP-000001",
      ticketVersion: 1,
      kind: "created",
      status: "open",
      priority: "medium",
      category: "billing",
      assignedRef: null,
    });
    for (const denied of ["subject", "body", "description", "message", "messages", "attachment", "attachments"]) {
      expect(envelope).not.toHaveProperty(denied);
    }
    expect(JSON.stringify(envelope)).not.toContain("Secret");
  });

  it("rejects a message on a missing ticket without an event or outbox row", async () => {
    const client = new FakeSupportClient();
    await expect(
      addMessage(client, {
        tenantId: "ten_a",
        ticketId: "missing",
        actor,
        authorId: "user_2",
        body: "orphan",
        internal: false,
      }),
    ).rejects.toThrow("ticket not found");
    expect(client.events).toHaveLength(0);
    expect(client.outbox).toHaveLength(0);
  });

  it("rejects mutations on missing tickets without writing an event", async () => {
    const client = new FakeSupportClient();
    await expect(
      setStatus(client, { tenantId: "ten_a", ticketId: "missing", actor, status: "closed" }),
    ).rejects.toThrow("ticket not found");
    expect(client.events).toHaveLength(0);
  });

  it("marks internal notes distinctly from replies", async () => {
    const client = new FakeSupportClient();
    const ticket = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "s",
      description: "d",
      category: "other",
    });
    await addMessage(client, {
      tenantId: "ten_a",
      ticketId: ticket.id,
      actor,
      authorId: "user_2",
      body: "internal",
      internal: true,
    });
    expect(client.messages[0]?.message_type).toBe("internal_note");
    expect(client.events.at(-1)?.kind).toBe("internal_note");
  });

  it("lists and fetches tickets", async () => {
    const client = new FakeSupportClient();
    const ticket = await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "s",
      description: "d",
      category: "other",
    });
    const list = await listTickets(client, "ten_a");
    expect(list).toHaveLength(1);
    const detail = await getTicket(client, "ten_a", ticket.id);
    expect(detail?.ticket.ticketNumber).toBe("SUP-000001");
    expect(await getTicket(client, "ten_a", "missing")).toBeNull();
  });

  it("reopens canonical ticket detail by tenant-bound public reference", async () => {
    const client = new FakeSupportClient();
    await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_1",
      subject: "Canonical content",
      description: "Read only from the tenant store",
      category: "other",
    });

    const detail = await getTicketByNumber(client, "ten_a", "SUP-000001");

    expect(detail?.ticket.subject).toBe("Canonical content");
    expect(client.queries.some(({ sql, params }) =>
      sql.includes("tenant_id = $1 and ticket_number = $2") &&
      params[0] === "ten_a" &&
      params[1] === "SUP-000001",
    )).toBe(true);
  });

  it("lists at most 25 content-minimized summaries through a dedicated query", async () => {
    const client = new FakeSupportClient();
    await createTicket(client, {
      tenantId: "ten_a",
      actor,
      createdBy: "user_secret",
      subject: "Customer content must not cross the broker",
      description: "Private description must not be selected",
      category: "account_issue",
    });

    await expect(listTicketSummaries(client, "ten_a")).resolves.toEqual([{
      ticketNumber: "SUP-000001",
      category: "account_issue",
      status: "open",
      priority: "medium",
      updatedAt: "2026-07-18T12:00:00.000Z",
    }]);
    const query = client.queries.at(-1)!;
    expect(query.sql).toContain("limit 25");
    expect(query.sql).not.toMatch(/select\s+\*/iu);
    expect(query.sql).not.toMatch(/subject|description|created_by|assigned_to/iu);
    expect(query.params).toEqual(["ten_a"]);
  });
});
