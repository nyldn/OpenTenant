import type { HelpdeskSource } from "@opentenant/support";
/** The sole installed-module list, in historical tenant migration order. */
import { defineModules } from "@opentenant/module-sdk";
import { ASSESSMENT_MODULE } from "@opentenant/assessment/manifest";
import { BRAIN_MODULE } from "@opentenant/brain/manifest";
import { SUPPORT_MODULE } from "@opentenant/support/manifest";
const brain = { ...BRAIN_MODULE, apiRoutes: BRAIN_MODULE.apiRoutes.map(route => ({ ...route,
  handle: async (request: Request, services: unknown) => {
    const { handleBrainRequest } = await import("@opentenant/brain");
    const { brainEmbeddingConfig } = await import("./lib/server-config");
    const embedding = brainEmbeddingConfig();
    return handleBrainRequest(request, services as import("@opentenant/database/module-host").ModuleHostServices,
      { ...(embedding ? { embedding } : {}), signal: request.signal });
  },
})) };
const support = { ...SUPPORT_MODULE, apiRoutes: SUPPORT_MODULE.apiRoutes.map(route =>
  route.path.startsWith("/api/support/ai/suggestions") ? { ...route,
    handle: async (request: Request, services: unknown) => (await import("./lib/support-ai-composition")).handleSupportAiRequest(request, services as import("@opentenant/database/module-host").ModuleHostServices),
  } : route) };
export const installedModules = defineModules([ASSESSMENT_MODULE, brain, support]);

// module-audit-exclude: apps/platform/package.json declares the dependencies imported here.
// That metadata installs the composition; it contains no module dispatch or policy.

/** Installation-level helpdesk source is an explicit module service binding. */
export const helpdeskSource: HelpdeskSource = SUPPORT_MODULE.services.helpdesk;
