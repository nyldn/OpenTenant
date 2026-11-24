import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, withFixtureControl, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/s1-mobile.log`); manifest = await readManifest();

});
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });

test("settings controls and content shrink within all widths", async ({ page }) => {
  test.setTimeout(240_000);
  await withFixtureControl(db => db.query("insert into oauth_token_vault(tenant_id,provider,aad,status,display_name) values ('tenant_e2e_alpha','slack','oauth:tenant_e2e_alpha:slack','active',$1) on conflict do nothing", ["LongProvider".repeat(30)]));
  await signInPersona(page, manifest, "tenant-owner");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["", "branding", "navigation", "modules", "domains", "connections", "members", "identity", "activity"]) {
      await page.goto(`${fixtureOrigin(manifest, "alpha")}/settings/${path}`);
      await expect(page.locator("main h1")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${path} at ${width}`).toBeLessThanOrEqual(1);
      for (const control of await page.locator("main input:not([type=hidden]):not([type=radio]):not([type=checkbox]), main textarea, main select, main button").all()) {
        if (await control.evaluate(element => Boolean(element.closest('[role="region"]')))) continue;
        const box = await control.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `${path} control at ${width}`).toBe(true);
      }
      if (width === 390 && (path === "branding" || path === "navigation")) {
        const button = path === "branding" ? "Save branding" : "Save navigation";
        const form = page.locator("form").filter({ has: page.getByRole("button", { name: button, exact: true }) }).first();
        await form.getByLabel(path === "branding" ? "Display name" : "Label", { exact: true }).fill(`Mobile ${path}`);
        await form.getByRole("button", { name: button, exact: true }).click();
        await expect(form.getByRole("status")).toContainText(/saved/i);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      }
    }
    const region = page.getByRole("region", { name: "Tenant members" });
    await page.goto(`${fixtureOrigin(manifest, "alpha")}/settings/members`);
    await expect(region).toHaveAttribute("tabindex", "0");
    if (width === 390) {
      // Measure after layout settles; the table renders after navigation.
      await expect.poll(() => region.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
      await region.focus(); await region.press("ArrowRight");
      await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
  }
});
