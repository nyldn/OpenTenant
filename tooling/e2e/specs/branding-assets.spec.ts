import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/s1-assets.log`); manifest = await readManifest();

});
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });

test("branding lists only this tenant assets and public defaults", async ({ page }) => {
  test.setTimeout(180_000);
  await signInPersona(page, manifest, "tenant-owner");
  const origin = fixtureOrigin(manifest, "alpha");
  await page.goto(`${origin}/settings/branding`);
  await expect(page.locator('select[name="logoUrl"]')).not.toContainText("Example Organisation");
  const logo = page.locator('select[name="logoUrl"]');
  await expect(logo).toContainText("Alpha private logo"); await expect(logo).toContainText("Public platform default");
  await expect(page.locator("main")).not.toContainText("Beta confidential logo");
  await logo.selectOption("/api/settings/branding/assets/asset_uat_alpha");
  await page.getByRole("button", { name: "Save branding", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "saved" })).toBeVisible();
  await page.reload(); await expect(logo).toHaveValue("/api/settings/branding/assets/asset_uat_alpha");
  const own = await page.request.get(`${origin}/api/settings/branding/assets/asset_uat_alpha`);
  expect(own.status()).toBe(200); expect(own.headers()["cache-control"]).toContain("no-store"); expect(own.headers()["content-type"]).toBe("image/png");
  const other = await page.request.get(`${origin}/api/settings/branding/assets/asset_uat_beta`); expect(other.status()).toBe(404);
  const mutation = await page.request.post(`${origin}/api/settings/branding`, { headers: { origin, accept: "application/json" }, form: { logoUrl: "/api/settings/branding/assets/asset_uat_beta" } });
  expect(mutation.status()).toBe(400); expect(await mutation.text()).not.toContain("Beta confidential");
});

test("seeded private assets reject the other owner on every UAT host", async ({ browser }) => {
  test.setTimeout(180_000);
  for (const [slug, other] of [["alpha", "beta"], ["beta", "alpha"]] as const) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await guardLocalRequests(page, manifest);
      await signInPersona(page, manifest, "tenant-owner", slug);
      const cookie = (await context.cookies()).find(c => c.name === "opentenant_session")!;
      const own = await context.request.get(`${fixtureOrigin(manifest, slug)}/api/settings/branding/assets/asset_uat_${slug}`);
      expect(own.status()).toBe(200);
      expect(own.headers()["content-type"]).toBe("image/png");
      for (const host of [...manifest.tenants.map(t => t.slug), "admin", "unknown"]) {
        const origin = fixtureOrigin(manifest, host);
        await context.addCookies([{ name: cookie.name, value: cookie.value, url: origin, httpOnly: true, sameSite: "Lax" }]);
        const denied = await context.request.get(`${origin}/api/settings/branding/assets/asset_uat_${other}`);
        expect(denied.status(), `${slug} fetching ${other} on ${host}`).toBe(404);
        expect(denied.headers()["cache-control"]).toContain("no-store");
      }
      expect((await context.request.get(`${fixtureOrigin(manifest, slug)}/opentenant-logo.svg`)).status()).toBe(200);
    } finally { await context.close(); }
  }
});
