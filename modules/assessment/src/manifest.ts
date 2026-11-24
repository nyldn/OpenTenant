import type { ModuleHostServices } from "@opentenant/database/module-host";
/**
 * Assessment module manifest (spec section 11).
 */
import { defineModule, type ModuleManifest } from "@opentenant/module-sdk";

export const ASSESSMENT_MANIFEST: ModuleManifest = {
  key: "assessment",
  version: "1.0.0",
  runtime: "native",
  navigation: [
    {
      id: "assessment.assessment",
      defaultLabel: "AI Maturity Assessment",
      route: "/assessment",
      configurable: ["label", "group", "order", "visibility"],
      requiredPermission: "assessment.use",
    },
  ],
  rolePermissions: {
    tenant_owner: ["assessment.use"],
    tenant_admin: ["assessment.use"],
    tenant_member: ["assessment.use"],
  },
  permissions: ["assessment.use"],
};


export const ASSESSMENT_MODULE = defineModule({
  environmentKeys: ["NEXT_PUBLIC_ASSESSMENT_EXPORT_SUFFIX"],
  telemetry: {
    "assessment.page.viewed": {},
    "assessment.readout.completed": { provider: "string", latencyMs: "number" },
    "assessment.readout.failed": { provider: "string", errorCode: "string", latencyMs: "number" },
    "assessment.export.completed": { format: "string", respondentCount: "number" },
    "assessment.import.completed": { respondentCount: "number" },
    "assessment.import.rejected": { errorCount: "number" },
  },
  manifest: ASSESSMENT_MANIFEST,
  routes: [{ path: "/assessment", requiredPermission: "assessment.use", render: async context => (await import("./host-page")).createAssessmentPage(context.services as ModuleHostServices)() }],
  apiRoutes: [{ path: "/api/assessment-readout", handle: async (request, services) => (await import("./host-api")).createReadoutApi(services as ModuleHostServices)(request) }],
  adminPages: [],
  settingsPanels: [],
  migrations: { controlPlane: [], tenant: [
  ] },
  permissions: { declared: ASSESSMENT_MANIFEST.permissions, roles: ASSESSMENT_MANIFEST.rolePermissions!, passcode: ["assessment.use"], },
  catalog: { displayName: "AI Maturity Assessment", enabledByDefault: true },
});
