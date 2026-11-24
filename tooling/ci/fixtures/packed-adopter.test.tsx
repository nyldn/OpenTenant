import * as React from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { seedModuleCatalog } from "@opentenant/platform-core";
import { applyMigrations } from "@opentenant/migrations";
// @ts-expect-error operator entrypoint
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { installedModules } from "../opentenant-modules";
Object.assign(globalThis, { React });
const databaseUrl = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("Packed adopter proof requires db:ephemeral");
const db = new Pool({ connectionString: databaseUrl, max: 1 });
vi.stubEnv("CONTROL_PLANE_DATABASE_URL", databaseUrl);
vi.mock("./control-plane", () => ({ controlPlanePool: () => db }));
vi.mock("./tenant", () => ({ currentTenant: async () => ({ tenantId: "ten_adopter", displayName: "Adopter" }) }));
vi.mock("./session", () => ({ currentSession: async () => ({ userId: "usr_adopter", email: "adopter@example.test", activeTenantId: "ten_adopter", activeRole: "tenant_owner", permissions: [], isPlatformAdmin: false, expiresAt: new Date(Date.now() + 60_000) }) }));
vi.mock("./tenant-settings-store", () => ({ readNavigationOverride: async () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("redirect"); } }));
import NativeModulePage from "../app/[...modulePath]/page";
import { tenantModuleNavigation } from "./module-navigation";
import { currentSession } from "./session";
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<{ children?: unknown }>(value)) return text(value.props.children);
  return "";
}
beforeAll(async () => {
  await applyMigrations(db, await loadControlPlaneMigrations());
  await db.query("begin");
  try { await seedModuleCatalog(installedModules, db); await db.query("commit"); }
  catch (error) { await db.query("rollback"); throw error; }
  await db.query("insert into tenants (tenant_id, slug, display_name, status, data_region) values ('ten_adopter', 'adopter', 'Adopter', 'active', 'eu')");
  await db.query("insert into tenant_modules (tenant_id, module_key, module_version, enabled) select 'ten_adopter', module_key, version, true from module_catalog where module_key = 'hello'");
  await db.query("do $$ begin create role tenant_app nologin; exception when duplicate_object then null; end $$");
}, 60_000);
afterAll(async () => { await db.end(); vi.unstubAllEnvs(); });
it("renders the packed module through the unchanged host and registry navigation", async () => {
  expect(text(await NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) }))).toContain("Welcome to ten_adopter.");
  const session = await currentSession("ten_adopter" as import("@opentenant/auth").TenantId);
  expect((await tenantModuleNavigation("ten_adopter", session)).navigation).toContainEqual(expect.objectContaining({ route: "/hello" }));
});
it("denies the route and hides navigation using the live disabled entitlement", async () => {
  await db.query("update tenant_modules set enabled = false where tenant_id = 'ten_adopter' and module_key = 'hello'");
  await expect(NativeModulePage({ params: Promise.resolve({ modulePath: ["hello"] }) })).rejects.toThrow("not_found");
  const session = await currentSession("ten_adopter" as import("@opentenant/auth").TenantId);
  expect((await tenantModuleNavigation("ten_adopter", session)).navigation).not.toContainEqual(expect.objectContaining({ route: "/hello" }));
});
it("applies the packed migration once and proves restricted-role tenant isolation", async () => {
  const catalog = installedModules.get("hello")!.migrations.tenant;
  expect((await applyMigrations(db, catalog)).applied).toEqual(["tenant-hello/0001_greetings"]);
  const client = await db.connect();
  try {
    await client.query("begin"); await client.query("set local role tenant_app");
    await client.query("select set_config('app.tenant_id', 'ten_adopter', true)");
    await client.query("insert into hello.greetings values ('ten_adopter', 'Hello')");
    expect((await client.query("select * from hello.greetings")).rows).toHaveLength(1);
    await client.query("select set_config('app.tenant_id', 'ten_foreign', true)");
    expect((await client.query("select * from hello.greetings")).rows).toHaveLength(0);
  } finally { await client.query("rollback"); client.release(); }
  expect((await applyMigrations(db, catalog)).skipped).toEqual(["tenant-hello/0001_greetings"]);
});
