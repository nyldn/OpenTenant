import { hostBoundRequest } from "../../../../../lib/better-auth-route";
import { installedModules } from "../../../../../opentenant-modules";
import { accessCookieName } from "../../../../../lib/module-access";
import { identityMailHooks } from "../../../../../lib/identity";
import { betterAuthConfigFromEnv, handleBetterAuthRequest } from "@opentenant/auth-better-auth";
import type { TenantId } from "@opentenant/auth";
import { controlPlanePool } from "../../../../../lib/control-plane";
import { identityProviderFromEnv, tenantOrgResolver } from "../../../../../lib/identity";
import { serverConfig } from "../../../../../lib/server-config";
import { currentTenant } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  if (identityProviderFromEnv() !== "better-auth") return new Response(null, { status: 404 });
  const tenant = await currentTenant();
  return handleBetterAuthRequest(tenant ? hostBoundRequest(request) : request, {
    moduleAccessCookieNames: installedModules.modules.map(definition => accessCookieName(definition.manifest.key)),
    hooks: identityMailHooks(), pool: controlPlanePool(), config: betterAuthConfigFromEnv(serverConfig()),
    orgs: tenantOrgResolver(), tenantId: tenant?.tenantId as TenantId | undefined ?? null,
  });
}
export const POST = GET;
