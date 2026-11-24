import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { PILLARS } from "@opentenant/assessment";
import { test, expect, signIn } from "./fixtures";

async function openAssessment(page: Page, demo = true) {
  await signIn(page);
  await page.goto("/assessment");
  await expect(page.getByRole("navigation", { name: "Assessment stages" })).toBeVisible();
  if (demo) await page.getByRole("button", { name: "Demo data", exact: true }).click();
}
async function stage(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: new RegExp(name) }).click();
}
async function tabTo(page: Page, target: Locator) {
  for (let n = 0; n < 160; n++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(el => el === document.activeElement)) return;
  }
  throw new Error("Tab traversal did not reach the control");
}

for (const width of [390, 1440]) {
  for (const route of ["assessment", "assessment-dimensions", "assessment-results"]) {
    test(`${route} has no contrast violations at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAssessment(page);
      if (route === "assessment-dimensions") await stage(page, PILLARS[1]!.name);
      if (route === "assessment-results") await stage(page, "AI Readiness");
      const result = await new AxeBuilder({ page }).withRules(["color-contrast", "scrollable-region-focusable"]).analyze();
      expect(result.violations).toEqual([]);
    });
  }
}

test("mobile rail fits and reaches all dimensions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssessment(page, false);
  let dimensions = 0;
  for (const pillar of PILLARS) {
    const button = page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: new RegExp(pillar.name) });
    await button.click();
    const label = button.getByText(pillar.name, { exact: true });
    expect(await label.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "full pillar name is readable").toBe(true);
    await expect(page.getByRole("group", { name: /^Maturity score for / })).toHaveCount(pillar.dimensions.length);
    dimensions += pillar.dimensions.length;
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  expect(dimensions).toBe(25);
});

test("every assessment input has a visible associated label", async ({ page }) => {
  await openAssessment(page, false);
  for (const name of [PILLARS[0]!.name, PILLARS[1]!.name, "Responses", "AI Readiness"]) {
    await stage(page, name);
    for (const field of await page.locator('.assessment-root input:not([type="file"]), .assessment-root select, .assessment-root textarea').all()) {
      const id = await field.getAttribute("id");
      expect(id, "every field has an ID").toBeTruthy();
      // Use the native association, which also checks that shared labels target the actual control.
      const text = await field.evaluate(el => Array.from((el as HTMLInputElement).labels ?? []).map(l => ({ text: l.textContent?.trim(), visible: l.getBoundingClientRect().height > 0 })));
      expect(text.some(l => l.text && l.visible)).toBe(true);
    }
    await expect(page.getByLabel("Client / organization", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Department", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Facilitator", { exact: true })).toBeVisible();
    const respondent = page.getByLabel("Respondent name", { exact: true });
    await expect(respondent).toHaveAttribute("aria-describedby", /.+/);
  }
  await page.getByRole("button", { name: "Demo data", exact: true }).click();
  await expect(page.getByLabel("Operating profile", { exact: true })).toBeVisible();
});

test("assessment has one named page heading", async ({ page, browser }) => {
  await signIn(page);
  const noScript = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const serverPage = await noScript.newPage();
    await serverPage.goto(new URL("/assessment", page.url()).href);
    await expect.soft(serverPage.locator("h1")).toHaveText(["AI Maturity Assessment"]);
  } finally { await noScript.close(); }
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    const ready = new Promise<void>(resolve => window.addEventListener("assessment-test-release", () => resolve(), { once: true }));
    Object.defineProperty(navigator.locks, "request", { value: async (...args: Parameters<typeof request>) => { await ready; return request(...args); } });
  });
  await page.goto("/assessment");
  await expect(page.getByText("Loading saved assessment…", { exact: true })).toBeVisible();
  await expect.soft(page.locator("h1")).toHaveText(["AI Maturity Assessment"]);
  await page.evaluate(() => window.dispatchEvent(new Event("assessment-test-release")));
  await expect(page.getByRole("navigation", { name: "Assessment stages" })).toBeVisible();
  for (const name of [PILLARS[1]!.name, "Responses", "AI Readiness"]) {
    await stage(page, name);
    await expect(page.locator("h1")).toHaveText(["AI Maturity Assessment"]);
    await expect(page.getByLabel("Client / organization", { exact: true })).toBeVisible();
  }
});

test("ordinary assessment has neutral profile copy and no irrelevant recovery details", async ({ page }) => {
  await openAssessment(page, false);
  await expect(page.getByLabel("Operating profile", { exact: true })).toBeVisible();
  await expect(page.getByText(/insurance/i)).toHaveCount(0);
  await page.getByLabel("Client / organization", { exact: true }).fill("Example Organisation");
  await expect(page.getByText("Saved to this browser.", { exact: true })).toBeVisible();
  await expect(page.getByText("Original legacy recovery:", { exact: true })).toBeHidden();
  await expect(page.getByText(/Engagement v1|engagement-v2/)).toBeHidden();
  await expect(page.getByRole("button", { name: "Download engagement backup", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Restore verified backup", exact: true })).toBeVisible();
  await page.getByText("Advanced recovery", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore verified backup", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Engagement v1", exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("assessment_")) localStorage.removeItem(key);
    localStorage.setItem("assessment_session_v26", JSON.stringify({ clientInfo: { name: "Example Legacy Organisation", department: "Operations", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 }));
  });
  await page.reload();
  await expect(page.getByText("Legacy Assessment data is available in this browser.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Claim saved session", exact: true }).click();
  await expect(page.getByLabel("Client / organization", { exact: true })).toHaveValue("Example Legacy Organisation");

});

test("overflow tables are keyboard scrollable and back controls have visible keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssessment(page);
  await stage(page, "AI Readiness");
  const containers = page.locator('.assessment-root [data-slot="table-container"]');
  let overflowing = 0;
  for (const container of await containers.all()) {
    const overflow = await container.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    if (!overflow) { await expect(container).not.toHaveAttribute("tabindex", "0"); continue; }
    overflowing++;
    await expect(container).toHaveAttribute("role", "region");
    await expect(container).toHaveAttribute("aria-label", /.+/);
    await expect(container).toHaveAttribute("tabindex", "0");
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await tabTo(page, container);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => container.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
  expect(overflowing).toBeGreaterThan(0);
  const back = page.getByRole("button", { name: "Back", exact: true });
  await tabTo(page, back);
  const focus = await back.evaluate(el => { const s = getComputedStyle(el); return { visible: el.matches(":focus-visible"), shadow: s.boxShadow, outline: s.outlineStyle, ring: s.getPropertyValue("--ring"), rect: el.getBoundingClientRect().toJSON() }; });
  expect(focus.visible).toBe(true);
  expect(focus.shadow !== "none" || focus.outline !== "none").toBe(true);
  await test.info().attach("computed-back-focus", { body: JSON.stringify(focus), contentType: "application/json" });
  await test.info().attach("keyboard-back-focus", { body: await page.screenshot(), contentType: "image/png" });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Responses", exact: true })).toBeVisible();
});
