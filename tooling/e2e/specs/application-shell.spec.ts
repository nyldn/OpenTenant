import { test, expect, type Page } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";

let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/f2-application-shell.log`); manifest = await readManifest(); });
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const signOut = page.locator("[data-application-header]").getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toBeVisible(); await expect(signOut).toBeInViewport();
}
async function menu(page: Page, width: number) {
  if (width < 768) await page.getByRole("button", { name: "Open navigation menu" }).click();
  const nav = page.getByRole("navigation", { name: "Application navigation" });
  await expect(nav).toBeVisible(); return nav;
}
for (const width of [390, 1440]) {
  test(`long account and admin actions fit 390px: ${width}`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: 900 });
    await signInPersona(page, manifest, "installation-owner");
    await page.goto(`${fixtureOrigin(manifest, "workspace")}/admin`);
    await expect(page.getByRole("heading", { name: "Tenants", exact: true })).toBeVisible();
    await fits(page);
    await test.info().attach(`admin-shell-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    const nav = await menu(page, width);
    for (const label of ["Home", "Create tenant", "Audit log", "Helpdesk"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: "Close menu" }).click();
    // Exercise a client transition across the persistent root layout too.
    await page.locator("[data-application-header]").getByRole("link", { name: "Home", exact: true }).click();
    await fits(page);
    await signInPersona(page, manifest, "tenant-owner", "hostile");
    await fits(page);
  });
  test(`every module and tenant detail has an allowed return: ${width}`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: 900 });
    await signInPersona(page, manifest, "tenant-owner");
    for (const path of ["/support", "/brain"]) {
      await page.goto(`${fixtureOrigin(manifest, "alpha")}${path}`);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Home", exact: true })).toBeVisible();
      await fits(page);
    }
    // The frozen fixture entitles only the workspace tenant to the remote stub.
    await signInPersona(page, manifest, "installation-owner");
    await page.goto(`${fixtureOrigin(manifest, "workspace")}/modules/e2e-stub`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await fits(page);
    const frame = page.locator("iframe");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-downloads");
    await expect(frame).toHaveAttribute("src", "/m/e2e-stub");
    const proxy = await page.request.get(`${fixtureOrigin(manifest, "workspace")}/m/e2e-stub`);
    expect(proxy.headers()["content-security-policy"]).toContain("sandbox allow-scripts allow-forms allow-popups allow-downloads;");
    expect(proxy.headers()["content-security-policy"]).not.toContain("allow-same-origin");
    expect(await proxy.text()).not.toContain("data-application-header");
    const opaque = await frame.elementHandle();
    expect(await opaque!.evaluate((element: HTMLIFrameElement) => { try { return element.contentWindow!.location.origin; } catch { return "opaque"; } })).toBe("opaque");
    await signInPersona(page, manifest, "installation-owner");
    await page.goto(`${fixtureOrigin(manifest, "workspace")}/admin/tenants/tenant_e2e_alpha`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Home", exact: true })).toBeVisible();
  });
  test(`settings content uses the available width and authorized menu: ${width}`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: 900 });
    await signInPersona(page, manifest, "tenant-owner"); await page.goto(`${fixtureOrigin(manifest, "alpha")}/settings`);
    await fits(page);
    await test.info().attach(`settings-shell-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    expect((await page.getByRole("main").boundingBox())!.width).toBeGreaterThan(width === 390 ? 350 : 700);
    const nav = await menu(page, width); await expect(nav.getByRole("link", { name: "Branding", exact: true })).toBeVisible();
    if (width < 768) { await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused(); }
  });
}

test("keyboard reaches skip link, mobile menu and sign-out", async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    // Logout revokes the seeded session. Use a distinct valid account for
    // each viewport rather than replaying that revoked fixture cookie.
    await signInPersona(page, manifest, width === 390 ? "tenant-owner" : "admin"); await page.goto(`${fixtureOrigin(manifest, "alpha")}/`);
    await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter"); await expect(page.locator("#main-content")).toBeFocused();
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    await page.reload(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    if (width < 768) {
      await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused();
      await page.keyboard.press("Enter"); await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused();
    } else {
      await expect(page.getByRole("navigation", { name: "Application navigation" }).getByRole("link", { name: "Home", exact: true })).toBeFocused();
    }
    const signOut = page.locator("[data-application-header]").getByRole("button", { name: "Sign out", exact: true });
    for (let i = 0; i < 30 && !await signOut.evaluate(el => el === document.activeElement); i++) await page.keyboard.press("Tab");
    await expect(signOut).toBeFocused();
    await page.keyboard.press("Enter"); await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  }
});
test("signed-out home has a page heading", async ({ page }) => {
  for (const host of ["alpha", "hostile"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${fixtureOrigin(manifest, host)}/`); await expect(page.locator("h1")).toHaveCount(1); await expect(page.locator("h1")).not.toBeEmpty();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});
test("no-membership user can sign out and find invitation next step", async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
  await signInPersona(page, manifest, "no-memberships", "workspace");
  await expect(page.getByText(/Ask your organisation's administrator/)).toBeVisible();
  await expect(page.getByText(/invitation link from your email/)).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(`${fixtureOrigin(manifest, "workspace")}/tenants`);
  // Signed-out browsers land on the host-rendered sign-in page (A1 303 redirect).
  await expect(page).toHaveURL(/\/auth\/better-auth\/login\?return=%2Ftenants(&|$)/);
});
test("managed-support banner and exit remain reachable at 390px", async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
  await signInPersona(page, manifest, "managed-support");
  await expect(page.getByRole("status").filter({ hasText: "Managed support for" })).toBeVisible();
  await page.locator("[data-application-header]").getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(`${fixtureOrigin(manifest, "alpha")}/`);
  await expect(page.getByRole("status").filter({ hasText: "Managed support for" })).toBeVisible();
  await fits(page); const exit = page.getByRole("button", { name: "Exit support", exact: true });
  await expect(exit).toBeInViewport(); await exit.click();
  await expect(page.getByRole("button", { name: "Exit support", exact: true })).toHaveCount(0);
});
