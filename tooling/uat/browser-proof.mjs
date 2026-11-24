// Optional live proof with the e2e workspace's installed Chromium.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const { chromium, expect } = createRequire(new URL("../e2e/package.json", import.meta.url))("@playwright/test");
const manifest = JSON.parse(await readFile(new URL("../../.uat/manifest.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const owner = manifest.personas.find(p => p.id === "alpha-owner");
  await page.goto(owner.signInUrl, { timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible({ timeout: 60_000 });
  const origin = new URL(owner.signInUrl).origin;
  await page.goto(`${origin}/tenants`);
  await expect(page.getByRole("link", { name: "Open tenant", exact: true })).toHaveAttribute("href", origin);
  await page.goto(`${origin}/assessment`, { timeout: 180_000 });
  await expect(page.getByPlaceholder("Client / organization")).toHaveValue("Example Alpha Readiness Review", { timeout: 60_000 });
  await page.reload();
  await expect(page.getByPlaceholder("Client / organization")).toHaveValue("Example Alpha Readiness Review");
  await page.goto(`${origin}/support`, { timeout: 180_000 });
  for (const state of ["open", "in_progress", "awaiting_reply", "resolved", "closed"]) {
    await expect(page.getByRole("cell", { name: state.replace("_", " "), exact: true }).first()).toBeVisible();
  }
  await page.goto(`${origin}/settings/members`);
  for (const role of ["tenant_owner", "tenant_admin", "tenant_member"]) await expect(page.getByRole("cell", { name: role, exact: true }).first()).toBeVisible();
  if (manifest.identityProvider === "better-auth" && manifest.mode === "dev") {
    await page.getByLabel("Email", { exact: true }).fill("uat-invited@example.test");
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("tenant_member");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "uat-invited@example.test" })).toContainText("invited");
  }
  const fresh = manifest.personas.find(p => p.id === "fresh-owner");
  await page.goto(fresh.signInUrl);
  await page.waitForURL(new URL(fresh.signInUrl).origin + "/");
  await page.goto(`${new URL(fresh.signInUrl).origin}/support`);
  await expect(page.getByText("No tickets available.", { exact: true })).toBeVisible();
  console.log("Browser proof: persona sign-in, seeded Assessment and reload, five ticket states, member roles, tunnel links and fresh empty state passed.");
  await context.close();
} finally { await browser.close(); }
