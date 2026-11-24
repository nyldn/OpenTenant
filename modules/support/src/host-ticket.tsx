import Link from "next/link";
import { SupportAiReviewMount } from "./support-ai-review-mount";
import { supportAiCapabilities } from "./support-ai-api";
import { EmailDeliveryPanel } from "./email-delivery-panel";
import { listTicketEmailDeliveries } from "./delivery-store";
import { AccessDenied, FormInput } from "@opentenant/design-system";
import { notFound, redirect } from "next/navigation";
import type { TenantId } from "@opentenant/auth";
import { getTicket, listDeadOutboxEvents, TICKET_PRIORITIES, TICKET_STATUSES } from "./index";
const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime())
}

export function formatUtcDate(value: Date) {
  return isValidDate(value) ? utcDateFormatter.format(value) : "Unknown date"
}

export function formatUtcDateTime(value: Date) {
  return isValidDate(value) ? `${utcDateTimeFormatter.format(value)} UTC` : "Unknown date"
}

import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportContext } from "./host-context";
import { TicketForm, TicketSelect, TicketTextarea } from "./host-ui";

export function createTicketPage(host: ModuleHostServices) {
const supportContext = createSupportContext(host);



const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const gate = await supportContext();
  if (!gate.ok) {
    if (gate.reason === "anonymous") redirect(`/auth/login?return=/support/${id}`);
    return <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-10"><AccessDenied state="forbidden" action={{ label: "Go home", href: "/" }} /></main>;
  }
  const { session, tenantId, capabilities } = gate.context;
  const aiCapabilities = await supportAiCapabilities(host, gate.context);

  const detail = await host.withTenantDb(tenantId as TenantId, (client) => getTicket(client, tenantId, id));
  if (!detail) notFound();
  const { ticket, messages, events } = detail;
  const ownTicket = ticket.createdBy === session.userId;
  if (!(capabilities.readTenant || (ownTicket && capabilities.readOwn))) notFound();

  const visibleMessages = capabilities.noteInternal ? messages : messages.filter((m) => m.messageType !== "internal_note");
  // Internal-note existence and timing are staff-only too, not just bodies.
  const visibleEvents = capabilities.noteInternal ? events : events.filter((e) => e.kind !== "internal_note");
  const deliveryFailures = capabilities.viewDeliveryFailures
    ? (await host.withTenantDb(tenantId as TenantId, (client) => listDeadOutboxEvents(client, tenantId)))
        .filter((failure) => failure.ticketNumber === ticket.ticketNumber)
    : [];
  const emailDeliveries = capabilities.viewDeliveryFailures
    ? await host.withTenantDb(tenantId as TenantId, client => listTicketEmailDeliveries(client, tenantId, id))
    : [];
  const canPublicReply = ownTicket
    ? capabilities.replyOwn || capabilities.replyTenant
    : capabilities.replyTenant;

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-10">
      <Link href="/support" className="text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">← Support</Link>
      <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h1 className="min-w-0 [overflow-wrap:anywhere] font-display text-xl font-bold">{ticket.subject}</h1>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
      </div>
      <dl className="mt-3 grid min-w-0 gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</dt><dd>{ticket.status.replace("_", " ")}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignment</dt><dd className="[overflow-wrap:anywhere]">{ticket.assignedTo ?? "Unassigned"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</dt><dd>{ticket.priority}</dd></div>
      </dl>

      <div className="mt-6 [overflow-wrap:anywhere] rounded-lg border border-border p-4 text-sm whitespace-pre-wrap">{ticket.description}</div>

      <div className="mt-6 space-y-3">
        {visibleMessages.map((m) => (
          <div key={m.id} className={`rounded-lg border p-4 text-sm ${m.messageType === "internal_note" ? "border-warning-text bg-warning text-warning-foreground" : "border-border"}`}>
            <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{m.messageType === "internal_note" ? "Internal note" : "Reply"}</span>
              <time dateTime={m.createdAt.toISOString()}>{formatUtcDateTime(m.createdAt)}</time>
            </div>
            <div className="[overflow-wrap:anywhere] whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>

      {aiCapabilities.suggest ? <SupportAiReviewMount host={host} ticketId={ticket.id} ticketVersion={ticket.version} /> : null}

      {(canPublicReply || capabilities.noteInternal) ? <TicketForm id={`support-reply-form-${ticket.id}`} method="POST" action="/api/support/tickets" successPath={`/support/${ticket.id}`} successMessage={canPublicReply ? "Reply sent." : "Internal note added."} className="mt-6 space-y-3 rounded-lg border border-border p-4">
        <input type="hidden" name="op" value="reply" />
        <input type="hidden" name="ticketId" value={ticket.id} />
        {capabilities.noteInternal && !canPublicReply ? <input type="hidden" name="internal" value="1" /> : null}
        <TicketTextarea name="body" label={canPublicReply ? "Reply" : "Internal note"} autoComplete="off" required maxLength={10000} rows={4} />
        {capabilities.noteInternal && canPublicReply && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="internal" value="1" />
            Internal note (hidden from the requester)
          </label>
        )}
        <button type="submit" className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {canPublicReply ? "Send" : "Add note"}
        </button>
      </TicketForm> : null}

      {(capabilities.manage || capabilities.assign) && (
        <div className="mt-6 grid min-w-0 gap-4 md:grid-cols-3">
          {capabilities.manage ? <TicketForm method="POST" action="/api/support/tickets" successPath={`/support/${ticket.id}`} successMessage="Ticket status updated." className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <input type="hidden" name="op" value="status" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <TicketSelect name="status" label="Status" defaultValue={ticket.status}>
              {TICKET_STATUSES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </TicketSelect>
            <button type="submit" className="min-h-11 rounded-md border border-border px-3 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Update</button>
          </TicketForm> : null}
          {capabilities.manage ? <TicketForm method="POST" action="/api/support/tickets" successPath={`/support/${ticket.id}`} successMessage="Ticket priority updated." className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <input type="hidden" name="op" value="priority" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <TicketSelect name="priority" label="Priority" defaultValue={ticket.priority}>
              {TICKET_PRIORITIES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </TicketSelect>
            <button type="submit" className="min-h-11 rounded-md border border-border px-3 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Update</button>
          </TicketForm> : null}
          {capabilities.assign ? <TicketForm method="POST" action="/api/support/tickets" successPath={`/support/${ticket.id}`} successMessage="Ticket assignment updated." className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <input type="hidden" name="op" value="assign" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <FormInput name="assignedTo" label="Assignee (user id)" type="text" autoComplete="off" defaultValue={ticket.assignedTo ?? ""} placeholder="User ID…" />
            <button type="submit" className="min-h-11 rounded-md border border-border px-3 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Assign</button>
          </TicketForm> : null}
        </div>
      )}

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer text-muted-foreground">History ({visibleEvents.length})</summary>
        <ul className="mt-2 space-y-1">
          {visibleEvents.map((e) => (
            <li key={e.id} className="text-xs text-muted-foreground">
              <time dateTime={e.createdAt.toISOString()}>{formatUtcDateTime(e.createdAt)}</time> · {e.kind.replace("_", " ")}
            </li>
          ))}
        </ul>
      </details>

      <EmailDeliveryPanel deliveries={emailDeliveries} ticketId={ticket.id} />

      {capabilities.viewDeliveryFailures ? (
        <section aria-labelledby="delivery-failures-heading" className="mt-8 rounded-lg border border-border p-4">
          <h2 id="delivery-failures-heading" className="font-display text-base font-semibold">Delivery failures</h2>
          <p className="mt-1 text-xs text-muted-foreground">Content-free support projection failures for tenant administrators.</p>
          {deliveryFailures.length === 0 ? <p className="mt-3 text-sm">No permanent delivery failures.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {deliveryFailures.map((failure) => (
                <li key={failure.id}>
                  <span className="font-mono">{failure.ticketNumber}</span>
                  {" · "}{failure.kind.replace("_", " ")} · {failure.attempts} attempts
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}

return TicketPage;
}
