import Link from "next/link";
import { AccessDenied, FormInput } from "@opentenant/design-system";
import { redirect } from "next/navigation";
import type { TenantId } from "@opentenant/auth";
import { listTickets, TICKET_CATEGORIES } from "./index";
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
import { TicketForm, TicketSelect, TicketTable, TicketTextarea } from "./host-ui";

export function createSupportPage(host: ModuleHostServices) {
const supportContext = createSupportContext(host);



const STATUS_STYLE: Record<string, string> = {
  open: "text-warning-text",
  in_progress: "text-info-text",
  awaiting_reply: "text-warning-text",
  resolved: "text-success-text",
  closed: "text-muted-foreground",
};

async function SupportPage() {
  const gate = await supportContext();
  if (!gate.ok) {
    if (gate.reason === "anonymous") redirect("/auth/login?return=/support");
    return <main className="mx-auto w-full min-w-0 max-w-4xl px-6 py-10"><AccessDenied state="forbidden" action={{ label: "Go home", href: "/" }} /></main>;
  }
  const { session, tenantId, tenantDisplayName, capabilities } = gate.context;

  const tickets = capabilities.readTenant || capabilities.readOwn
    ? await host.withTenantDb(tenantId as TenantId, (client) =>
        listTickets(client, tenantId, capabilities.readTenant ? {} : { createdBy: session.userId }),
      )
    : [];

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl px-6 py-10">
      <h1 className="font-display text-xl font-bold">Support</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {capabilities.readTenant ? `Tenant queue for ${tenantDisplayName}.` : "Your tickets."} Replies land here and
        in your inbox.
      </p>

      {capabilities.create ? <TicketForm method="POST" action="/api/support/tickets" successPath="/support/" create successMessage="Ticket opened." className="mt-6 space-y-3 rounded-lg border border-border p-4">
        <input type="hidden" name="op" value="create" />
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <FormInput name="subject" label="Subject" type="text" autoComplete="off" required maxLength={200} />
          <TicketSelect name="category" label="Category">
            {TICKET_CATEGORIES.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}
          </TicketSelect>
        </div>
        <TicketTextarea name="description" label="What happened?" autoComplete="off" required maxLength={5000} rows={4} />
        <button type="submit" className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">Open ticket</button>
      </TicketForm> : null}

      <TicketTable>
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2">Ticket</th>
              <th scope="col" className="px-4 py-2">Subject</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Assignment</th>
              <th scope="col" className="px-4 py-2">Priority</th>
              <th scope="col" className="px-4 py-2">Opened</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No tickets available.</td></tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/support/${t.id}`} className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t.ticketNumber}</Link>
                  </td>
                  <td className="max-w-64 px-4 py-2 [overflow-wrap:anywhere]">{t.subject}</td>
                  <td className={`px-4 py-2 ${STATUS_STYLE[t.status] ?? ""}`}>{t.status.replace("_", " ")}</td>
                  <td className="max-w-48 px-4 py-2 [overflow-wrap:anywhere]">{t.assignedTo ?? "Unassigned"}</td>
                  <td className="px-4 py-2">{t.priority}</td>
                  <td className="px-4 py-2 text-muted-foreground"><time dateTime={t.createdAt.toISOString()}>{formatUtcDate(t.createdAt)}</time></td>
                </tr>
              ))
            )}
          </tbody>
      </TicketTable>
    </main>
  );
}

return SupportPage;
}
