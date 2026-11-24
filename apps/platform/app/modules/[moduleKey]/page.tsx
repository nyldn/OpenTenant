import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isValidModuleKey } from "@opentenant/platform-core";
import type { TenantId } from "@opentenant/auth";
import { currentTenant } from "../../../lib/tenant";
import { currentSession } from "../../../lib/session";
import { enabledRemoteModule } from "../../../lib/module-registry";
import { accessCookieName, hasValidAccessGrant, moduleAccessPolicy } from "../../../lib/module-access";
import { ApplicationShell, ApplicationPageHeading } from "../../_components/application-shell";

export const dynamic = "force-dynamic";

/** Trusted host chrome around the opaque, untrusted /m response. The proxy
 * independently rechecks every request, including iframe form submissions.
 */
export default async function RemoteModulePage({ params }: { params: Promise<{ moduleKey: string }> }) {
  const { moduleKey } = await params;
  if (!isValidModuleKey(moduleKey)) notFound();
  const tenant = await currentTenant();
  if (!tenant || !await enabledRemoteModule(tenant.tenantId, moduleKey)) notFound();
  const policy = await moduleAccessPolicy(tenant.tenantId, moduleKey);
  if (policy.mode === "passcode") {
    const grant = (await cookies()).get(accessCookieName(moduleKey))?.value;
    if (!hasValidAccessGrant(grant, tenant.tenantId, moduleKey, policy.passcodeHash)) redirect(`/access/${moduleKey}`);
  } else {
    const session = await currentSession(tenant.tenantId as TenantId);
    if (!session || (session.activeTenantId !== tenant.tenantId && !session.isPlatformAdmin)) {
      redirect(`/auth/login?return=${encodeURIComponent(`/modules/${moduleKey}`)}`);
    }
  }
  return <ApplicationShell><main className="min-w-0 p-4 sm:p-6">
    <ApplicationPageHeading>{moduleKey}</ApplicationPageHeading>
    <iframe title={`${moduleKey} module`} src={`/m/${moduleKey}`} className="mt-4 h-[75svh] w-full rounded-md border border-border"
      sandbox="allow-scripts allow-forms allow-popups allow-downloads" />
  </main></ApplicationShell>;
}
