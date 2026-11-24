import { AssessmentMount } from "./host-mount";
import type { ModuleHostServices } from "@opentenant/database/module-host";

export function createAssessmentPage(host: ModuleHostServices) {

// Assessment state is browser-local (spec 12.3); the page passes the
// tenant's resolved brand into the module and everything stateful renders
// client-side.
async function AssessmentPage() {
  const tenant = await host.currentTenant();
  // The layout has already fail-closed unknown tenants; this is belt and braces.
  const brand = tenant ? await host.brandForTenant(tenant.tenantId) : null;
  return (
    <AssessmentMount
      tenantId={tenant?.tenantId ?? ""}
      brand={{
        displayName: brand?.displayName ?? "opentenant",
        logoUrl: brand?.logoUrl ?? "/opentenant-logo.svg",
        markUrl: brand?.markUrl ?? "/opentenant-mark.svg",
      }}
      exportSuffix={brand?.exportFilenameSuffix ?? host.serverConfig().NEXT_PUBLIC_ASSESSMENT_EXPORT_SUFFIX}
    />
  );
}

return AssessmentPage;
}
