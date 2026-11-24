import { tenantAdminContext } from "../../lib/tenant-admin";

export const dynamic = "force-dynamic";

export default async function SettingsOverview() {
  const gate = await tenantAdminContext("branding.configure");
  if (!gate.ok) return null; // layout already redirected
  const { tenant } = gate.context;

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-2xl font-bold">{tenant.displayName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tenant configuration. Changes here apply within the limits set by platform policy; locked
        values stay locked.
      </p>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card text-card-foreground p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tenant ID</dt>
          <dd className="mt-1 font-mono text-xs">{tenant.tenantId}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card text-card-foreground p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slug</dt>
          <dd className="mt-1 font-mono text-xs">{tenant.slug}</dd>
        </div>
      </dl>
    </div>
  );
}
