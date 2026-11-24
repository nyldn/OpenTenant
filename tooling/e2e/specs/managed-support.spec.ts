import { test, expect } from "./fixtures";
import { ownerToken } from "../tenants.mjs";
import { withControl } from "./operations";

test("managed support shows the operator and reason, restricts members, and exits", async ({ page, context }) => {
  await withControl(db => db.query("update tenants set managed_support_enabled=true where tenant_id='tenant_e2e_alpha'"));
  const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  await context.addCookies([{ name: "opentenant_dev_tenant", value: "alpha", url: origin }]);
  // Installation owner has no membership in Alpha. Carry the real signed
  // workspace session to Alpha's host to exercise explicit support authority.
  await context.addCookies([{ name: "opentenant_session", value: ownerToken("workspace"), url: origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${origin}/admin/support`);
  await page.getByLabel("Reason", { exact: true }).fill("Synthetic configuration review");
  await page.getByLabel("Ticket or change reference").fill("E2E-001");
  await page.getByRole("button", { name: "Start 30-minute session" }).click();
  const banner = page.getByRole("status").filter({ hasText: "Managed support for" });
  await expect(banner).toContainText("Example Alpha");
  await expect(banner).toContainText("admin@example.test");
  await expect(banner).toContainText("Synthetic configuration review");
  const denied = await context.request.post(`${origin}/api/settings/members`, { headers: { origin }, form: { op: "invite", email: "denied@example.test", role: "tenant_member" } });
  expect(denied.status()).toBe(403);
  await banner.getByRole("button", { name: "Exit support", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit support", exact: true })).toHaveCount(0);
  expect((await context.cookies()).some(c => c.name === "opentenant_support")).toBe(false);
  await page.goto(`${origin}/settings`);
  await expect(page).not.toHaveURL(/\/settings$/);
  await withControl(async db => {
    const audit = await db.query("select action from audit_events where tenant_id='tenant_e2e_alpha' and action like 'support.session_%' order by sequence");
    expect(audit.rows.map(r => r.action)).toEqual(["support.session_started", "support.session_ended"]);
    expect((await db.query("select revoked_at is not null as revoked from managed_support_sessions where tenant_id='tenant_e2e_alpha'")).rows).toEqual([{ revoked: true }]);
  });
});
