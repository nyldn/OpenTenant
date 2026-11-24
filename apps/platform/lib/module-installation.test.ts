import { describe, expect, it, vi } from "vitest";
import { helloModule } from "@example/module-hello";
import { defineModules } from "@opentenant/module-sdk";
import { dispatchNativeModule, moduleNavigation, modulePermissions, seedModuleCatalog } from "@opentenant/platform-core";
import { installedModules } from "../opentenant-modules";

// Equivalent to adding a dependency and the definition in a copy of the composition.
// All host algorithms below are the ones used by the native catch-all and home.
const installed = defineModules([...installedModules.modules, helloModule]);
describe("SDK-only third-party installation", () => {
  it("adds route, navigation, settings, role map and migration without core edits", async () => {
    const permissions = new Set(modulePermissions(helloModule, "tenant_owner"));
    const context = { tenantId: "ten_example", userId: "usr_example", permissions };
    expect(installedModules.get("hello")).toBeUndefined();
    expect(moduleNavigation(installed, new Set(["hello"]), permissions).items).toEqual([
      expect.objectContaining({ id: "hello.home", route: "/hello" }),
    ]);
    expect(await dispatchNativeModule(installed, "/hello", context, async () => true)).toEqual({
      ok: true, value: { title: "Hello", body: "Welcome to ten_example." },
    });
    expect(await installed.get("hello")!.settingsPanels[0]!.render(context)).toEqual({
      title: "Greeting", body: "Your installed Hello module is ready.",
    });
    expect(modulePermissions(helloModule, "tenant_member")).toEqual(["hello.use"]);
    expect(installed.migrations.tenant.flat().at(-1)?.id).toBe("tenant-hello/0001_greetings");
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await seedModuleCatalog(installed, { query });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into module_catalog"),
      ["hello", "0.1.0", "native", false, expect.any(String)]);
  });
  it("denies disabled entitlements and missing permissions before rendering", async () => {
    const context = { tenantId: "ten_example", userId: "usr_example", permissions: new Set(["hello.use"]) };
    expect(moduleNavigation(installed, new Set(), context.permissions).items).toEqual([]);
    expect(await dispatchNativeModule(installed, "/hello", context, async () => false)).toEqual({ ok: false, reason: "forbidden" });
    expect(await dispatchNativeModule(installed, "/hello", { ...context, permissions: new Set() }, async () => true)).toEqual({ ok: false, reason: "forbidden" });
    expect(await dispatchNativeModule(installedModules, "/hello", context, async () => true)).toEqual({ ok: false, reason: "not_found" });
  });
});
