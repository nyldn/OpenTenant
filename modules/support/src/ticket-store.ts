/**
 * Tenant-local ticket store. Every mutation writes its ticket_event in the
 * same transaction, so a change never lands unaudited (the support module
 * pattern). The caller owns tenant context: run inside withTenantContext so
 * app.tenant_id satisfies the fail-closed RLS policies.
 */
import type { AuditActor } from "@opentenant/security";
import type {
  TicketCategory,
  TicketEventKind,
  TicketEventRecord,
  TicketMessageRecord,
  TicketOutboxEnvelope,
  TicketPriority,
  TicketRecord,
  TicketStatus,
  SupportTicketSummary,
} from "./types";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "./types";

export interface SupportClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

interface TicketRow {
  id: string;
  tenant_id: string;
  ticket_number: string;
  created_by: string;
  assigned_to: string | null;
  subject: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  version: string | number;
  created_at: Date;
  updated_at: Date;
}

function ticketFromRow(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ticketNumber: row.ticket_number,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    subject: row.subject,
    description: row.description,
    category: row.category,
    status: row.status,
    priority: row.priority,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function envelopeFromTicket(ticket: TicketRecord, kind: TicketEventKind): TicketOutboxEnvelope {
  return {
    schemaVersion: 1,
    tenantId: ticket.tenantId,
    ticketNumber: ticket.ticketNumber,
    ticketVersion: ticket.version,
    kind,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    assignedRef: ticket.assignedTo,
    openedAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Records one canonical ticket change: the append-only tenant event and the
 * transactional outbox row share the caller's transaction with the ticket
 * mutation, so all three commit or roll back together. The outbox envelope
 * carries queue metadata only; the migration structurally denies content keys.
 */
async function recordTicketChange(
  client: SupportClient,
  ticket: TicketRecord,
  actor: AuditActor,
  kind: TicketEventKind,
  detail: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await client.query(
    `insert into support.ticket_events (tenant_id, ticket_id, actor, kind, detail)
     values ($1, $2, $3::jsonb, $4, $5::jsonb)`,
    [ticket.tenantId, ticket.id, JSON.stringify(actor), kind, JSON.stringify(detail)],
  );
  const envelope = envelopeFromTicket(ticket, kind);
  await client.query(
    `insert into support.outbox_events
       (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload, occurred_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      ticket.tenantId,
      ticket.id,
      ticket.ticketNumber,
      ticket.version,
      kind,
      JSON.stringify(envelope),
      envelope.occurredAt,
    ],
  );
}

export async function createTicket(
  client: SupportClient,
  input: {
    tenantId: string;
    actor: AuditActor;
    createdBy: string;
    subject: string;
    description: string;
    category: TicketCategory;
  },
): Promise<TicketRecord> {
  const { rows: seq } = await client.query<{ last_number: number }>(
    `insert into support.ticket_sequences (tenant_id, last_number)
     values ($1, 1)
     on conflict (tenant_id) do update set last_number = support.ticket_sequences.last_number + 1
     returning last_number`,
    [input.tenantId],
  );
  const number = `SUP-${String(seq[0]?.last_number ?? 0).padStart(6, "0")}`;

  const { rows } = await client.query<TicketRow>(
    `insert into support.tickets (tenant_id, ticket_number, created_by, subject, description, category)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [input.tenantId, number, input.createdBy, input.subject, input.description, input.category],
  );
  const ticket = ticketFromRow(rows[0]!);
  await recordTicketChange(client, ticket, input.actor, "created", {
    category: input.category,
  });
  return ticket;
}

export async function addMessage(
  client: SupportClient,
  input: {
    tenantId: string;
    ticketId: string;
    actor: AuditActor;
    authorId: string;
    body: string;
    internal: boolean;
  },
): Promise<void> {
  await client.query(
    `insert into support.messages (tenant_id, ticket_id, author_id, body, message_type)
     values ($1, $2, $3, $4, $5)`,
    [input.tenantId, input.ticketId, input.authorId, input.body, input.internal ? "internal_note" : "reply"],
  );
  const { rows } = await client.query<TicketRow>(
    `update support.tickets set version = version + 1, updated_at = now()
     where tenant_id = $1 and id = $2
     returning *`,
    [input.tenantId, input.ticketId],
  );
  if (rows.length === 0) throw new Error("ticket not found");
  await recordTicketChange(
    client,
    ticketFromRow(rows[0]!),
    input.actor,
    input.internal ? "internal_note" : "reply",
    {},
  );
}

export async function setStatus(
  client: SupportClient,
  input: { tenantId: string; ticketId: string; actor: AuditActor; status: TicketStatus },
): Promise<void> {
  if (!TICKET_STATUSES.includes(input.status)) throw new Error("invalid status");
  const { rows } = await client.query<TicketRow>(
    `update support.tickets set status = $3, version = version + 1, updated_at = now()
     where tenant_id = $1 and id = $2
     returning *`,
    [input.tenantId, input.ticketId, input.status],
  );
  if (rows.length === 0) throw new Error("ticket not found");
  await recordTicketChange(client, ticketFromRow(rows[0]!), input.actor, "status_change", {
    status: input.status,
  });
}

export async function setPriority(
  client: SupportClient,
  input: { tenantId: string; ticketId: string; actor: AuditActor; priority: TicketPriority },
): Promise<void> {
  if (!TICKET_PRIORITIES.includes(input.priority)) throw new Error("invalid priority");
  const { rows } = await client.query<TicketRow>(
    `update support.tickets set priority = $3, version = version + 1, updated_at = now()
     where tenant_id = $1 and id = $2
     returning *`,
    [input.tenantId, input.ticketId, input.priority],
  );
  if (rows.length === 0) throw new Error("ticket not found");
  await recordTicketChange(client, ticketFromRow(rows[0]!), input.actor, "priority_change", {
    priority: input.priority,
  });
}

export async function assignTicket(
  client: SupportClient,
  input: { tenantId: string; ticketId: string; actor: AuditActor; assignedTo: string | null },
): Promise<void> {
  const { rows } = await client.query<TicketRow>(
    `update support.tickets set assigned_to = $3, version = version + 1, updated_at = now()
     where tenant_id = $1 and id = $2
     returning *`,
    [input.tenantId, input.ticketId, input.assignedTo],
  );
  if (rows.length === 0) throw new Error("ticket not found");
  await recordTicketChange(client, ticketFromRow(rows[0]!), input.actor, "assignment", {
    assignedTo: input.assignedTo,
  });
}

export async function listTickets(
  client: SupportClient,
  tenantId: string,
  filter: { status?: TicketStatus; createdBy?: string } = {},
): Promise<TicketRecord[]> {
  const clauses = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filter.createdBy) {
    params.push(filter.createdBy);
    clauses.push(`created_by = $${params.length}`);
  }
  const { rows } = await client.query<TicketRow>(
    `select * from support.tickets
      where ${clauses.join(" and ")}
      order by case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               created_at desc
      limit 200`,
    params,
  );
  return rows.map(ticketFromRow);
}

/** Fixed, content-minimized projection for `support.ticket.read`; never accepts caller-selected fields or limits. */
export async function listTicketSummaries(
  client: SupportClient,
  tenantId: string,
): Promise<SupportTicketSummary[]> {
  const { rows } = await client.query<{
    ticket_number: string;
    category: TicketCategory;
    status: TicketStatus;
    priority: TicketPriority;
    updated_at: Date;
  }>(
    `select ticket_number, category, status, priority, updated_at
       from support.tickets
      where tenant_id = $1
      order by updated_at desc
      limit 25`,
    [tenantId],
  );
  return rows.map((row) => ({
    ticketNumber: row.ticket_number,
    category: row.category,
    status: row.status,
    priority: row.priority,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function getTicket(
  client: SupportClient,
  tenantId: string,
  ticketId: string,
): Promise<TicketDetail | null> {
  return getTicketWhere(client, tenantId, "id", ticketId);
}

export async function getTicketByNumber(
  client: SupportClient,
  tenantId: string,
  ticketNumber: string,
): Promise<TicketDetail | null> {
  return getTicketWhere(client, tenantId, "ticket_number", ticketNumber);
}

type TicketDetail = {
  ticket: TicketRecord;
  messages: TicketMessageRecord[];
  events: TicketEventRecord[];
};

async function getTicketWhere(
  client: SupportClient,
  tenantId: string,
  column: "id" | "ticket_number",
  value: string,
): Promise<{
  ticket: TicketRecord;
  messages: TicketMessageRecord[];
  events: TicketEventRecord[];
} | null> {
  const { rows } = await client.query<TicketRow>(
    `select * from support.tickets where tenant_id = $1 and ${column} = $2`,
    [tenantId, value],
  );
  if (rows.length === 0) return null;
  const ticketId = rows[0]!.id;
  const { rows: messageRows } = await client.query<{
    id: string;
    ticket_id: string;
    author_id: string;
    body: string;
    message_type: TicketMessageRecord["messageType"];
    created_at: Date;
  }>(
    `select id, ticket_id, author_id, body, message_type, created_at
       from support.messages where tenant_id = $1 and ticket_id = $2 order by created_at asc`,
    [tenantId, ticketId],
  );
  const { rows: eventRows } = await client.query<{
    id: string;
    ticket_id: string;
    actor: AuditActor;
    kind: TicketEventRecord["kind"];
    detail: TicketEventRecord["detail"];
    created_at: Date;
  }>(
    `select id, ticket_id, actor, kind, detail, created_at
       from support.ticket_events where tenant_id = $1 and ticket_id = $2 order by created_at asc`,
    [tenantId, ticketId],
  );
  return {
    ticket: ticketFromRow(rows[0]!),
    messages: messageRows.map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      authorId: m.author_id,
      body: m.body,
      messageType: m.message_type,
      createdAt: m.created_at,
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      ticketId: e.ticket_id,
      actor: e.actor,
      kind: e.kind,
      detail: e.detail,
      createdAt: e.created_at,
    })),
  };
}
