import { withControl } from "./operations";
import { test, expect, signIn } from "./fixtures";

test("owner invites and removes a member, but cannot remove the last owner", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/settings/members");
  await page.getByLabel("Email", { exact: true }).fill("member@example.test");
  await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("tenant_member");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invited = page.getByRole("row").filter({ hasText: "member@example.test" });
  await expect(invited).toContainText("tenant_member");
  await expect(invited).toContainText("invited");
  const member = await browser.newContext();
  try {
    const invitation = await withControl(db => db.query("select id from ba_invitation where email='member@example.test' and status='pending'"));
    const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
    const accepted = await member.request.post(`${origin}/api/auth/better-auth/login`, {
      headers: { origin }, form: { action: "signup", name: "Example Member", email: "member@example.test", password: process.env.E2E_PASSWORD!, invitation: invitation.rows[0].id },
    });
    expect(accepted.ok()).toBe(true);
    await page.reload();
    await expect(invited).toContainText("active");
    await invited.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(invited).toHaveCount(0);
    const revoked = await member.request.get(`${origin}/settings/members`);
    expect(new URL(revoked.url()).pathname).not.toBe("/settings/members");
  } finally { await member.close(); }
  const owner = page.getByRole("row").filter({ hasText: "admin@example.test" });
  await owner.getByRole("button", { name: "Remove", exact: true }).click();
  // The shared Alert adds a title; Next's route announcer is also role=alert outside main.
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Keep at least one active tenant owner.");
  await expect(owner).toContainText("tenant_owner");
  await expect(owner).toContainText("active");
});
