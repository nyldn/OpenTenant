import { retryTicketEmail } from "./delivery-store";
import type { TenantId } from "@opentenant/auth";
import {
  addMessage,
  assignTicket,
  createTicket,
  getTicket,
  setPriority,
  setStatus,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "./index";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportContext } from "./host-context";

export function createSupportApi(host: ModuleHostServices) {
const supportContext = createSupportContext(host);

// Replies allow 10,000 characters; URL-encoded multi-byte text can take
// about nine bytes per character.
const SUPPORT_FORM_MAX_BYTES = 256 * 1024;



const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Ticket mutations gated on the approved fine-grained vocabulary (legacy
 * support.use/support.admin expand fail-closed in supportContext): create
 * needs support.ticket.create, replies need reply_own or reply, internal
 * notes need note_internal, assignment needs assign, and status/priority
 * need manage. The per-ticket event trail plus its outbox envelope are
 * written transactionally with each change inside the tenant DB;
 * admin-significant changes also mirror to the platform audit chain after
 * commit.
 */
async function POST(req: Request): Promise<Response> {
  const gate = await supportContext();
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!host.sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await host.enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { session, tenantId, permissions } = gate.context;
  const can = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const actor = host.auditActor(session);
  const tenant = tenantId as TenantId;

  const form = await host.readBoundedForm(req, SUPPORT_FORM_MAX_BYTES);
  const op = form?.get("op");

  if (op === "create") {
    if (!can("support.ticket.create")) return new Response("forbidden", { status: 403 });
    const subject = String(form?.get("subject") ?? "").trim();
    const description = String(form?.get("description") ?? "").trim();
    const category = String(form?.get("category") ?? "other");
    if (!subject || subject.length > 200 || !description || description.length > 5000) {
      return Response.redirect(new URL("/support?error=input", req.url), 303);
    }
    if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
      return Response.redirect(new URL("/support?error=input", req.url), 303);
    }
    const ticket = await host.withTenantDb(tenant, (client) =>
      createTicket(client, {
        tenantId,
        actor,
        createdBy: session.userId,
        subject,
        description,
        category: category as TicketCategory,
      }),
    );
    return Response.redirect(new URL(`/support/${ticket.id}`, req.url), 303);
  }

  const ticketId = String(form?.get("ticketId") ?? "");
  if (!UUID.test(ticketId)) return new Response("bad ticket id", { status: 400 });

  // Requesters may only touch their own tickets; tenant staff need
  // support.ticket.read_tenant to reach another member's ticket at all.
  const detail = await host.withTenantDb(tenant, (client) => getTicket(client, tenantId, ticketId));
  if (!detail) return new Response("not found", { status: 404 });
  const ownTicket = detail.ticket.createdBy === session.userId;
  if (!ownTicket && !can("support.ticket.read_tenant")) {
    return new Response("not found", { status: 404 });
  }

  if (op === "retry_email") {
    if (!can("support.ticket.manage")) return new Response("forbidden", { status: 403 });
    const deliveryId = String(form?.get("deliveryId") ?? "");
    if (!UUID.test(deliveryId)) return new Response("bad delivery id", { status: 400 });
    try {
      const retried = await host.withTenantDb(tenant, (client) =>
        retryTicketEmail(client, { tenantId, ticketId, deliveryId, actor }),
      );
      if (!retried) return new Response("Email is no longer available for retry.", { status: 409 });
    } catch {
      return new Response("Email retry could not be saved. Please try again.", { status: 503 });
    }
    return Response.redirect(new URL(`/support/${ticketId}`, req.url), 303);
  }

  if (op === "reply") {
    const body = String(form?.get("body") ?? "").trim();
    const internal = form?.get("internal") === "1";
    if (!body || body.length > 10000) {
      return Response.redirect(new URL(`/support/${ticketId}?error=input`, req.url), 303);
    }
    if (internal && !can("support.ticket.note_internal")) {
      return new Response("forbidden", { status: 403 });
    }
    if (!internal && !(ownTicket
      ? can("support.ticket.reply_own") || can("support.ticket.reply")
      : can("support.ticket.reply"))) {
      return new Response("forbidden", { status: 403 });
    }
    await host.withTenantDb(tenant, (client) =>
      addMessage(client, { tenantId, ticketId, actor, authorId: session.userId, body, internal }),
    );
    return Response.redirect(new URL(`/support/${ticketId}`, req.url), 303);
  }

  if (op === "assign") {
    if (!can("support.ticket.assign")) return new Response("forbidden", { status: 403 });
  } else if (!can("support.ticket.manage")) {
    // Remaining triage operations (status, priority) require manage.
    return new Response("forbidden", { status: 403 });
  }

  if (op === "status") {
    const status = String(form?.get("status") ?? "");
    if (!TICKET_STATUSES.includes(status as TicketStatus)) {
      return new Response("bad status", { status: 400 });
    }
    await host.withTenantDb(tenant, (client) =>
      setStatus(client, { tenantId, ticketId, actor, status: status as TicketStatus }),
    );
    await mirror(actor, tenantId, "support.ticket_status_changed", detail.ticket.ticketNumber, { status });
    return Response.redirect(new URL(`/support/${ticketId}`, req.url), 303);
  }

  if (op === "priority") {
    const priority = String(form?.get("priority") ?? "");
    if (!TICKET_PRIORITIES.includes(priority as TicketPriority)) {
      return new Response("bad priority", { status: 400 });
    }
    await host.withTenantDb(tenant, (client) =>
      setPriority(client, { tenantId, ticketId, actor, priority: priority as TicketPriority }),
    );
    return Response.redirect(new URL(`/support/${ticketId}`, req.url), 303);
  }

  if (op === "assign") {
    const raw = String(form?.get("assignedTo") ?? "").trim();
    const assignedTo = raw === "" ? null : raw;
    if (assignedTo !== null && !USER_ID.test(assignedTo)) {
      return new Response("bad assignee", { status: 400 });
    }
    await host.withTenantDb(tenant, (client) =>
      assignTicket(client, { tenantId, ticketId, actor, assignedTo }),
    );
    await mirror(actor, tenantId, "support.ticket_assigned", detail.ticket.ticketNumber, { assignedTo });
    return Response.redirect(new URL(`/support/${ticketId}`, req.url), 303);
  }

  return new Response("unknown operation", { status: 400 });
}

/** Mirror to the platform audit chain; never blocks the committed change. */
async function mirror(
  actor: ReturnType<ModuleHostServices["auditActor"]>,
  tenantId: string,
  action: string,
  subject: string,
  detail: Record<string, string | null>,
): Promise<void> {
  try {
    await host.audit(actor, tenantId, action, subject, detail);
  } catch {
    // The tenant-local event trail already recorded the change.
  }
}

return POST;
}
