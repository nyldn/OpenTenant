import { tenantModuleNavigation } from "../lib/module-navigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { TenantId } from "@opentenant/auth";
import { brandForTenant } from "../lib/brand";
import { currentSession } from "../lib/session";
import { currentTenant } from "../lib/tenant";
import { managedSupportSessionForTenant } from "../lib/managed-support";
import { usesClerkIdentity } from "../lib/identity-provider";
import { ApplicationShell, ApplicationPageHeading } from "./_components/application-shell";
import { ClerkAuthControls } from "./auth-controls";

export const dynamic = "force-dynamic";

/**
 * Branded tenant home. Anonymous visitors get a sign-in-first landing (spec
 * section 7 step 8: navigation renders only for entitled, authorized users);
 * the one exception is a passcode-mode module, whose entry point is its own
 * server-enforced gate.
 */
export default async function Home() {
  const tenant = await currentTenant();
  // Layouts and pages can render concurrently; the page must enforce the
  // unknown-host boundary independently instead of relying on its parent.
  if (!tenant) notFound();
  const [brand, tenantSession] = await Promise.all([
    brandForTenant(tenant.tenantId),
    currentSession(tenant.tenantId as TenantId),
  ]);
  // Support authority stays explicit when the operator has no membership in
  // this tenant. Keep its exit available without adding module permissions.
  const support = tenantSession ? null : await managedSupportSessionForTenant(tenant.tenantId);
  const session = tenantSession ?? (support?.ok ? support.context.operator : null);

  const { navigation, passcodeModules } = await tenantModuleNavigation(tenant.tenantId, tenantSession);

  const clerkIdentity = usesClerkIdentity();

  if (!session) {
    return (
      <div className="flex min-h-svh min-w-0 flex-col bg-background text-foreground [overflow-wrap:anywhere]">
        <main className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <h1><img src={brand.logoUrl} alt="" className="mx-auto h-8 max-w-full" /><span className="sr-only">{brand.displayName}</span></h1>
            ) : (
              <h1 className="font-display text-xl font-bold">{brand.displayName}</h1>
            )}
            <p className="mt-4 text-sm text-muted-foreground">Sign in to your workspace.</p>
            <div className="mt-6 flex justify-center">
              {clerkIdentity ? (
                <ClerkAuthControls />
              ) : (
                <Link
                  href="/auth/login?return=/"
                  className="block w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  Sign in
                </Link>
              )}
            </div>
            {passcodeModules.map((module) => (
              <Link key={module.manifest.key} href={module.manifest.runtime === "remote" ? `/modules/${module.manifest.key}` : module.routes[0]!.path} className="mt-3 block text-xs text-muted-foreground underline-offset-2 hover:underline">
                Have a {module.catalog.displayName} access code? Enter here
              </Link>
            ))}
          </div>
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto flex min-h-12 w-full min-w-0 max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3 text-xs text-muted-foreground">
            <span>{brand.displayName}</span>
            {brand.coBrandingRequired ? <span>powered by opentenant</span> : null}
          </div>
        </footer>
      </div>
    );
  }

  return (
    <ApplicationShell session={session}>
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
        <ApplicationPageHeading>{brand.displayName}</ApplicationPageHeading>
        <p className="mt-1 text-sm text-muted-foreground">Your modules</p>
        <div className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2">
          {navigation.map(item => <Link key={item.id} href={item.route}
            className="min-w-0 break-words rounded-lg border border-border bg-card p-5 text-card-foreground hover:border-ring">
            <div className="font-display text-lg font-semibold">{item.label}</div>
            <p className="mt-1 text-sm text-muted-foreground">Open module.</p>
          </Link>)}
        </div>
      </main>
    </ApplicationShell>
  );
}
