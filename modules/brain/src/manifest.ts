import { createElement } from "react";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import type { BrainCallOptions } from "./service";
import { defineModule, type ModulePageContext, type ModuleManifest } from "@opentenant/module-sdk";

export const BRAIN_API_PATH = "/api/mcp/brain";

export const BRAIN_MANIFEST: ModuleManifest = {
  key: "brain",
  version: "0.1.0",
  runtime: "native",
  navigation: [
    {
      id: "brain.workspace",
      defaultLabel: "Brain",
      route: "/brain",
      configurable: ["label", "group", "order", "visibility"],
      requiredPermission: "brain.use",
    },
  ],
  rolePermissions: {
    tenant_owner: ["brain.use", "brain.promote", "brain.admin"],
    tenant_admin: ["brain.use", "brain.promote", "brain.admin"],
    tenant_member: ["brain.use"],
  },
  permissions: ["brain.use", "brain.promote", "brain.admin"],
};

import migration0 from "../../../tooling/migrations/sql/tenant-brain/0001_init.sql";
import migration1 from "../../../tooling/migrations/sql/tenant-brain/0002_audit_truncate.sql";

/** Optional host-owned browser composition. It must bind a read-only signed
 * context to this tenant/user and confirm the actual search adapter first. */
export interface BrainBrowserHost {
  serverConfig?(): Readonly<Record<string, string | undefined>>;
  brainBrowserAvailability?(context: ModulePageContext): Promise<import("./BrainSurface").BrainBrowserAvailability>;
}

export async function renderBrainRoute(context: ModulePageContext) {
  const { BrainSurface } = await import("./BrainSurface");
  if (!context.permissions.has("brain.use")) return createElement<import("./BrainSurface").BrainSurfaceProps>(BrainSurface, { availability: { state: "denied" }, apiPath: BRAIN_API_PATH });
  const host = context.services as BrainBrowserHost | undefined;
  let availability: import("./BrainSurface").BrainBrowserAvailability = { state: "unavailable" };
  try {
    if (host?.serverConfig?.().MODULE_SIGNING_PUBLIC_KEY) availability = { state: "api-only" };
    availability = await host?.brainBrowserAvailability?.(context) ?? availability;
  } catch {
    availability = { state: "unavailable" };
  }
  return createElement<import("./BrainSurface").BrainSurfaceProps>(BrainSurface, { availability, apiPath: BRAIN_API_PATH });
}

export interface BrainModuleOptions {
  resolveEmbedding?: () => BrainCallOptions["embedding"] | Promise<BrainCallOptions["embedding"]>;
}

export function createBrainModule({ resolveEmbedding }: BrainModuleOptions = {}) {
  return defineModule({
    environmentKeys: ["MODULE_SIGNING_PUBLIC_KEY", "NODE_ENV"],
    tenantSchemas: ["brain"],
    manifest: BRAIN_MANIFEST,
    routes: [{ path: "/brain", requiredPermission: "brain.use", render: renderBrainRoute }],
    apiRoutes: [{
      path: BRAIN_API_PATH,
      handle: async (request, services) => {
        const { handleBrainRequest } = await import("./host-api");
        const embedding = await resolveEmbedding?.();
        return handleBrainRequest(request, services as ModuleHostServices, {
          ...(embedding ? { embedding } : {}),
          signal: request.signal,
        });
      },
    }],
    adminPages: [],
    settingsPanels: [],
    migrations: { controlPlane: [], tenant: [
      { id: "tenant-brain/0001_init", sql: migration0 },
      { id: "tenant-brain/0002_audit_truncate", sql: migration1 },
    ] },
    permissions: { declared: BRAIN_MANIFEST.permissions, roles: BRAIN_MANIFEST.rolePermissions! },
    catalog: { displayName: "Brain", enabledByDefault: false },
  });
}

export const BRAIN_MODULE = createBrainModule();
