import { test, expect, signIn } from "./fixtures";
import { withControl } from "./operations";

test("role and entitlement revocations take effect after lifecycle mutations", async ({ page, browser }) => {
  test.setTimeout(240_000);
  expect(process.env.AUTHZ_PROVIDER ?? "in-process").toBe("in-process");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await signIn(page);
  const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  await page.goto("/settings/members");
  await page.getByLabel("Email", { exact: true }).fill("authorization-member@example.test");
  await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("tenant_admin");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "authorization-member@example.test" });
  await expect(row).toContainText("invited");
  const invitation = await withControl(async db => (await db.query("select id from ba_invitation where email='authorization-member@example.test' and status='pending'")).rows[0].id);
  const member = await browser.newContext();
  try {
    const accepted = await member.request.post(`${origin}/api/auth/better-auth/login`, {
      headers: { origin }, form: { action: "signup", name: "Example Authorization Member", email: "authorization-member@example.test", password: process.env.E2E_PASSWORD!, invitation },
    });
    expect(accepted.ok()).toBe(true);
    const memberPage = await member.newPage();
    memberPage.on("pageerror", error => errors.push(error.message));
    await memberPage.goto(`${origin}/settings/members`);
    await expect(memberPage.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
    await page.reload(); await expect(row).toContainText("active");
    const membershipId = await row.locator('input[name="membershipId"]').inputValue();
    const changed = await page.request.post(`${origin}/api/settings/members`, {
      headers: { origin, accept: "application/json" }, form: { op: "role", membershipId, role: "tenant_member" },
    });
    expect(changed.status()).toBe(200);
    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { name: "Members", exact: true })).toHaveCount(0);
    await memberPage.goto(`${origin}/`);
    await expect(memberPage.getByText("Your modules", { exact: true })).toBeVisible();

    // Toggle an existing assignment through the owned route. The installation
    // owner fixture is the only persona allowed to change entitlements.
    const toggle = async (enabled: boolean) => {
      const result = await page.request.post(`${origin}/api/settings/modules`, {
        headers: { origin, accept: "application/json" }, form: { moduleKey: "assessment", enabled: String(enabled) },
      });
      expect(result.status()).toBe(200);
    };
    await toggle(false);
    const disabled = await memberPage.goto(`${origin}/assessment`);
    expect([403, 404]).toContain(disabled!.status());
    // Restore the shared fixture before the member removal and following specs.
    await toggle(true);
    await memberPage.goto(`${origin}/`);
    await expect(memberPage.getByRole("link", { name: /assessment/i }).first()).toBeVisible();
    await page.reload();
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(row).toHaveCount(0);
    const revoked = await member.request.get(`${origin}/settings/members`);
    expect(new URL(revoked.url()).pathname).not.toBe("/settings/members");
    const state = await withControl(async db => ({
      pending: (await db.query("select count(*)::int as count from authorization_outbox")).rows[0].count,
      desired: (await db.query("select count(*)::int as count from authorization_sync_state")).rows[0].count,
    }));
    expect(state).toEqual({ pending: 0, desired: 0 });
    expect(errors).toEqual([]);
  } finally {
    await page.request.post(`${origin}/api/settings/modules`, { headers: { origin, accept: "application/json" }, form: { moduleKey: "assessment", enabled: "true" } });
    await member.close();
  }
});
