import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Cookie, type Page } from "@playwright/test";
import { Pool } from "pg";
export const root = resolve(import.meta.dirname, "../../..");
export interface UatManifest {
  version: number; fixtureRevision: number; runId: string; identityProvider: string; ports: Record<string, number>; mailpitUrl: string;
  tenants: Array<{ slug: string; tenantId: string; url: string }>;
  personas: Array<{ id: string; role: string | null; tenantId: string | null; signInUrl: string; cookie: { value: string } }>;
}
export async function readManifest(): Promise<UatManifest> {
  const manifest = JSON.parse(await readFile(resolve(root, ".uat/manifest.json"), "utf8"));
  expect(manifest.version).toBe(1); expect(manifest.identityProvider).toBe("better-auth");
  return manifest;
}
export function assessmentKey(tenantId: string) { return `assessment_engagement_v2:${encodeURIComponent(tenantId)}`; }
export function personaId(persona: string) { return ({ "tenant-owner": "alpha-owner", admin: "tenant-admin", member: "tenant-member" } as Record<string,string>)[persona] ?? persona; }
export function personaHost(persona: string) { return ["signed-out", "installation-owner"].includes(persona) ? "workspace" : "alpha"; }
export function fixtureOrigin(manifest: UatManifest, slug: string) { return `http://${slug}.localhost:${manifest.ports.app}`; }
export async function withFixtureControl<T>(work: (db: Pool) => Promise<T>): Promise<T> {
  const { controlUrl } = JSON.parse(await readFile(resolve(root, ".uat/active/fixture.json"), "utf8"));
  const db = new Pool({ connectionString: controlUrl });
  try { return await work(db); } finally { await db.end(); }
}
export async function guardLocalRequests(page: Page, manifest: UatManifest) {
  const hosts = new Set(["127.0.0.1", "localhost", "admin.localhost", "unknown.localhost", ...manifest.tenants.map(t => `${t.slug}.localhost`)]);
  await page.route("**/*", route => hosts.has(new URL(route.request().url()).hostname) ? route.continue() : route.abort("blockedbyclient"));
}
const supportCookies = new Map<string, Cookie[]>();
export async function visitPrivateLink(page: Page, url: string) {
  try { return await page.goto(url, { timeout: 120_000 }); }
  catch { throw new Error("Private fixture navigation failed; inspect the local private log"); }
}
export async function signInPersona(page: Page, manifest: UatManifest, persona: string, host = personaHost(persona)) {
  if (persona === "signed-out") return;
  const account = manifest.personas.find(p => p.id === (persona === "tenant-owner" && host !== "alpha" ? `${host}-owner` : personaId(persona)));
  expect(account, "seeded persona exists").toBeTruthy();
  const url = new URL(account!.signInUrl); url.hostname = `${host}.localhost`;
  await visitPrivateLink(page, url.href);
  await page.waitForURL(u => !u.pathname.startsWith("/__uat/"));
  if (persona === "managed-support") {
    const cacheKey = `${manifest.runId}:${manifest.fixtureRevision}:${host}`;
    const cached = supportCookies.get(cacheKey);
    if (cached) { await page.context().addCookies(cached); return; }
    await page.goto(`${fixtureOrigin(manifest, host)}/admin/support`);
    await page.getByLabel("Reason", { exact: true }).fill("Synthetic accessibility audit");
    await page.getByLabel("Ticket or change reference").fill("B0-AUDIT");
    await page.getByRole("button", { name: "Start 30-minute session" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Managed support for" })).toBeVisible();
    supportCookies.set(cacheKey, (await page.context().cookies()).filter(c => c.name === "opentenant_support"));
  }
}
export async function assertFixtureIdentity(manifest: UatManifest) {
  await withFixtureControl(async db => {
    const rows = (await db.query(`select u.email, m.role, o.tenant_id from ba_member m join ba_user u on u.id=m."userId" join identity_org_mappings o on o.external_organization_id=m."organizationId" order by u.email`)).rows;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "alpha@example.test", role: "owner", tenant_id: "tenant_e2e_alpha" }),
      expect.objectContaining({ email: "tenant-admin@example.test", role: "admin", tenant_id: "tenant_e2e_alpha" }),
      expect.objectContaining({ email: "tenant-member@example.test", role: "member", tenant_id: "tenant_e2e_alpha" }),
    ]));
    expect(rows.some(r => ["managed-support@example.test", "no-memberships@example.test"].includes(r.email))).toBe(false);
    expect((await db.query("select is_platform_admin from platform_users where email='admin@example.test'")).rows[0].is_platform_admin).toBe(true);
    expect(manifest.personas.find(p => p.id === "managed-support")?.tenantId).toBeNull();
  });
}
export async function mailMessages(manifest: UatManifest) {
  const response = await fetch(`${manifest.mailpitUrl}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
  expect(response.ok).toBe(true);
  return (await response.json()) as { total: number; messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
}
export async function mailMessage(manifest: UatManifest, id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid Mailpit message id");
  const response = await fetch(`${manifest.mailpitUrl}/api/v1/message/${id}`, { signal: AbortSignal.timeout(5000) });
  expect(response.ok).toBe(true); return response.json();
}
// Existing shared runner fixtures remain available to ordinary page specs.
// Rich UAT helpers above require a standalone stack, never a second app server.
export { test as platformTest, tenantTest, tenantOrigin, signIn } from "../specs/fixtures";
