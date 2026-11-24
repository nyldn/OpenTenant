import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import type { UatManifest } from "../audit/fixtures";
import { assessmentKey, fixtureOrigin, guardLocalRequests, mailMessage, mailMessages, readManifest, root, signInPersona, visitPrivateLink, withFixtureControl } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
const exec = promisify(execFile);
const reset = () => exec(process.execPath, ["tooling/uat/reset.mjs"], { cwd: root, timeout: 180_000 });
const control = async (...args: string[]) => JSON.parse((await exec(process.execPath, ["tooling/uat/control.mjs", ...args], { cwd: root, timeout: 65_000 })).stdout);

async function proveProvisioningRetry(page: Page, manifest: UatManifest) {
  expect((await control("status")).provision.armed).toBe(false);
  const armed = await control("fail-next-provision");
  expect(armed).toMatchObject({ armed: true, slug: "uat-provision-retry" });
  await signInPersona(page, manifest, "installation-owner", "admin");
  await page.goto(`${fixtureOrigin(manifest, "admin")}/admin/tenants/new`);
  await page.getByLabel("Owner email").fill("retry@example.test");
  await page.getByLabel("Display name").fill("Example UAT Retry");
  await page.getByLabel("Slug").fill(armed.slug);
  await page.getByLabel("Data region").selectOption("eu");
  await page.getByRole("button", { name: "Create tenant", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry job", exact: true });
  await expect(retry).toBeVisible({ timeout: 180_000 });
  expect((await control("status")).provision).toMatchObject({ armed: true, jobStatus: "failed", attempts: 5 });
  expect(await control("clear")).toMatchObject({ cleared: true, slug: armed.slug });
  await retry.click();
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect((await control("status")).provision).toMatchObject({ armed: false, jobStatus: "completed" });
  await withFixtureControl(async db => {
    expect((await db.query("select count(*)::int as count from audit_events a join tenants t on t.tenant_id=a.tenant_id where t.slug=$1 and a.action='tenant.job_retried'", [armed.slug])).rows[0].count).toBe(1);
  });
  console.info("UAT provisioning control proved: failed after 5 attempts; product retry active/completed; one retry audit.");
}

async function proveExportExpiry(page: Page, manifest: UatManifest) {
  const downloads: Record<string, string> = {};
  for (const slug of ["alpha", "beta"]) {
    const tenantId = manifest.tenants.find(tenant => tenant.slug === slug)!.tenantId;
    await page.goto(`${fixtureOrigin(manifest, "admin")}/admin/tenants/${tenantId}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const link = page.getByRole("link", { name: "Download export, available for 24 hours", exact: true });
    await expect(link).toBeVisible({ timeout: 60_000 });
    downloads[slug] = new URL((await link.getAttribute("href"))!, fixtureOrigin(manifest, "admin")).href;
    expect((await page.request.get(downloads[slug]!)).status()).toBe(200);
  }
  const expiryState = () => withFixtureControl(async db => (await db.query("select t.slug,a.id,a.expires_at,j.status from tenant_export_archives a join tenants t on t.tenant_id=a.tenant_id join tenant_worker_jobs j on j.id=a.id order by t.slug")).rows);
  const before = await expiryState();
  expect(await control("expire-exports", "alpha")).toMatchObject({ slug: "alpha", expiredExports: 1 });
  const after = await expiryState();
  expect(after.find(row => row.slug === "beta")).toEqual(before.find(row => row.slug === "beta"));
  expect(after.find(row => row.slug === "alpha")).toMatchObject({ status: "completed" });
  expect(new Date(after.find(row => row.slug === "alpha")!.expires_at).getTime()).toBeLessThan(Date.now());
  expect((await page.request.get(downloads.alpha!)).status()).toBe(404);
  expect((await page.request.get(downloads.beta!)).status()).toBe(200);
  console.info("UAT export control proved: Alpha download 200 then 404; Beta remains 200 with unchanged expiry.");
}

test("UAT reset restores fixtures before shutdown and fresh start is clean", async ({ page }) => {
  test.setTimeout(600_000);
  let stack = await startTestStack(`${root}/.uat/reset-proof.log`);
  const old = await readManifest();
  const seededMailCount = (await mailMessages(old)).total;
  const assetSnapshot = () => withFixtureControl(async db => (await db.query("select asset_id,tenant_id,display_name,mime_type,encode(content,'hex') as content from tenant_branding_assets order by asset_id")).rows);
  const initialAssets = await assetSnapshot();
  expect(initialAssets).toHaveLength(2);
  try {
    await guardLocalRequests(page, old);
    await proveProvisioningRetry(page, old);
    await proveExportExpiry(page, old);
    await signInPersona(page, old, "tenant-owner");
    const key = assessmentKey("tenant_e2e_alpha");
    const initial = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
    expect(initial.engagementId).toBe("eng_uat_alpha"); expect(initial.respondents).toHaveLength(0);
    await page.evaluate(k => { const doc = JSON.parse(localStorage.getItem(k)!); doc.engagementId="eng_mutated"; localStorage.setItem(k,JSON.stringify(doc)); }, key);
    await page.goto(`${fixtureOrigin(old, "alpha")}/settings/members`);
    await page.getByLabel("Email", { exact: true }).fill("reset-invitee@example.test");
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("tenant_member");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect.poll(async () => (await mailMessages(old)).messages.some(m => m.To.some(to => to.Address === "reset-invitee@example.test"))).toBe(true);
    const delivered = (await mailMessages(old)).messages.find(m => m.To.some(to => to.Address === "reset-invitee@example.test"))!;
    const body = await mailMessage(old, delivered.ID);
    const deliveredUrl = (body.Text as string).match(/https?:\/\/[^\s<>]+\/api\/auth\/better-auth\/login\?[^\s<>]+/)?.[0];
    expect(deliveredUrl).toBeTruthy();
    const inviteeContext = await page.context().browser()!.newContext();
    try {
      const invitee = await inviteeContext.newPage(); await guardLocalRequests(invitee, old);
      await visitPrivateLink(invitee, deliveredUrl!); await invitee.getByText("Create an account", { exact: true }).click();
      const form = invitee.locator("details form");
      await form.getByLabel("Name", { exact: true }).fill("Example Reset Invitee");
      await form.getByLabel("Email", { exact: true }).fill("reset-invitee@example.test");
      await form.getByLabel("Password", { exact: true }).fill(randomBytes(24).toString("base64url"));
      await form.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    } finally { await inviteeContext.close(); }
    await signInPersona(page, old, "managed-support");
    // Real database state in each requested reset family, plus new run-owned data.
    await withFixtureControl(async db => {
      await db.query("insert into module_access_policies(tenant_id,module_key,mode,passcode_hash) values('tenant_e2e_alpha','assessment','passcode','synthetic-reset-hash') on conflict(tenant_id,module_key) do update set mode='passcode',passcode_hash='synthetic-reset-hash'");
      await db.query(`update brand_policies set overrides='{"displayName":"Changed by reset proof"}' where tenant_id='tenant_e2e_alpha'`);
      await db.query(`update tenant_modules set settings='{"displayLabel":"Changed module"}' where tenant_id='tenant_e2e_alpha' and module_key='assessment'`);
      await db.query("insert into navigation_overrides(tenant_id,item_id,label,visible) values('tenant_e2e_alpha','reset-proof','Changed navigation',false)");
      await db.query("update ba_invitation set status='canceled' where email='pending@example.test'");
      await db.query("update tenants set managed_support_enabled=false where tenant_id='tenant_e2e_alpha'");
      await db.query("update tenant_branding_assets set content=$1,display_name='Changed private asset' where asset_id='asset_uat_alpha'", [Buffer.from("changed")]);
      await db.query("delete from tenant_branding_assets where asset_id='asset_uat_beta'");
      await db.query("create database opentenant_reset_extra");
      await db.query("create role opentenant_reset_extra_app");
      await db.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values('tenant_reset_extra','reset-extra','Example Reset Extra','provisioning','eu')");
      await db.query("insert into domains(host,tenant_id,kind,verification,active) values('reset-extra.localhost','tenant_reset_extra','opentenant_subdomain','verified',true)");
    });
    // Verify access mode is active in the browser, rather than just checking SQL.
    const signedOut = await page.context().browser()!.newContext();
    try {
      const gate = await signedOut.newPage(); await guardLocalRequests(gate, old);
      await gate.goto(`${fixtureOrigin(old, "alpha")}/assessment`);
      await expect(gate.getByLabel("Access code")).toBeVisible();
    } finally { await signedOut.close(); }
    const receipt = JSON.parse((await reset()).stdout.split("\n")[0]!);
    expect(receipt).toMatchObject({ reset: "seed", verified: true, revision: 1 });
    expect((await control("status")).provision).toEqual({ armed: false });
    expect(await assetSnapshot()).toEqual(initialAssets);
    const restoredMail = await mailMessages(old);
    expect(restoredMail.total).toBe(seededMailCount);
    expect(restoredMail.messages.some(m => m.To.some(to => to.Address === "pending@example.test"))).toBe(true);
    expect(restoredMail.messages.some(m => m.To.some(to => to.Address === "reset-invitee@example.test"))).toBe(false);
    await page.context().clearCookies();
    await signInPersona(page, old, "tenant-owner");
    const assetResponse = await page.request.get(`${fixtureOrigin(old, "alpha")}/api/settings/branding/assets/asset_uat_alpha`);
    expect(assetResponse.status()).toBe(200);
    expect((await assetResponse.body()).toString("hex")).toBe(initialAssets[0].content);
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key)).toEqual(initial);
    await withFixtureControl(async db => {
      expect((await db.query("select count(*)::int as count from pg_database where datname='opentenant_reset_extra'")).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::int as count from pg_roles where rolname='opentenant_reset_extra_app'")).rows[0].count).toBe(0);
      expect((await db.query("select overrides from brand_policies where tenant_id='tenant_e2e_alpha'")).rows[0].overrides).toEqual({});
      expect((await db.query("select settings from tenant_modules where tenant_id='tenant_e2e_alpha' and module_key='assessment'")).rows[0].settings).toEqual({});
      expect((await db.query("select count(*)::int as count from navigation_overrides where item_id='reset-proof'")).rows[0].count).toBe(0);
      expect((await db.query("select mode from module_access_policies where tenant_id='tenant_e2e_alpha' and module_key='assessment'")).rows).toEqual([]);
      expect((await db.query("select count(*)::int as count from ba_user where email='reset-invitee@example.test'")).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::int as count from tenants")).rows[0].count).toBe(7);
      expect((await db.query("select count(*)::int as count from tenant_export_archives")).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::int as count from pg_database where datname like 'opentenant_uat_provision_retry_%'")).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::int as count from domains where host='reset-extra.localhost'")).rows[0].count).toBe(0);
      expect((await db.query("select status from ba_invitation where email='pending@example.test'")).rows[0].status).toBe("pending");
      expect((await db.query("select count(*)::int as count from managed_support_sessions")).rows[0].count).toBe(0);
    });
    const identityContext = await page.context().browser()!.newContext();
    try {
      const identityPage = await identityContext.newPage(); await guardLocalRequests(identityPage, old);
      await identityPage.goto(`${fixtureOrigin(old, "alpha")}/assessment`);
      await expect(identityPage).toHaveURL(/\/auth\/better-auth\/login(\?|$)/);
      await expect(identityPage.getByLabel("Access code")).toHaveCount(0);
    } finally { await identityContext.close(); }
    await signInPersona(page, old, "fresh-owner", "fresh");
    expect(await page.evaluate(k => localStorage.getItem(k), assessmentKey("tenant_uat_fresh"))).toBeNull();
    await stack.dispose();
    stack = await startTestStack(`${root}/.uat/reset-restart-proof.log`);
    const fresh = await readManifest(); expect(fresh.runId).not.toBe(old.runId);
    expect(await assetSnapshot()).toEqual(initialAssets);
    const stale = new URL(old.personas[0]!.signInUrl); stale.port = String(fresh.ports.app);
    expect((await visitPrivateLink(page, stale.href))?.status()).toBe(404);
    await signInPersona(page, fresh, "no-memberships"); await expect(page).toHaveURL(/\/tenants/);
    await expect(page.getByText("You have no tenant memberships available.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Accessible tenants" })).toHaveCount(0);
    // Read the delivered identity invitation from Mailpit. Use its real login
    // link, without accepting or granting pending ownership in this foundation.
    const messages = await mailMessages(fresh); expect(messages.total).toBeGreaterThan(0);
    const invitation = messages.messages.find(m => m.To.some(to => to.Address === "pending@example.test"));
    expect(invitation).toBeTruthy(); const mail = await mailMessage(fresh, invitation!.ID);
    const match = (mail.Text as string).match(/https?:\/\/[^\s<>]+\/api\/auth\/better-auth\/login\?[^\s<>]+/);
    expect(match).toBeTruthy();
    const link = new URL(match![0]); link.hostname = "pending.localhost"; link.port = String(fresh.ports.app);
    await visitPrivateLink(page, link.href); await expect(page.getByLabel("Email", { exact: true }).first()).toBeVisible();
  } finally { await stack.dispose(); }
});
