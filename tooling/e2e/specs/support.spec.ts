import { test, expect, signIn } from "./fixtures";

test("support list and ticket creation use the tenant support schema", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Get help", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
  // Other legacy specs share this tenant's queue; host-pages.test.tsx owns the empty state.
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Subject", { exact: true }).fill("Example browser ticket");
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("how_to");
  await page.getByLabel("What happened?", { exact: true }).fill("Synthetic support request created by the browser suite.");
  await page.getByRole("button", { name: "Open ticket", exact: true }).click();
  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/u);
  await expect(page.getByRole("heading", { name: "Example browser ticket", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic support request created by the browser suite.", { exact: true })).toBeVisible();
  await page.goto("/support");
  const row = page.getByRole("row").filter({ hasText: "Example browser ticket" });
  await expect(row).toContainText(/SUP-\d{6}/u);
  await expect(row).toContainText("open");
});
