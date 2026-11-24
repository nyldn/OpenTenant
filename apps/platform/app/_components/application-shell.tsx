import Link from "next/link";
import type { ReactNode } from "react";
import type { IdentitySession, TenantId } from "@opentenant/auth";
import { brandForTenant } from "../../lib/brand";
import { currentTenant } from "../../lib/tenant";
import { currentSession } from "../../lib/session";
import { tenantModuleNavigation } from "../../lib/module-navigation";
import { managedSupportSessionForTenant } from "../../lib/managed-support";
import { usesClerkIdentity } from "../../lib/identity-provider";
import { ClerkAuthControls } from "../auth-controls";
import { ApplicationShellFrame, type ShellNavigationItem } from "./application-shell-navigation";

export const SETTINGS_NAVIGATION: ShellNavigationItem[] = [
  ["", "Overview"], ["/members", "Members"], ["/identity", "Identity"], ["/domains", "Domains"],
  ["/connections", "Connections"], ["/branding", "Branding"], ["/modules", "Modules"],
  ["/navigation", "Navigation"], ["/activity", "Activity"],
].map(([suffix, label]) => ({ href: `/settings${suffix}`, label: label! }));

export function SignOutAction() {
  return usesClerkIdentity() ? <ClerkAuthControls /> : <form method="post" action="/auth/logout" className="shrink-0">
    <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">Sign out</button>
  </form>;
}

/** Host-only composition. Pages retain their own single h1 and main landmark.
 * Wave 3 pages supply only their body. Do not use inside /m proxy content.
 */
export async function ApplicationShell({ children, section, session: suppliedSession, adminOnly = false }: {
  children: ReactNode; section?: "admin" | "settings"; session?: IdentitySession | null; adminOnly?: boolean;
}) {
  const tenant = await currentTenant();
  if (!tenant) return children;
  const [brand, session] = await Promise.all([
    brandForTenant(tenant.tenantId),
    suppliedSession === undefined ? currentSession(tenant.tenantId as TenantId) : suppliedSession,
  ]);
  const tenantSession = session?.activeTenantId === tenant.tenantId ? session : null;
  const { navigation, headerNavigation } = await tenantModuleNavigation(tenant.tenantId, tenantSession);
  const support = session ? await managedSupportSessionForTenant(tenant.tenantId) : null;
  const tenantAdmin = tenantSession && ["tenant_owner", "tenant_admin"].includes(tenantSession.activeRole ?? "");
  const items: ShellNavigationItem[] = [
    { href: "/", label: "Home" }, { href: "/tenants", label: "Your tenants" },
    ...navigation.map(item => ({ href: item.route, label: item.label })),
    ...(tenantAdmin || support?.ok ? [{ href: "/settings", label: "Settings" }] : []),
    ...(section === "settings" ? SETTINGS_NAVIGATION.filter(item => item.href !== "/settings") : []),
    ...(session?.isPlatformAdmin ? [
      { href: "/admin", label: "Platform admin" }, { href: "/admin/tenants/new", label: "Create tenant" },
      { href: "/admin/audit", label: "Audit log" }, { href: "/admin/helpdesk", label: "Helpdesk" },
    ] : []),
  ];
  return <ApplicationShellFrame items={items} adminOnly={adminOnly} legacyAdmin={section === "admin"}
    header={<>
      <Link href="/" className="min-w-0 flex-1 break-words font-bold">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={brand.displayName} className="h-6 max-w-full object-contain object-left" />
        ) : brand.displayName}
      </Link>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm">Home</Link>
      {headerNavigation.map(item => <Link key={item.id} href={item.route}
        className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-accent">{item.label}</Link>)}
      {session ? <div className="flex w-full min-w-0 flex-wrap items-center gap-3 text-sm sm:w-auto">
        <span className="min-w-0 break-all text-muted-foreground">{session.email}</span><SignOutAction />
      </div> : <Link href="/auth/login?return=/" className="inline-flex min-h-11 items-center underline">Sign in</Link>}
    </>}
    banner={support?.ok ? <div role="status" className="border-b border-warning-text bg-warning p-4 text-warning-text">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="min-w-0 flex-1 break-words">Managed support for <strong>{tenant.displayName}</strong> · Operator {support.context.operator.email} · Reason: {support.context.reason} · Started <time dateTime={support.context.createdAt.toISOString()}>{support.context.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time> · Expires <time dateTime={support.context.expiresAt.toISOString()}>{support.context.expiresAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time></p>
        <form action="/api/admin/support-sessions/exit" method="post"><button className="min-h-11 rounded-md border border-current px-3" type="submit">Exit support</button></form>
      </div>
    </div> : null}
    footer={<footer className="mt-6 flex flex-wrap justify-between gap-3 border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>{brand.displayName}</span>{brand.coBrandingRequired ? <span>powered by opentenant</span> : null}
      </footer>}>{children}</ApplicationShellFrame>;
}

export function ApplicationPageHeading({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-2xl font-bold">{children}</h1>;
}
