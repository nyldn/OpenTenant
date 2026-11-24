import { tenantTest as test, expect, tenantOrigin } from "./fixtures";
import { ownerToken } from "../tenants.mjs";
import { withControl } from "./operations";
import type { Page } from "@playwright/test";

// Chromium owns the synthetic DNS mapping and supplies the real browser Origin.
async function reviewStatus(page: Page, tenantId: string): Promise<number> {
  return page.evaluate(async tenantId => (await fetch("/api/admin/brand-proposals", {
    method: "POST", body: new URLSearchParams({ tenantId, action: "review", reason: "Authority boundary proof" }),
  })).status, tenantId);
}

test("Better Auth tenant owner uploads reviews and applies tenant-bound brand", async ({ page, browser }) => {
  test.setTimeout(180_000);
  expect(process.env.IDENTITY_PROVIDER).toBe("better-auth");
  const origin = tenantOrigin("alpha");
  // A multi-organization account must bind to the verified request host.
  await withControl(async db => {
    await db.query('truncate "ba_rateLimit"');
    await db.query(`insert into ba_member(id,"organizationId","userId",role,"createdAt") select 'a1-extra-membership',o.external_organization_id,u.id,'member',now() from identity_org_mappings o cross join ba_user u where o.tenant_id='tenant_e2e_beta' and u.email='alpha@example.test'`);
  });
  await page.goto(`${origin}/api/auth/better-auth/login?return=/admin/tenants/tenant_e2e_alpha/brand-proposals`);
  const login = page.locator("main > form").first();
  await login.getByLabel("Email", { exact: true }).fill("alpha@example.test");
  await login.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/better-auth/login" && response.request().method() === "POST");
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await page.waitForURL(`${origin}/admin/tenants/tenant_e2e_alpha/brand-proposals`, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Upload brand.md", exact: true })).toBeVisible();
  await page.getByLabel("Brand document", { exact: true }).setInputFiles({ name: "brand.md", mimeType: "text/markdown", buffer: Buffer.from("# Display Name\nExample Updated Alpha\n\n```brand\ncolorPrimary: #234567\n```\n") });
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/brand-proposals" && response.request().method() === "POST", { timeout: 120_000 });
  await page.getByRole("button", { name: "Upload draft", exact: true }).click();
  expect((await uploaded).status()).toBe(303);
  await expect(page.getByRole("heading", { name: "Uploaded brand.md", exact: true })).toBeVisible();
  await page.getByLabel("Review reason", { exact: true }).fill("Review the uploaded source");
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("button", { name: /Apply \d+ unlocked values/ })).toBeVisible();
  await page.getByLabel("displayName", { exact: true }).fill("Example Reviewed Alpha");
  await page.getByLabel("Edit reason", { exact: true }).fill("Confirm the uploaded display name");
  await page.getByRole("button", { name: "Save edits and require new review", exact: true }).click();
  await expect(page.getByRole("button", { name: /Apply \d+ unlocked values/ })).toHaveCount(0);
  await page.getByLabel("Review reason", { exact: true }).fill("Reviewed the source and unlocked values");
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await page.getByLabel("Apply reason", { exact: true }).fill("Apply reviewed tenant branding");
  await page.getByRole("button", { name: /Apply \d+ unlocked values/ }).click();
  await expect(page.getByText("Applied to the active tenant brand.", { exact: true })).toBeVisible();
  await withControl(async db => {
    expect((await db.query("select status from brand_proposals where tenant_id='tenant_e2e_alpha' order by created_at desc limit 1")).rows[0].status).toBe("applied");
    expect((await db.query("select overrides->>'displayName' as name from brand_policies where tenant_id='tenant_e2e_alpha'")).rows[0].name).toBe("Example Reviewed Alpha");
    const audit = await db.query("select action from audit_events where tenant_id='tenant_e2e_alpha' and action like 'brand.proposal.%'");
    expect(audit.rows.map(row => row.action)).toEqual(expect.arrayContaining(["brand.proposal.uploaded", "brand.proposal.reviewed", "brand.proposal.edited", "brand.proposal.applied"]));
    // The adapter persists the host-selected active organization.
    expect((await db.query(`select count(*)::int as count from ba_session s join ba_member m on m."userId"=s."userId" and m."organizationId"=s."activeOrganizationId" join identity_org_mappings o on o.external_organization_id=m."organizationId" where o.tenant_id='tenant_e2e_alpha' and m.role='owner'`)).rows[0].count).toBeGreaterThan(0);
  });
  // UAT-007: verified owners reach proposals from tenant Branding settings.
  await page.goto(`${origin}/settings/branding`);
  await page.getByRole("link", { name: "Review brand proposals", exact: true }).click();
  await page.waitForURL(`${origin}/admin/tenants/tenant_e2e_alpha/brand-proposals`);
  expect(await reviewStatus(page, "tenant_e2e_beta")).toBe(403);
  await withControl(async db => { await db.query(`update ba_member set role='member' where "userId"=(select id from ba_user where email='alpha@example.test') and "organizationId"=(select external_organization_id from identity_org_mappings where tenant_id='tenant_e2e_alpha')`); });
  try {
    expect(await reviewStatus(page, "tenant_e2e_alpha")).toBe(403);
  } finally {
    await withControl(async db => { await db.query(`update ba_member set role='owner' where "userId"=(select id from ba_user where email='alpha@example.test') and "organizationId"=(select external_organization_id from identity_org_mappings where tenant_id='tenant_e2e_alpha')`); await db.query("delete from ba_member where id='a1-extra-membership'"); });
  }
  const installation = await browser.newContext();
  try {
    await installation.addCookies([{ name: "opentenant_session", value: ownerToken("workspace"), url: origin }]);
    const installationPage = await installation.newPage();
    await installationPage.goto(`${origin}/api/auth/better-auth/login`);
    expect(await reviewStatus(installationPage, "tenant_e2e_alpha")).toBe(403);
  } finally { await installation.close(); }
});
