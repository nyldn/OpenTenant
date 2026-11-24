// SPDX-License-Identifier: Apache-2.0
import type { ModuleManifest } from "./index";

export type ModuleRole = "tenant_owner" | "tenant_admin" | "tenant_member";
export interface ModuleMigration { id: string; sql: string }
export interface ModulePageContext {
  tenantId: string;
  userId: string;
  permissions: ReadonlySet<string>;
  /** Host-owned ports, validated by the reviewed module binding. */
  services?: unknown;
  params?: Readonly<Record<string, string>>;
}
/** A framework-independent page. Hosts may also bind their own render result. */
export interface ModulePage { title: string; body: string }
export interface ModuleRoute {
  path: string;
  requiredPermission: string;
  render?: (context: ModulePageContext) => unknown | Promise<unknown>;
}
export interface ModulePanel {
  id: string;
  title: string;
  requiredPermission: string;
  render: (context: ModulePageContext) => unknown | Promise<unknown>;
}
export interface ModuleApiRoute {
  // module-audit-exclude: support is the shared operator/customer-service rate budget.
  rateLimitClass?: "support" | "module-access";
  path: string;
  handle(request: Request, services: unknown): Promise<Response>;
}
export interface ModuleDefinition {
  readonly telemetry?: Readonly<Record<string, Readonly<Record<string, "string" | "number" | "boolean">>>>;
  readonly tenantSchemas?: readonly string[];
  readonly environmentKeys?: readonly string[];
  readonly services?: Readonly<Record<string, unknown>>;
  readonly apiRoutes?: readonly ModuleApiRoute[];
  readonly manifest: ModuleManifest;
  readonly routes: readonly ModuleRoute[];
  readonly adminPages: readonly ModulePanel[];
  readonly settingsPanels: readonly ModulePanel[];
  readonly migrations: {
    readonly controlPlane: readonly ModuleMigration[];
    readonly tenant: readonly ModuleMigration[];
  };
  readonly permissions: {
    readonly declared: readonly string[];
    readonly roles: Readonly<Partial<Record<ModuleRole, readonly string[]>>>;
    /** Explicit permissions available to a verified shared-code principal. */
    readonly passcode?: readonly string[];
  };
  readonly catalog: { readonly displayName: string; readonly enabledByDefault: boolean };
}
export interface ModuleRegistry {
  readonly modules: readonly ModuleDefinition[];
  get(key: string): ModuleDefinition | undefined;
  route(path: string): { module: ModuleDefinition; route: ModuleRoute } | undefined;
  apiRoute(path: string): ModuleApiRoute | undefined;
  readonly navigation: readonly ModuleManifest["navigation"][number][];
  readonly migrations: {
    readonly tenant: readonly (readonly ModuleMigration[])[];
    readonly controlPlane: readonly (readonly ModuleMigration[])[];
  };
}

/** Register reviewed extension contributions. No globals or implicit discovery. */
export function defineModule<T extends ModuleDefinition>(input: T): T;
export function defineModule(input: ModuleDefinition): ModuleDefinition {
  const manifest: ModuleManifest = {
    ...input.manifest,
    navigation: input.manifest.navigation.map((item) => ({ ...item, configurable: [...item.configurable] })),
    permissions: [...input.permissions.declared],
    rolePermissions: Object.fromEntries(Object.entries(input.permissions.roles)
      .map(([role, permissions]) => [role, [...permissions]])),
  };
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(manifest.key)) throw new Error("Invalid module key");
  const declared = new Set(manifest.permissions);
  if (declared.size !== manifest.permissions.length) throw new Error("Duplicate module permission");
  const requirePermission = (permission: string) => {
    if (!declared.has(permission)) throw new Error(`Undeclared module permission: ${permission}`);
  };
  for (const [role, permissions] of Object.entries(input.permissions.roles)) {
    if (!["tenant_owner", "tenant_admin", "tenant_member"].includes(role)) throw new Error("Invalid module role");
    permissions.forEach(requirePermission);
  }
  input.permissions.passcode?.forEach(requirePermission);
  for (const route of input.routes) {
    if (!/^\/(?:[a-z0-9-]+|:[a-z][a-z0-9]*)(?:\/(?:[a-z0-9-]+|:[a-z][a-z0-9]*))*$/u.test(route.path) || route.path.endsWith("/")) throw new Error("Invalid native route");
    requirePermission(route.requiredPermission);
  }
  for (const item of manifest.navigation) {
    requirePermission(item.requiredPermission);
    if (manifest.runtime === "native" && !input.routes.some((route) => route.path === item.route)) {
      throw new Error("Navigation requires a declared native route");
    }
  }
  for (const panel of [...input.adminPages, ...input.settingsPanels]) requirePermission(panel.requiredPermission);
  validateModuleResources(input);
  validateTelemetryContributions(input);
  for (const [scope, migrations] of Object.entries(input.migrations)) {
    const ids = migrations.map((migration) => migration.id);
    if (ids.some((id) => !/^[a-z0-9-]+\/\d{4}_[a-z0-9_]+$/u.test(id))) throw new Error(`Invalid ${scope} migration ID`);
    if (ids.join() !== [...ids].sort().join() || new Set(ids).size !== ids.length) throw new Error("Migrations must have unique ordered IDs");
  }
  // Snapshot and freeze the declarations so a later mutation cannot bypass validation.
  return freeze({ ...input, manifest,
    ...(input.apiRoutes ? { apiRoutes: input.apiRoutes.map(route => ({ ...route })) } : {}),
    routes: input.routes.map((route) => ({ ...route })),
    adminPages: input.adminPages.map((panel) => ({ ...panel })),
    settingsPanels: input.settingsPanels.map((panel) => ({ ...panel })),
    migrations: { controlPlane: input.migrations.controlPlane.map((m) => ({ ...m })), tenant: input.migrations.tenant.map((m) => ({ ...m })) },
    permissions: { declared: [...manifest.permissions], roles: manifest.rolePermissions!, ...(input.permissions.passcode ? { passcode: [...input.permissions.passcode] } : {}) },
    catalog: { ...input.catalog },
  });
}

/** The host calls this once with its installed modules in migration order. */
export function defineModules(definitions: readonly ModuleDefinition[]): ModuleRegistry {
  const modules = Object.freeze(definitions.map(defineModule));
  const byKey = new Map<string, ModuleDefinition>();
  const routes = new Map<string, { module: ModuleDefinition; route: ModuleRoute }>();
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) throw new Error(`Duplicate module contribution: ${id}`);
    ids.add(id);
  };
  for (const module of modules) {
    unique(`key:${module.manifest.key}`);
    byKey.set(module.manifest.key, module);
    for (const route of module.apiRoutes ?? []) {
      if (!/^\/api\/[a-z0-9/-]+$/u.test(route.path)) throw new Error("Invalid module API route");
      unique(`api:${route.path}`);
    }
    for (const route of module.routes) {
      unique(`route:${route.path}`);
      routes.set(route.path, { module, route });
    }
    for (const item of module.manifest.navigation) unique(`navigation:${item.id}`);
    for (const panel of [...module.settingsPanels, ...module.adminPages]) unique(`panel:${module.manifest.key}:${panel.id}`);
    for (const scope of ["tenant", "controlPlane"] as const) {
      for (const migration of module.migrations[scope]) unique(`${scope}:${migration.id}`);
    }
  }
  return Object.freeze({ modules, get: (key: string) => byKey.get(key), route: (path: string) => routes.get(path) ?? [...routes.entries()].find(([pattern]) => {
      const parts = pattern.split("/"), actual = path.split("/");
      return parts.length === actual.length && parts.every((part, i) => part.startsWith(":") || part === actual[i]);
    })?.[1],
    apiRoute: (path: string) => modules.flatMap(module => module.apiRoutes ?? []).find(route => route.path === path),
    navigation: Object.freeze(modules.flatMap((module) => module.manifest.navigation)),
    migrations: Object.freeze({
      tenant: Object.freeze(modules.map((module) => module.migrations.tenant)),
      controlPlane: Object.freeze(modules.map((module) => module.migrations.controlPlane)),
    }),
  });
}

function validateTelemetryContributions(input: ModuleDefinition): void {
  for (const [name, schema] of Object.entries(input.telemetry ?? {})) {
    if (!name.startsWith(`${input.manifest.key}.`) || !/^[a-z][a-z0-9.-]+$/u.test(name)) throw new Error("Invalid module telemetry name");
    for (const [key, type] of Object.entries(schema)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(key) || !["string", "number", "boolean"].includes(type)) throw new Error("Invalid module telemetry property");
    }
  }
}

function validateModuleResources(input: ModuleDefinition): void {
  for (const schema of input.tenantSchemas ?? []) {
    if (!/^[a-z][a-z0-9_]*$/u.test(schema)) throw new Error("Invalid tenant schema");
  }
  for (const name of input.environmentKeys ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) throw new Error("Invalid environment key");
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
