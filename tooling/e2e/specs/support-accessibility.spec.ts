import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, signIn } from "./fixtures";

const subject = "Support keyboard and mobile layout ".repeat(5).trim();
const description = "Synthetic diagnostic: " + "x".repeat(1000);

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage({ baseURL: baseURL! });
  try {
    await signIn(page);
    // Compile both Support routes without mutating the shared tenant's tickets.
    const ticket = await page.request.get(`/support/${randomUUID()}`);
    expect(ticket.status()).toBe(404);
    const ticketsApi = await page.request.get("/api/support/tickets");
    expect(ticketsApi.status()).toBeGreaterThanOrEqual(400);
    expect(ticketsApi.status()).toBeLessThan(500);
  } finally {
    await page.close();
  }
});

async function openTicket(page: Page) {
  if (!await page.getByRole("button", { name: "Sign out", exact: true }).count()) await signIn(page);
  await page.goto("/support");
  await page.getByLabel("Subject", { exact: true }).fill(subject);
  await page.getByLabel("What happened?", { exact: true }).fill(description);
  await page.getByRole("button", { name: "Open ticket", exact: true }).click();
  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/u);
  return new URL(page.url()).pathname;
}

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(el => el === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

async function focusReceipt(target: Locator) {
  return target.evaluate(el => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { ring: style.getPropertyValue("--tw-ring-color").trim(), shadow: style.boxShadow,
      outline: style.outline, visible: el.matches(":focus-visible"),
      background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
}

async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}

test("overflow tables are keyboard scrollable without trapping focus", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/support");
  const emptyAudit = await new AxeBuilder({ page }).withRules(["scrollable-region-focusable"]).analyze();
  await test.info().attach("UX023-empty-queue.json", { body: JSON.stringify(emptyAudit.violations), contentType: "application/json" });
  expect.soft(emptyAudit.violations).toEqual([]);
  const emptyRegion = page.getByRole("region", { name: "Support tickets" });
  await tabTo(page, emptyRegion);
  await expect(emptyRegion).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => emptyRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Open ticket", exact: true })).toBeFocused();
  await openTicket(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/support");
    await fits(page);
    if (width === 390) {
      const region = page.getByRole("region", { name: "Support tickets" });
      await expect(region).toHaveAttribute("tabindex", "0");
      await tabTo(page, region);
      const receipt = await focusReceipt(region);
      expect(receipt.visible).toBe(true);
      expect(receipt.shadow).not.toBe("none");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      await page.keyboard.press("Tab");
      const ticketLink = page.getByRole("main").getByRole("link", { name: /^SUP-/ }).first();
      await expect(ticketLink).toBeFocused();
      const linkFocus = await focusReceipt(ticketLink);
      expect(linkFocus.visible).toBe(true);
      expect(linkFocus.shadow).not.toBe("none");
      await test.info().attach("list-link-focus.json", { body: JSON.stringify(linkFocus), contentType: "application/json" });
      await page.keyboard.press("Shift+Tab");
      await expect(region).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "Open ticket", exact: true })).toBeFocused();
      await test.info().attach("scroll-focus.json", { body: JSON.stringify(receipt), contentType: "application/json" });
    } else {
      await expect(page.getByRole("region", { name: "Support tickets" })).toHaveCount(0);
      expect(await page.getByRole("table").evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(1000);
    }
    const axe = await new AxeBuilder({ page }).withRules(["scrollable-region-focusable"]).analyze();
    expect(axe.violations).toEqual([]);
    await test.info().attach(`support-list-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  }
});

test("authorized ticket document always has lang and title, visible back focus and mobile feedback", async ({ page }) => {
  const path = await openTicket(page);
  const receipts = [];
  let consoleErrors = 0;
  page.on("console", message => { if (message.type() === "error") consoleErrors++; });
  page.on("pageerror", () => { consoleErrors++; });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/\S/);
    await fits(page);
    if (width === 390) {
      const heading = await page.locator("h1").boundingBox();
      const number = await page.locator("h1 + span").boundingBox();
      expect(number!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
    }
    const back = page.getByRole("main").getByRole("link", { name: "← Support", exact: true });
    await tabTo(page, back);
    await expect(back).toBeInViewport();
    const receipt = await focusReceipt(back);
    expect(receipt.visible).toBe(true);
    expect(receipt.shadow).not.toBe("none");
    // F1 resolves opaque focus colours with at least 3:1 against the background.
    const ratio = await back.evaluate(el => {
      const style = getComputedStyle(el);
      const rgb = (colour: string) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (colour: string) => rgb(colour).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ring = luminance(style.getPropertyValue("--tw-ring-color"));
      const background = luminance(getComputedStyle(document.documentElement).getPropertyValue("--background"));
      return (Math.max(ring, background) + 0.05) / (Math.min(ring, background) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(3);
    receipts.push({ width, status: response?.status(), path, lang: "en", focus: receipt, contrast: ratio, consoleErrors });
    expect((await new AxeBuilder({ page }).withRules(["html-has-lang"]).analyze()).violations).toEqual([]);
    await test.info().attach(`ticket-focus-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  }
  await test.info().attach("UX040-UX057.json", { body: JSON.stringify(receipts), contentType: "application/json" });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByLabel("Reply", { exact: true }).fill("Synthetic reply " + "y".repeat(1000));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reply sent." })).toBeVisible();
  await expect(page.getByText("Synthetic reply " + "y".repeat(1000), { exact: true })).toBeVisible();
  await fits(page);
});

test("state transitions announce results and unsafe failures retain input for retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openTicket(page);
  const form = page.locator("form").filter({ has: page.locator('input[name="op"][value="status"]') });
  for (const status of ["in_progress", "awaiting_reply", "resolved", "closed", "open"]) {
    await form.getByLabel("Status", { exact: true }).selectOption(status);
    await form.getByRole("button", { name: "Update", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("Ticket status updated.");
    await expect(page.locator("dl")).toContainText(status.replaceAll("_", " "));
  }
  const priority = page.locator("form").filter({ has: page.locator('input[name="op"][value="priority"]') });
  await priority.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await priority.getByRole("button", { name: "Update", exact: true }).click();
  await expect(priority.getByRole("status")).toHaveText("Ticket priority updated.");
  await expect(page.locator("dl")).toContainText("urgent");
  const assignment = page.locator("form").filter({ has: page.locator('input[name="op"][value="assign"]') });
  await assignment.getByLabel("Assignee (user id)", { exact: true }).fill("synthetic_" + "x".repeat(110));
  await assignment.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(assignment.getByRole("status")).toHaveText("Ticket assignment updated.");
  await fits(page);
  await page.route("**/api/support/tickets", route => route.fulfill({ status: 403, body: "private-driver-error@example.test" }));
  const reply = page.getByLabel("Reply", { exact: true });
  await reply.fill("Keep this synthetic reply for retry.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't save your changes. Please try again." })).toBeVisible();
  await expect(page.getByText("private-driver-error@example.test")).toHaveCount(0);
  await expect(reply).toHaveValue("Keep this synthetic reply for retry.");
  await page.unroute("**/api/support/tickets");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reply sent." })).toBeVisible();
});
