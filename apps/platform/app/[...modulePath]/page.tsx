import { ApplicationModuleContent } from "../_components/application-shell-navigation";
import { ApplicationShell } from "../_components/application-shell";
import { moduleServicesFor } from "../../lib/module-services";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { dispatchNativeModule } from "@opentenant/platform-core";
import { installedModules } from "../../opentenant-modules";
import { accessCookieName, resolvePermissions } from "../../lib/module-access";
import { resolveModuleAccess } from "../../lib/module-access-gate";
import { nativeModuleEnabled } from "../../lib/module-registry";
import { renderModuleView } from "../../lib/module-view";
export const dynamic = "force-dynamic";
export default async function NativeModulePage({ params }: { params: Promise<{ modulePath: string[] }> }) {
  const path = `/${(await params).modulePath.join("/")}`;
  const match = installedModules.route(path);
  if (!match) notFound();
  const key = match.module.manifest.key;
  const access = await resolveModuleAccess(key, (await cookies()).get(accessCookieName(key))?.value);
  if (!access.ok) {
    if (access.reason === "anonymous") redirect(`/auth/login?return=${encodeURIComponent(path)}`);
    if (access.reason === "passcode_required") redirect(`/access/${key}`);
    notFound();
  }
  const permissions = access.mode === "identity"
    ? await resolvePermissions(access.principal.session, access.tenantId, key)
    : [...(match.module.permissions.passcode ?? [])];
  const result = await dispatchNativeModule(installedModules, path, {
    services: moduleServicesFor(key), tenantId: access.tenantId, userId: access.principal.principalId, permissions: new Set(permissions),
  }, (moduleKey) => nativeModuleEnabled(access.tenantId, moduleKey));
  if (!result.ok) notFound();
  return <ApplicationShell><ApplicationModuleContent title={match.module.catalog.displayName}>{renderModuleView(result.value)}</ApplicationModuleContent></ApplicationShell>;
}
