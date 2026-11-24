import { describe, expect, it } from "vitest";
import { defineModule, defineModules, type ModuleDefinition } from "./index";
function definition(): ModuleDefinition {
  return { manifest: { key: "example", version: "1.0.0", runtime: "native", navigation: [], permissions: [] },
    routes: [{ path: "/example", requiredPermission: "example.read" }], adminPages: [], settingsPanels: [],
    migrations: { controlPlane: [], tenant: [] },
    permissions: { declared: ["example.read"], roles: { tenant_member: ["example.read"] } },
    catalog: { displayName: "Example", enabledByDefault: false } };
}
describe("module extension contract", () => {
  it("normalizes manifest role maps and freezes registration snapshots", () => {
    const input = definition();
    const module = defineModule(input);
    expect(module.manifest.permissions).toEqual(["example.read"]);
    expect(module.manifest.rolePermissions).toEqual({ tenant_member: ["example.read"] });
    expect(Object.isFrozen(module.routes[0])).toBe(true);
    input.manifest.permissions.push("example.admin");
    expect(module.manifest.permissions).toEqual(["example.read"]);
  });
  it("rejects undeclared route, navigation and role permissions", () => {
    const input = definition();
    expect(() => defineModule({ ...input, routes: [{ path: "/example", requiredPermission: "unknown" }] })).toThrow("Undeclared");
    expect(() => defineModule({ ...input, permissions: { declared: ["example.read"], roles: { tenant_member: ["unknown"] } } })).toThrow("Undeclared");
    expect(() => defineModule({ ...input, manifest: { ...input.manifest, navigation: [{ id: "bad", route: "/bad", defaultLabel: "Bad", configurable: [], requiredPermission: "example.read" }] } })).toThrow("declared native route");
  });
  it("rejects duplicate identities, routes, navigation and migration IDs", () => {
    const input = definition();
    expect(() => defineModules([input, input])).toThrow("Duplicate");
    const other = { ...input, manifest: { ...input.manifest, key: "other" } };
    expect(() => defineModules([input, other])).toThrow("route:/example");
    expect(() => defineModule({ ...input, migrations: { controlPlane: [], tenant: [
      { id: "tenant-example/0002_second", sql: "select 2" }, { id: "tenant-example/0001_first", sql: "select 1" },
    ] } })).toThrow("ordered IDs");
  });
  it("registers API routes and parameterized pages without per-module host branches", () => {
    const input = definition();
    const handle = async () => new Response("example");
    const registry = defineModules([{ ...input,
      routes: [...input.routes, { path: "/example/:id", requiredPermission: "example.read" }],
      apiRoutes: [{ path: "/api/example", handle }],
    }]);
    expect(registry.route("/example/item")?.route.path).toBe("/example/:id");
    expect(registry.route("/example/item/extra")).toBeUndefined();
    expect(registry.apiRoute("/api/example")?.handle).toBe(handle);
    expect(registry.apiRoute("/api/unknown")).toBeUndefined();
    expect(() => defineModules([{ ...input, apiRoutes: [{ path: "/api/example", handle }] }, {
      ...input, manifest: { ...input.manifest, key: "other" }, routes: [],
      apiRoutes: [{ path: "/api/example", handle }],
    }])).toThrow("api:/api/example");
  });
  it("validates module-owned export schemas and configuration names", () => {
    expect(() => defineModule({ ...definition(), tenantSchemas: ["unsafe.schema"] })).toThrow("tenant schema");
    expect(() => defineModule({ ...definition(), environmentKeys: ["unsafe-key"] })).toThrow("environment key");
    const module = defineModule({ ...definition(), tenantSchemas: ["example"], environmentKeys: ["EXAMPLE_KEY"] });
    expect(module.tenantSchemas).toEqual(["example"]);
    expect(Object.isFrozen(module.environmentKeys)).toBe(true);
  });

  it("restricts telemetry contributions to the registered module namespace", () => {
    expect(() => defineModule({ ...definition(), telemetry: { "platform.health.checked": {} } })).toThrow("telemetry name");
    expect(defineModule({ ...definition(), telemetry: { "example.viewed": { count: "number" } } }).telemetry).toEqual({ "example.viewed": { count: "number" } });
  });

});
