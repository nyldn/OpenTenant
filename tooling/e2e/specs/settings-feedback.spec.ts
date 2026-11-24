import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, withFixtureControl, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/s1-feedback.log`); manifest = await readManifest();

});
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });

test("each routine settings save announces committed success or error", async ({ page }) => {
  test.setTimeout(240_000);
  await withFixtureControl(db => db.query("insert into oauth_token_vault(tenant_id,provider,aad,status) values ('tenant_e2e_alpha','slack','oauth:tenant_e2e_alpha:slack','active') on conflict do nothing"));
  await signInPersona(page, manifest, "tenant-owner");
  const origin = fixtureOrigin(manifest, "alpha");
  for (const [path, button, label, value] of [
    ["branding", "Save branding", "Display name", "Alpha revised"],
    ["navigation", "Save navigation", "Label", "Revised navigation"],
    ["modules", "Save presentation settings", "Display label", "Revised module"],
    ["domains", "Save metadata", "Display label", "Revised domain"],
    ["connections", "Save metadata", "Display name", "Revised connection"],
  ] as const) {
    await page.goto(`${origin}/settings/${path}`);
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: button, exact: true }) }).first();
    await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole("button", { name: button, exact: true }).click();
    await expect(form.getByRole("status")).toContainText(/saved/i);
    await page.reload();
    await expect(form.getByLabel(label, { exact: true })).toHaveValue(value);
    await form.getByRole("button", { name: button, exact: true }).click();
    await expect(form.getByRole("status")).toContainText(/unchanged/i);
    const endpoint = path === "branding" || path === "navigation" ? path : "routine-configuration";
    await page.route(`**/api/settings/${endpoint}`, route => route.fulfill({ status: 500, body: "private database diagnostic" }));
    await form.getByLabel(label, { exact: true }).fill(`${value} retry`);
    await form.getByRole("button", { name: button, exact: true }).click();
    await expect(form.getByRole("alert")).toContainText(/could not save|couldn't save|unable to save/i);
    await expect(form.getByRole("alert")).not.toContainText("private database diagnostic");
    await expect(form.getByLabel(label, { exact: true })).toHaveValue(`${value} retry`);
    await expect(form.getByRole("button", { name: button, exact: true })).toBeFocused();
    await page.unroute(`**/api/settings/${endpoint}`);
  }
  await page.goto(`${origin}/settings/modules`);
  const access = page.locator("form").filter({ has: page.getByRole("button", { name: "Save access mode", exact: true }) }).first();
  await access.getByRole("button", { name: "Save access mode", exact: true }).click();
  await expect(access.getByRole("status")).toContainText(/saved/i);
  await page.goto(`${origin}/settings/members`);
  const invite = page.locator("form").filter({ has: page.getByRole("button", { name: "Invite", exact: true }) });
  await invite.getByLabel("Email", { exact: true }).fill("s1-invite@example.test");
  await invite.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(invite.getByRole("status")).toContainText(/saved/i);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "s1-invite@example.test" })).toContainText("invited");

});
