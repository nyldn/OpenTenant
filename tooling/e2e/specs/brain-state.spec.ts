import AxeBuilder from "@axe-core/playwright";
import { tenantTest as test, expect, tenantOrigin } from "./fixtures";

const unavailableHeading = "Brain browser tools unavailable";
let moduleRoutes: { page: string; api: string };
test.beforeAll(async () => {
  // Listing must work while Turbo is rebuilding package output. Load runtime
  // declarations only after the fixture stack has started for actual tests.
  const { BRAIN_MODULE } = await import("../../../modules/brain/dist/manifest.js");
  moduleRoutes = { page: BRAIN_MODULE.routes[0]!.path, api: BRAIN_MODULE.apiRoutes[0]!.path };
});

test("Brain explains browser availability without claiming hosted semantic search", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${tenantOrigin("alpha")}${moduleRoutes.page}`);
  await expect(page.getByRole("heading", { name: unavailableHeading, exact: true })).toBeVisible();
  await expect(page.getByText(/Local deterministic token hashing is not hosted semantic search/)).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Brain provides a working Home link through the application shell", async ({ page }) => {
  await page.goto(`${tenantOrigin("alpha")}${moduleRoutes.page}`);
  await expect(page.getByRole("heading", { name: unavailableHeading, exact: true })).toBeVisible();
  await page.locator("[data-application-header]").getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(`${tenantOrigin("alpha")}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("Brain keeps unavailable browser tools separate from the signed API", async ({ page }) => {
  await page.goto(`${tenantOrigin("alpha")}${moduleRoutes.page}`);
  await expect(page.getByRole("heading", { name: unavailableHeading, exact: true })).toBeVisible();
  // The frozen local host has no browser context minting port or approved
  // local embedding route. A cookie alone must never authorize a tool call.
  const { status, body } = await page.evaluate(async apiPath => {
    const response = await fetch(apiPath, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "tools/call", params: { name: "search", arguments: { query: "example" } } }),
    });
    return { status: response.status, body: await response.json() };
  }, moduleRoutes.api);
  expect([401, 500]).toContain(status);
  expect(["missing_module_context", "module_signing_not_configured"]).toContain(body.error.code);
  expect(body).not.toHaveProperty("content");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});
