import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/s1-permissions.log`); manifest = await readManifest();

});
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });

test("member owner-removal and managed-support denials explain next action", async ({ page }) => {
  test.setTimeout(180_000); await signInPersona(page, manifest, "admin");
  const origin = fixtureOrigin(manifest, "alpha"); await page.goto(`${origin}/settings/members`);
  const owner = page.getByRole("row").filter({ hasText: "alpha@example.test" });
  const rejected = page.waitForResponse(r => r.url().endsWith("/api/settings/members") && r.request().method() === "POST");
  await owner.getByRole("button", { name: "Remove", exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await expect(owner.getByRole("alert")).toContainText("Only a tenant owner can remove another owner.");
  await expect(page.locator("h1")).toHaveText("Members"); await expect(owner).toBeVisible();
});
test("restricted support settings never render blank main", async ({ page }) => {
  test.setTimeout(180_000); await signInPersona(page, manifest, "managed-support");
  for (const path of ["members", "identity", "activity"]) {
    await page.goto(`${fixtureOrigin(manifest, "alpha")}/settings/${path}`);
    await expect(page.locator("main h1")).toHaveCount(1); await expect(page.locator("main h1")).toHaveText("Access denied");
    await expect(page.locator("main").getByRole("alert")).toContainText(/permission|support/i);
    await expect(page.locator("main").getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
    await expect(page.getByRole("button", { name: "Exit support", exact: true })).toBeVisible();
  }
});
test("no-membership user can sign out and find invitation next step", async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
  await signInPersona(page, manifest, "no-memberships", "workspace");
  await page.goto(`${fixtureOrigin(manifest, "workspace")}/tenants`);
  await expect(page.getByText(/Ask your organisation's administrator/)).toBeVisible();
  await expect(page.getByText(/invitation link from your email/)).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(`${fixtureOrigin(manifest, "workspace")}/tenants`); await expect.poll(() => new URL(page.url()).pathname).toBe("/auth/better-auth/login");
  await expect(page.getByRole("heading", { name: "Sign in to OpenTenant", exact: true })).toBeVisible();
});
