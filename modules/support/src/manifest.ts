import { SUPPORT_AI_PERMISSIONS } from "./support-ai-review-types";
import { helpdeskSource } from "./services";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { defineModule, type ModuleManifest } from "@opentenant/module-sdk";
import { SUPPORT_PERMISSIONS } from "./types";

export const SUPPORT_MANIFEST: ModuleManifest = {
  key: "support",
  version: "0.1.0",
  runtime: "native",
  navigation: [
    {
      id: "support.tickets",
      defaultLabel: "Support",
      headerLabel: "Get help",
      route: "/support",
      configurable: ["label", "group", "order", "visibility"],
      requiredPermission: "support.use",
    },
  ],
  // Approved fine-grained vocabulary plus the deprecated coarse aliases,
  // which expand through expandSupportPermissions until grants migrate.
  rolePermissions: {
    tenant_owner: [...SUPPORT_PERMISSIONS, ...Object.values(SUPPORT_AI_PERMISSIONS), "support.use", "support.admin"],
    tenant_admin: [...SUPPORT_PERMISSIONS, ...Object.values(SUPPORT_AI_PERMISSIONS), "support.use", "support.admin"],
    tenant_member: ["support.use"],
  },
  permissions: [...SUPPORT_PERMISSIONS, ...Object.values(SUPPORT_AI_PERMISSIONS), "support.use", "support.admin"],
};

import migration0 from "../../../tooling/migrations/sql/tenant-support/0001_init.sql";
import migration1 from "../../../tooling/migrations/sql/tenant-support/0002_ticket_summary_index.sql";
import migration2 from "../../../tooling/migrations/sql/tenant-support/0003_ticket_version_outbox.sql";
import migration3 from "../../../tooling/migrations/sql/tenant-support/0004_support_depth.sql";
import migration4 from "../../../tooling/migrations/sql/tenant-support/0005_slack_app_contracts.sql";
import migration5 from "../../../tooling/migrations/sql/tenant-support/0006_audit_truncate.sql";
import migration7 from "../../../tooling/migrations/sql/tenant-support/0009_support_ai_review.sql";
import migration8 from "../../../tooling/migrations/sql/tenant-support/0010_support_ai_review_guards.sql";
import migration6 from "../../../tooling/migrations/sql/tenant-support/0007_durable_email.sql";

export const SUPPORT_MODULE = defineModule({
  tenantSchemas: ["support"],
  services: { helpdesk: helpdeskSource },
  manifest: SUPPORT_MANIFEST,
  routes: [{ path: "/support", requiredPermission: "support.use", render: async context => (await import("./host-page")).createSupportPage(context.services as ModuleHostServices)() }, { path: "/support/:id", requiredPermission: "support.use", render: async context => (await import("./host-ticket")).createTicketPage(context.services as ModuleHostServices)({ params: Promise.resolve({ id: context.params!.id! }) }) }],
  apiRoutes: [
    { path: "/api/support/tickets", rateLimitClass: "support", handle: async (request, services) => (await import("./host-api")).createSupportApi(services as ModuleHostServices)(request) },
    // Each handler requires the explicit staff permission plus read_tenant and reply.
    { path: "/api/support/ai/suggestions", rateLimitClass: "support", handle: async (request, services) => (await import("./support-ai-api")).createSupportAiApi(services as ModuleHostServices)(request) },
    { path: "/api/support/ai/suggestions/reviews", rateLimitClass: "support", handle: async (request, services) => (await import("./support-ai-api")).createSupportAiApi(services as ModuleHostServices)(request) },
  ],
  adminPages: [],
  settingsPanels: [],
  migrations: { controlPlane: [], tenant: [
    { id: "tenant-support/0001_init", sql: migration0 },
    { id: "tenant-support/0002_ticket_summary_index", sql: migration1 },
    { id: "tenant-support/0003_ticket_version_outbox", sql: migration2 },
    { id: "tenant-support/0004_support_depth", sql: migration3 },
    { id: "tenant-support/0005_slack_app_contracts", sql: migration4 },
    { id: "tenant-support/0006_audit_truncate", sql: migration5 },
    { id: "tenant-support/0007_durable_email", sql: migration6 },
    { id: "tenant-support/0009_support_ai_review", sql: migration7 },
    { id: "tenant-support/0010_support_ai_review_guards", sql: migration8 },
  ] },
  permissions: { declared: SUPPORT_MANIFEST.permissions, roles: SUPPORT_MANIFEST.rolePermissions!, },
  catalog: { displayName: "Support", enabledByDefault: true },
});
