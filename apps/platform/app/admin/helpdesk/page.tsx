import { AdminAccessDenied } from "../_components/admin-access-denied";
import { AdminTable } from "../_components/admin-table";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ownerHelpdeskQueue } from "../../../lib/helpdesk";

export const dynamic = "force-dynamic";

const QUEUES = ["all", "unassigned", "mine", "escalated", "sla-risk"] as const;
type Queue = (typeof QUEUES)[number];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OwnerHelpdeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const selected = first(query.queue);
  const queue: Queue = QUEUES.includes(selected as Queue) ? selected as Queue : "all";
  const result = await ownerHelpdeskQueue({
    tenantId: first(query.tenant),
    status: first(query.status),
    priority: first(query.priority),
    limit: 100,
  });
  if (!result.ok) {
    if (result.reason === "anonymous") redirect("/auth/login?return=/admin/helpdesk");
    return <AdminAccessDenied />;
  }

  const search = first(query.search)?.trim().toUpperCase();
  const ownerUserId = result.operatorUserId;
  const rows = result.rows.filter((row) => {
    if (search && !row.ticketNumber.includes(search)) return false;
    if (queue === "unassigned") return row.assignedRef === null;
    if (queue === "mine") return row.assignedRef === ownerUserId;
    if (queue === "escalated") return row.priority === "urgent";
    if (queue === "sla-risk") return ["high", "urgent"].includes(row.priority) && !["resolved", "closed"].includes(row.status);
    return true;
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <Link href="/admin" className="text-sm text-muted-foreground underline-offset-2 hover:underline">← Platform administration</Link>
      <h1 className="mt-3 font-display text-2xl font-bold">Helpdesk</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Discovery uses content-free projections. Ticket content is reopened and authorized from canonical tenant state.
      </p>

      <nav aria-label="Helpdesk queues" className="mt-6 flex flex-wrap gap-2">
        {QUEUES.map((name) => (
          <Link key={name} href={`/admin/helpdesk?queue=${name}`} aria-current={queue === name ? "page" : undefined}
            className="rounded-md border border-border px-3 py-2 text-sm capitalize hover:bg-accent">
            {name.replace("-", " ")}
          </Link>
        ))}
      </nav>

      <form role="search" className="mt-5 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-4">
        <input type="hidden" name="queue" value={queue} />
        <label className="text-sm">Ticket reference<input name="search" defaultValue={search} className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2" /></label>
        <label className="text-sm">Tenant<input name="tenant" defaultValue={first(query.tenant)} className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2" /></label>
        <label className="text-sm">Status<input name="status" defaultValue={first(query.status)} className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2" /></label>
        <label className="text-sm">Priority<input name="priority" defaultValue={first(query.priority)} className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2" /></label>
        <button className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Apply filters</button>
      </form>

      {queue === "sla-risk" ? <p role="note" className="mt-3 text-xs text-muted-foreground">Priority-risk view; contractual SLA clocks arrive in OPS-09.</p> : null}

      <div className="mt-6">
        <AdminTable name={`${queue.replace("-", " ")} helpdesk queue`}>
          <caption className="sr-only">{queue.replace("-", " ")} helpdesk queue</caption>
          <thead className="bg-muted text-muted-foreground text-left"><tr><th scope="col" className="px-4 py-2">Ticket</th><th scope="col" className="px-4 py-2">Tenant</th><th scope="col" className="px-4 py-2">Status</th><th scope="col" className="px-4 py-2">Assignment</th><th scope="col" className="px-4 py-2">Priority</th><th scope="col" className="px-4 py-2">Updated</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center">No tickets in this queue.</td></tr> : rows.map((row) => (
            <tr key={`${row.tenantId}/${row.ticketNumber}`} className="border-t border-border">
              <td className="px-4 py-2"><Link className="font-mono underline" href={`/admin/helpdesk/${encodeURIComponent(row.tenantId)}/${row.ticketNumber}`}>{row.ticketNumber}</Link></td>
              <td className="px-4 py-2 font-mono text-xs">{row.tenantId}</td><td className="px-4 py-2">{row.status.replace("_", " ")}</td>
              <td className="px-4 py-2">{row.assignedRef ?? "Unassigned"}</td><td className="px-4 py-2">{row.priority}</td>
              <td className="px-4 py-2">{row.ticketUpdatedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}</tbody>
        </AdminTable>
      </div>

      <section aria-labelledby="projection-health-heading" className="mt-6">
        <h2 id="projection-health-heading" className="font-display text-base font-semibold">Projection delivery health</h2>
        <p className="text-xs text-muted-foreground">{result.health.filter((item) => item.lastError).length} tenants report a delivery failure.</p>
      </section>
    </main>
  );
}
