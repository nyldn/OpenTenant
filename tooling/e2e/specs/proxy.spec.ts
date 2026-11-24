import { test, expect, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("module proxy enforces a sandbox CSP against the local upstream", async ({ page }) => {
  const response = await page.goto("/m/e2e-stub");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("sandbox allow-scripts allow-forms allow-popups allow-downloads");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Example local module" })).toBeVisible();
});

test("module proxy disables shared caching", async ({ page }) => {
  // Regression for R11-06: upstream cache headers must never reach a shared cache.
  const response = await page.goto("/m/e2e-stub");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
});
