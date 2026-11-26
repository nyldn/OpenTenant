import type { HelpdeskSource } from "@opentenant/support";
import { defineModules } from "@opentenant/module-sdk";
import { ASSESSMENT_MODULE } from "@opentenant/assessment/manifest";
import { createBrainModule } from "@opentenant/brain/manifest";
import { createSupportModule } from "@opentenant/support/manifest";

const brain = createBrainModule({
  resolveEmbedding: async () => (await import("./lib/server-config")).brainEmbeddingConfig(),
});

const support = createSupportModule({
  handleAiRequest: async (request, host) =>
    (await import("./lib/support-ai-composition")).handleSupportAiRequest(request, host),
});

/** The sole installed-module list, in historical tenant migration order. */
export const installedModules = defineModules([ASSESSMENT_MODULE, brain, support]);

// module-audit-exclude: apps/platform/package.json declares the dependencies imported here.
// That metadata installs the composition; it contains no module dispatch or policy.

/** Installation-level helpdesk source is an explicit module service binding. */
export const helpdeskSource: HelpdeskSource = support.services.helpdesk;
