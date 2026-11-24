import { test, expect, signIn } from "./fixtures";

test("unknown host is rejected without tenant data, even with a local session", async ({ page, context }) => {
  await signIn(page);
  // Chromium resolves this exact synthetic host to loopback. Retain a valid
  // synthetic session to prove a cookie cannot bypass host-to-tenant resolution.
  await context.addCookies((await context.cookies()).map((cookie) => ({ ...cookie, domain: "unknown.example.test" })));
  const response = await page.goto(`http://unknown.example.test:${process.env.E2E_APP_PORT}/`);
  expect(response?.status()).toBe(404);
  const body = await page.locator("body").textContent();
  expect(body).not.toContain("Example Organisation");
  expect(body).not.toContain("admin@example.test");
  expect(body).not.toContain("tenant_e2e");
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
});

test("local sign-in and sign-out", async ({ page, context }) => {
  await signIn(page);
  const session = (await context.cookies()).find((cookie) => cookie.name === "opentenant_session");
  expect(Boolean(session?.httpOnly)).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "opentenant_session")).toBe(false);
});

test("tenant home and launcher show the synthetic membership", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Example Organisation", exact: true })).toBeVisible();
  await expect(page.getByText("Your modules", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").locator('a[href="/assessment"]')).toBeVisible();
  await page.goto("/tenants");
  await expect(page.getByRole("heading", { name: "Your tenants", exact: true })).toBeVisible();
  const tenants = page.getByRole("list", { name: "Accessible tenants" });
  await expect(tenants.getByRole("listitem")).toHaveCount(1);
  await expect(tenants).toContainText("Example Organisation");
  await expect(tenants.getByRole("link", { name: "Open tenant" })).toHaveAttribute("href", "https://workspace.example.test");
});
