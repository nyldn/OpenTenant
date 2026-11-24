import { EmptyState } from "@opentenant/design-system";
import { ApplicationShell, SignOutAction } from "../_components/application-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "../../lib/session";
import { tenantLauncher } from "../../lib/tenant-launcher";

export const dynamic = "force-dynamic";

const roleLabels = {
  tenant_owner: "Tenant owner",
  tenant_admin: "Tenant admin",
  tenant_member: "Tenant member",
} as const;

export default async function TenantsPage() {
  const session = await currentSession();
  if (!session) redirect("/auth/login?return=/tenants");

  const tenants = await tenantLauncher(session);

  return (
    <ApplicationShell session={session}><main className="mx-auto min-h-svh w-full max-w-4xl px-6 py-12">
      {tenants.length ? <h1 className="font-display text-3xl font-bold">Your tenants</h1> : null}
      <p className="mt-2 text-sm text-muted-foreground">
        Open a tenant through its verified OpenTenant address.
      </p>

      {tenants.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-card text-card-foreground">
          <EmptyState state="empty" heading="Your tenants" description="You have no tenant memberships available. Ask your organisation's administrator for access and an invitation. Open the invitation link from your email using this account."
            action={{ label: "Home", href: "/" }} />
          <div className="flex justify-center pb-6"><SignOutAction /></div>
        </div>
      ) : (
        <ul className="mt-8 space-y-4" aria-label="Accessible tenants">
          {tenants.map((tenant) => (
            <li key={tenant.tenantId} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold">{tenant.displayName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{roleLabels[tenant.role]}</p>
                </div>
                {tenant.availability === "available" ? (
                  <Link
                    href={tenant.launchUrl}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    Open tenant
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main></ApplicationShell>
  );
}
