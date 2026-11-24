import { test, expect, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("admin branding settings render", async ({ page }) => {
  await page.goto("/settings/branding");
  await expect(page.getByRole("heading", { name: "Branding", exact: true })).toBeVisible();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Example Organisation");
  await expect(page.getByRole("button", { name: "Save branding" })).toBeEnabled();
});

test("admin members settings render the local owner", async ({ page }) => {
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  const owner = page.getByRole("row").filter({ hasText: "admin@example.test" });
  await expect(owner).toContainText("Example Admin");
  await expect(owner).toContainText("tenant_owner");
  await expect(owner).toContainText("active");
});
