import { AdminTable } from "../_components/admin-table";
import { AdminAccessDenied } from "../_components/admin-access-denied";
import { redirect } from "next/navigation";
import { authorizeInstallationAction } from "@opentenant/auth";
import { auditStore } from "../../../lib/audit";
import { currentSession } from "../../../lib/session";
import { parseAuditFilters } from "../../../lib/audit-filters";
import { AuditFiltersForm } from "./audit-filters-form";

export const dynamic = "force-dynamic";

/**
 * Audit log viewer (spec section 14). Platform administration only. Shows the
 * most recent privileged events and whether the platform-scoped hash chain
 * verifies, making the tamper-evident trail visible for SOC 2 evidence.
 */
export default async function AuditPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await currentSession();
  if (!session) redirect("/auth/login?return=/admin/audit");
  if (!authorizeInstallationAction(session, "owner.audit.read").allowed) return <AdminAccessDenied />;

  const { values, filters, invalid } = parseAuditFilters(await searchParams ?? {});
  const store = auditStore();
  const [events, platformChain] = await Promise.all([invalid ? [] : store.listRecent(100, filters), store.verifyChain(null)]);
  const chainLabel = !platformChain.intact
    ? `Chain unverified at sequence ${platformChain.brokenAtSequence} (${platformChain.failure})`
    : platformChain.assurance === "legacy-unbound"
      ? "Platform chain verified with legacy-format prefix"
      : platformChain.assurance === "empty"
        ? "Platform chain empty"
        : "Platform chain verified (canonical)";

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Audit log</h1>
        <span
          className={`rounded-full border px-3 py-1 text-xs ${
            !platformChain.intact
              ? "border-danger-text bg-danger text-danger-foreground"
              : platformChain.assurance === "legacy-unbound"
                ? "border-warning-text bg-warning text-warning-foreground"
                : "border-success-text bg-success text-success-foreground"
          }`}
        >
          {chainLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Detail carries identifiers and configuration only, never client content.</p>
      <AuditFiltersForm values={values} />
      {invalid ? <p role="alert" className="mt-4">Enter valid filters and a date range with the from date on or before the to date.</p> : null}
      <p role="status" className="mt-4 text-sm text-muted-foreground">{events.length} matching events shown. Up to 100 newest matches.</p>

      <div className="mt-6">
        <AdminTable name="Audit events">
          <caption className="sr-only">Audit events</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 py-2">When</th>
              <th scope="col" className="px-4 py-2">Actor</th>
              <th scope="col" className="px-4 py-2">Action</th>
              <th scope="col" className="px-4 py-2">Subject</th>
              <th scope="col" className="px-4 py-2">Tenant</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={`${e.tenantId ?? "platform"}-${e.sequence}`} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {e.occurredAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {e.actor.kind === "system" ? `system:${e.actor.job}` : `${e.actor.kind}:${e.actor.userId}`}
                </td>
                <td className="px-4 py-2">{e.action}</td>
                <td className="px-4 py-2 text-muted-foreground">{e.subject}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.tenantId ?? "platform"}</td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No matching audit events.
                </td>
              </tr>
            ) : null}
          </tbody>
        </AdminTable>
      </div>
    </main>
  );
}
