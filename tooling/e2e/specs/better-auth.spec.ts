import { test, expect, signIn } from "./fixtures";
import { withControl } from "./operations";
import AxeBuilder from "@axe-core/playwright";
test("Better Auth browser signs up, accepts an invitation, logs out, signs in and revokes its session", async ({ page, browser }) => {
  test.setTimeout(120_000);
  expect(process.env.IDENTITY_PROVIDER).toBe("better-auth");
  await signIn(page); await page.goto("/settings/members");
  await page.getByLabel("Email").fill("browser-invitee@example.test");
  await page.getByRole("combobox", { name: "Role" }).selectOption("tenant_member");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  // The shared form submits asynchronously; read the invitation only after the row is listed.
  await expect(page.getByRole("row").filter({ hasText: "browser-invitee@example.test" })).toContainText("invited");
  const invitation = await withControl(async db => (await db.query("select id from ba_invitation where email='browser-invitee@example.test' and status='pending'")).rows[0].id);
  const context = await browser.newContext(); const invitee = await context.newPage(); const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  try {
    await invitee.setViewportSize({ width: 390, height: 844 });
    await invitee.goto(`${origin}/api/auth/better-auth/login?invitation=${invitation}`);
    await expect(invitee.getByRole("heading", { name: "Sign in to OpenTenant", exact: true })).toBeVisible();
    expect(await invitee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of await invitee.locator("main input:not([type=hidden]), main button").all()) {
      if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await invitee.getByText("Create an account", { exact: true }).click();
    const signup = invitee.locator("details form");
    await signup.getByLabel("Name", { exact: true }).fill("Example Browser Invitee"); await signup.getByLabel("Email", { exact: true }).fill("browser-invitee@example.test"); await signup.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
    await signup.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    await withControl(async db => { expect((await db.query("select status from ba_invitation where id=$1", [invitation])).rows[0].status).toBe("accepted"); });
    const oldCookies = await context.cookies();
    await invitee.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(invitee.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    expect((await context.cookies()).filter(c => c.name === "opentenant_session")).toHaveLength(0);
    const replay = await browser.newContext();
    try { await replay.addCookies(oldCookies); const stale = await replay.newPage(); await stale.goto(origin); await expect(stale.getByRole("link", { name: "Sign in", exact: true })).toBeVisible(); } finally { await replay.close(); }
    await invitee.setViewportSize({ width: 1440, height: 900 });
    await invitee.getByRole("link", { name: "Sign in", exact: true }).click();
    const login = invitee.locator("main > form").first();
    await login.getByLabel("Email", { exact: true }).fill("browser-invitee@example.test"); await login.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
    await login.getByLabel("Password", { exact: true }).fill("incorrect-password");
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login.getByRole("alert")).toBeVisible();
    await expect(login.getByRole("alert")).toBeFocused();
    await expect(login.getByLabel("Email", { exact: true })).toHaveValue("browser-invitee@example.test");
    await expect(login.getByLabel("Password", { exact: true })).toHaveValue("");
    await login.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
    await invitee.keyboard.press("Enter"); await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    await invitee.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(invitee.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("invalid credentials retain form and announce retryable error", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [390, 1440]) {
    // Independent viewport cases each exercise wrong-then-correct below the
    // provider's real credential limit, without inheriting other tests' attempts.
    await withControl(async db => { await db.query('truncate "ba_rateLimit"'); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/api/auth/better-auth/login?return=/settings/branding");
    const form = page.locator("main > form").first();
    await form.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await form.getByLabel("Password", { exact: true }).fill("incorrect-password");
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(form.getByRole("alert")).toContainText("Check your email and password");
    await expect(form.getByLabel("Email", { exact: true })).toHaveValue("admin@example.test");
    await expect(form.getByLabel("Password", { exact: true })).toHaveValue("");
    await form.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Branding", exact: true })).toBeVisible();
    const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
    await page.request.post(`${origin}/api/auth/better-auth/sign-out`, { headers: { origin } });
  }
});

test("login and signup fit 390px with labels focus and usable targets", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/api/auth/better-auth/login");
  expect(new URL(page.url()).pathname).toBe("/auth/better-auth/login");
  const policy = response!.headers()["content-security-policy"]!;
  expect(policy).toContain("default-src 'none'");
  expect(policy).toMatch(/'nonce-[A-Za-z0-9+/]+'/);
  expect(policy).not.toContain("unsafe-inline");
  await page.getByText("Create an account", { exact: true }).click();
  for (const form of await page.locator("main form").all()) {
    for (const input of await form.locator("input:not([type=hidden])").all()) {
      await expect(input).toHaveAccessibleName(/Email|Password|Name|Invitation reference/);
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.locator("#signup-name").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#signup-email")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withRules(["label", "target-size"]).analyze()).violations).toEqual([]);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const native = await context.newPage();
    await native.goto(`${process.env.LOCAL_PUBLIC_ORIGIN}/api/auth/better-auth/login?return=/settings/branding&invitation=synthetic-reference`);
    const form = native.locator("main > form").first();
    await form.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await form.getByLabel("Password", { exact: true }).fill("incorrect-password");
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(native.getByRole("alert")).toContainText("Check your email and password");
    await expect(form.getByLabel("Email", { exact: true })).toHaveValue("admin@example.test");
    await expect(form.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("Invitation reference, if provided")).toHaveValue("synthetic-reference");
    expect(new URL(native.url()).searchParams.get("return")).toBe("/settings/branding");
  } finally { await context.close(); }
});
