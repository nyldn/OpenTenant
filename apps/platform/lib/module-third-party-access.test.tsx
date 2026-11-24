import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
Object.assign(globalThis, { React });
const h = vi.hoisted(() => ({ enabled: true, role: "tenant_owner", activeTenant: "ten_example", query: vi.fn() }));
// Install in a copy of the actual composition; no host algorithms are replaced.
vi.mock("../opentenant-modules", async (original) => {
  const base = await original<typeof import("../opentenant-modules")>();
  const { defineModules } = await import("@opentenant/module-sdk");
  const { helloModule } = await import("@example/module-hello");
  return { ...base, installedModules: defineModules([...base.installedModules.modules, helloModule]) };
});
vi.mock("./control-plane", () => ({ controlPlanePool: () => ({ query: h.query }), withControlPlaneTransaction: vi.fn() }));
vi.mock("./tenant", () => ({ currentTenant: async () => ({ tenantId: "ten_example", displayName: "Example" }) }));
vi.mock("./session", () => ({ currentSession: async () => ({ userId: "usr_example", email: "member@example.test",
  activeTenantId: h.activeTenant, activeRole: h.role, permissions: ["hello.configure"], isPlatformAdmin: false,
  expiresAt: new Date(Date.now() + 60_000) }) }));
vi.mock("./tenant-settings-store", () => ({ readNavigationOverride: async () => undefined }));
vi.mock("./tenant-admin", () => ({ tenantAdminContext: async () => ({ ok: true,
  context: { tenant: { tenantId: "ten_example", displayName: "Example" } } }) }));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("redirect"); } }));
import NativeModulePage from "../app/[...modulePath]/page";
import ModulesSettingsPage from "../app/settings/modules/page";
import { tenantModuleNavigation } from "./module-navigation";
import { currentSession } from "./session";
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<{ children?: unknown }>(value)) return text(value.props.children);
  return "";
}
describe("third-party module through host entrypoints", () => {
  beforeEach(() => {
    h.enabled = true; h.role = "tenant_owner"; h.activeTenant = "ten_example";
    h.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("module_access_policies") || sql.includes("select enabled, settings") ? [] : [{
      enabled: h.enabled, enabled_by_default: false, ownership_scope: "platform", authorization_manifest: null,
    }] }));
  });
  it("renders its real native route, navigation and settings contribution after composition-only installation", async () => {
    const page = await NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) });
    expect(text(page)).toContain("Welcome to ten_example.");
    const session = await currentSession("ten_example" as import("@opentenant/auth").TenantId);
    expect((await tenantModuleNavigation("ten_example", session)).navigation).toContainEqual(expect.objectContaining({ route: "/hello" }));
    expect(text(await ModulesSettingsPage())).toContain("Your installed Hello module is ready.");
  });
  it("denies the real route and hides navigation and panels when the tenant entitlement is disabled", async () => {
    h.enabled = false;
    await expect(NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) })).rejects.toThrow("not_found");
    const session = await currentSession("ten_example" as import("@opentenant/auth").TenantId);
    expect((await tenantModuleNavigation("ten_example", session)).navigation).toEqual([]);
    expect(text(await ModulesSettingsPage())).not.toContain("Your installed Hello module is ready.");
  });
  it("rejects a cross-tenant principal and keeps member permissions below the settings ceiling", async () => {
    h.activeTenant = "ten_foreign";
    await expect(NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) })).rejects.toThrow("not_found");
    h.activeTenant = "ten_example"; h.role = "tenant_member";
    expect(text(await NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) }))).toContain("Welcome to ten_example.");
    expect(text(await ModulesSettingsPage())).not.toContain("Your installed Hello module is ready.");
  });
});
