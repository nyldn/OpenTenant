import { PgAuditStore } from "@opentenant/database";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signIn, tenantOrigin } from "./fixtures";
import { ownerToken } from "../tenants.mjs";
import { withControl } from "./operations";

const jobId = "00000000-0000-4000-8000-000000000052";
const tables = [
  { path: "/admin/audit", name: "Audit events" },
  { path: "/admin/helpdesk", name: "all helpdesk queue" },
  { path: "/admin/tenants/tenant_e2e_alpha", name: "Tenant jobs" },
];

const longReference = `synthetic-assignee-${"a".repeat(100)}`;
const longSubject = `synthetic-audit-${"b".repeat(160)}`;

test.beforeAll(async () => {
  await withControl(async db => {
    await new PgAuditStore(db).append({ occurredAt: new Date(), actor: { kind: "system", job: "admin-accessibility" }, tenantId: null, action: "admin.accessibility_fixture", subject: longSubject, detail: {} });
    await db.query(`insert into helpdesk_ticket_projection (tenant_id,ticket_number,status,priority,category,assigned_ref,opened_at,ticket_updated_at,source_version) values ('tenant_e2e_alpha','SUP-999952','open','medium','how_to',$1,now(),now(),1) on conflict (tenant_id,ticket_number) do nothing`, [longReference]);
    await db.query(`insert into tenant_worker_jobs (id,tenant_id,kind,status,actor) values ($1,'tenant_e2e_alpha','export','completed','{"kind":"system","job":"admin-accessibility"}')`, [jobId]);
  });
});
test.afterAll(async () => {
  await withControl(async db => {
    await db.query("delete from tenant_worker_jobs where id=$1", [jobId]);
    await db.query("delete from helpdesk_ticket_projection where tenant_id='tenant_e2e_alpha' and ticket_number='SUP-999952'");
  });
});

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
}

async function keyboardScroll(page: Page, table: Locator, name: string) {
  // The region must be the element that actually scrolls, not an ancestor.
  const overflow = await table.evaluate(el => {
    let parent = el.parentElement;
    while (parent && getComputedStyle(parent).overflowX !== "auto") parent = parent.parentElement;
    return !!parent && parent.scrollWidth > parent.clientWidth + 1;
  });
  const container = page.getByRole("region", { name, exact: true });
  if (!overflow) {
    await expect(container).toHaveCount(0);
    return;
  }
  await expect(container).toHaveAttribute("role", "region");
  await expect(container).toHaveAttribute("aria-label", name);
  await expect(container).toHaveAttribute("tabindex", "0");
  // Start before page controls and reach the scroller with Tab alone.
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  for (let i = 0; i < 70 && !await container.evaluate(el => el === document.activeElement); i++) await page.keyboard.press("Tab");
  await expect(container).toBeFocused();
  expect(await container.evaluate(el => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  })).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => container.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Shift+Tab");
  await expect(container).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(container).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(container).not.toBeFocused();
}

for (const width of [390, 1440]) {
  test(`audit filters announce bounded results and clear at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/admin/audit");
    await page.getByLabel("Tenant", { exact: true }).fill("platform");
    await page.getByLabel("Action", { exact: true }).fill("admin.accessibility_fixture");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("From date", { exact: true }).fill(today);
    await page.getByLabel("To date", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Filter events" }).click();
    await expect(page.getByRole("status")).toHaveText("1 matching events shown. Up to 100 newest matches.");
    await expect(page.getByRole("cell", { name: longSubject, exact: true })).toBeVisible();
    await fits(page);
    await page.getByLabel("Tenant", { exact: true }).fill("tenant_e2e_alpha");
    await page.getByRole("button", { name: "Filter events" }).click();
    await expect(page.getByRole("status")).toContainText("0 matching events shown");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    for (const label of ["Tenant", "Action", "From date", "To date"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    await expect(page.getByRole("cell", { name: longSubject, exact: true })).toBeVisible();
    await fits(page);
  });

  test(`admin tables are contained and keyboard scrollable at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    for (const { path, name } of tables) {
      await page.goto(path);
      const table = page.getByRole("table", { name: new RegExp(name) });
      await expect(table).toBeVisible();
      await keyboardScroll(page, table, name);
      await fits(page);
      if (path === "/admin/audit") await expect(page.getByRole("cell", { name: longSubject, exact: true }).first()).toHaveCSS("text-overflow", "clip");
      if (path === "/admin/helpdesk") await expect(page.getByRole("cell", { name: longReference, exact: true })).toHaveCSS("overflow-wrap", "anywhere");
      const axe = await new AxeBuilder({ page }).withRules(["scrollable-region-focusable"]).analyze();
      expect(axe.violations).toEqual([]);
    }
    const id = page.getByText(jobId, { exact: true });
    await expect(id).toBeVisible();
    expect(await id.evaluate(el => ["break-all", "break-word"].includes(getComputedStyle(el).wordBreak) || getComputedStyle(el).overflowWrap === "anywhere")).toBe(true);
  });

  test(`audit helpdesk and support have accessible contrast at ${width}`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    for (const slug of ["alpha", "beta", "hostile"]) {
      const origin = tenantOrigin(slug);
      await context.addCookies([{ name: "opentenant_session", value: ownerToken("workspace"), url: origin, httpOnly: true, sameSite: "Lax" }]);
      for (const path of ["/admin/audit", "/admin/helpdesk", "/admin/support"]) {
        await page.goto(`${origin}${path}`);
        const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
        expect(axe.violations, `${slug}${path}`).toEqual([]);
        await fits(page);
      }
    }
  });

  test(`non-admin denials explain an allowed exit at ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: "opentenant_session", value: ownerToken("alpha"), url: tenantOrigin("alpha"), httpOnly: true, sameSite: "Lax" }]);
    // Per-tenant admin documents stay 404 for non-owners (reviewed baseline status).
    expect((await page.goto(`${tenantOrigin("alpha")}/admin/tenants/tenant_e2e_alpha`))?.status()).toBe(404);
    for (const path of ["/admin", "/admin/audit", "/admin/helpdesk", "/admin/support", "/admin/tenants/new", "/admin/helpdesk/tenant_e2e_alpha/SUP-000001"]) {
      await page.goto(`${tenantOrigin("alpha")}${path}`);
      const alert = page.getByRole("main").getByRole("alert");
      await expect(alert.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible();
      await expect(alert).toContainText("does not have permission");
      await expect(alert.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
      await fits(page);
    }
    const deniedStatus = await page.evaluate(async () => {
      const response = await fetch("/api/admin/support-policy", {
        method: "POST",
        body: new URLSearchParams({ tenantId: "tenant_e2e_alpha", enabled: "true" }),
      });
      return response.status;
    });
    expect(deniedStatus).toBe(403);
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL(`${tenantOrigin("alpha")}/`);
  });

  test(`support policy mutations announce safe failures and success at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/admin");
    let reject = true;
    await page.route("**/api/admin/support-policy", route => route.fulfill({ status: reject ? 403 : 200, body: reject ? "private failure detail" : "ok" }));
    // Select by section content so the test also works on the base markup.
    const form = page.locator("section").filter({ has: page.getByRole("heading", { name: "Example Alpha", exact: true }) }).locator('form[action="/api/admin/support-policy"]');
    await form.getByRole("button").click();
    await expect(form.getByRole("alert")).toContainText("could not be completed");
    await expect(page.getByText("private failure detail")).toHaveCount(0);
    reject = false;
    await form.getByRole("button").click();
    await expect(form.getByRole("status")).toContainText("Action accepted");
    await fits(page);
  });
}
