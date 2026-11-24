import { AdminMutationForm } from "./_components/admin-mutation-form";
import { AdminAccessDenied } from "./_components/admin-access-denied";
import { tenantPublicOrigin } from "../../lib/server-config";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authorizeInstallationAction } from "@opentenant/auth";
import { adminTenantOverview, type AdminTenantRow } from "../../lib/admin-data";
import { currentSession } from "../../lib/session";

export const dynamic = "force-dynamic";

function supportEntryHost(tenant: AdminTenantRow): string | null {
  return tenant.domains.find((domain) => domain.active && domain.verification === "verified")?.host ?? null;
}

/**
 * Platform administration overview (spec sections 4.1, 8.2). Server-side
 * authorization on every render: platform_admin is never implied by tenant
 * membership. First release is read-focused; the tenant detail rows expose
 * the facts an operator needs to support a tenant.
 */
export default async function AdminPage() {
  const session = await currentSession();
  if (!session) redirect("/auth/login?return=/admin");
  if (!authorizeInstallationAction(session, "owner.tenant.read").allowed) return <AdminAccessDenied />;

  const tenants = await adminTenantOverview();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold">Tenants</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {tenants.length} tenants · support access remains explicit, short-lived, and audited
      </p>

      <div className="mt-6 space-y-4">
        {tenants.map((t) => (
          <section key={t.tenantId} className="min-w-0 rounded-lg border border-border bg-card p-5 text-card-foreground [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">{t.displayName}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {t.tenantId} · {t.status} · {t.dataRegion.toUpperCase()}
              </span>
            </div>

            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Domains</div>
                <ul className="mt-1 space-y-1">
                  {t.domains.length === 0 ? <li className="text-muted-foreground">none</li> : null}
                  {t.domains.map((d) => (
                    <li key={d.host} className="font-mono text-xs">
                      {d.host}{" "}
                      <span className={d.active ? "text-success-text" : "text-warning-text"}>
                        {d.active ? "active" : d.verification}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modules</div>
                <ul className="mt-1 space-y-1">
                  {t.modules.map((m) => (
                    <li key={m.moduleKey} className="font-mono text-xs">
                      {m.moduleKey} · {m.enabled ? "enabled" : "disabled"} ·{" "}
                      <span className="text-muted-foreground">access: {m.accessMode ?? "identity (default)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand</div>
                <div className="mt-1 font-mono text-xs">{t.brandKey ?? "platform default"}</div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Managed support
                </div>
                <p className="mt-1 text-sm">
                  {t.managedSupportEnabled ? "Enabled for routine configuration" : "Disabled"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/tenants/${t.tenantId}/brand-proposals`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Brand proposals
                </Link>
                <AdminMutationForm action="/api/admin/support-policy" submitLabel={t.managedSupportEnabled ? "Disable support" : "Enable support"}>
                  <input type="hidden" name="tenantId" value={t.tenantId} />
                  <input type="hidden" name="enabled" value={t.managedSupportEnabled ? "false" : "true"} />
                </AdminMutationForm>
                {t.managedSupportEnabled && supportEntryHost(t) ? (
                  <a
                    href={`${tenantPublicOrigin(supportEntryHost(t)!)}/admin/support`}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    Open tenant support ↗
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
