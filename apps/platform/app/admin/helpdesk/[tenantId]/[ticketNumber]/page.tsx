import { AdminAccessDenied } from "../../../_components/admin-access-denied";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ownerHelpdeskTicket } from "../../../../../lib/helpdesk";

export const dynamic = "force-dynamic";

export default async function OwnerHelpdeskTicketPage({
  params,
}: {
  params: Promise<{ tenantId: string; ticketNumber: string }>;
}) {
  const { tenantId, ticketNumber } = await params;
  const result = await ownerHelpdeskTicket(tenantId, ticketNumber);
  if (!result.ok) {
    if (result.reason === "anonymous") redirect(`/auth/login?return=/admin/helpdesk/${tenantId}/${ticketNumber}`);
    if (result.reason === "missing_installation_authority" || result.reason === "unknown_installation_permission" || result.reason === "tenant_support_denied") return <AdminAccessDenied />;
    notFound();
  }
  const { ticket, messages, events } = result.detail;
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 [overflow-wrap:anywhere]">
      <Link href="/admin/helpdesk" className="text-sm text-muted-foreground underline">← Helpdesk queues</Link>
      <h1 className="mt-3 font-display text-xl font-bold">{ticket.subject}</h1>
      <p className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber} · tenant {ticket.tenantId}</p>
      <dl className="mt-5 grid gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs font-semibold uppercase text-muted-foreground">Status</dt><dd>{ticket.status.replace("_", " ")}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-muted-foreground">Assignment</dt><dd>{ticket.assignedTo ?? "Unassigned"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-muted-foreground">Priority</dt><dd>{ticket.priority}</dd></div>
      </dl>
      <section aria-labelledby="conversation-heading" className="mt-6">
        <h2 id="conversation-heading" className="font-display font-semibold">Conversation</h2>
        <div className="mt-3 rounded-lg border border-border p-4 whitespace-pre-wrap">{ticket.description}</div>
        {messages.map((message) => <article key={message.id} className="mt-3 rounded-lg border border-border p-4"><p className="text-xs text-muted-foreground">{message.messageType.replace("_", " ")}</p><p className="whitespace-pre-wrap">{message.body}</p></article>)}
      </section>
      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="font-display font-semibold">History</h2>
        <ol className="mt-2 space-y-1 text-sm">{events.map((event) => <li key={event.id}><time>{event.createdAt.toISOString().slice(0, 16).replace("T", " ")}</time> · {event.kind.replace("_", " ")}</li>)}</ol>
      </section>
    </main>
  );
}
