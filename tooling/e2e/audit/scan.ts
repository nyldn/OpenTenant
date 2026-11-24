import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { fixtureOrigin, personaHost, type UatManifest } from "./fixtures";
import { normalize } from "./compare.mjs";
export interface ScanRecord {
  id: string; tenant: string; completed: boolean; status: number; final: string; kind: string; outcome: string;
  diagnostics: { title: string; h1: (string | null)[]; overflow: number; unlabeled: number }; elapsedMs: number;
  violations: Array<{ rule: string; impact: string | null | undefined; targets: unknown[] }>;
  incomplete: Array<{ rule: string; targets: unknown[] }>;
  errors: Array<{ name: string; serviceWorker: boolean; sandbox: boolean; sources: string[] }>;
  failedRequests: Array<{ path: string; failure: string | null }>;
}
async function stableTargets(page: Page, nodes: Array<{ target: unknown }>): Promise<unknown[]> {
  return page.evaluate(targets => targets.map(target => {
    // Keep frame/shadow selector chains intact. Current fixture documents have
    // single-document targets; no rule or frame is excluded from axe.
    if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== "string") return target;
    const element = document.querySelector(target[0]);
    if (!element) throw new Error("Audit target disappeared before identity capture");
    const parts: string[] = [];
    for (let el: Element | null = element; el && el.tagName !== "HTML"; el = el.parentElement) {
      const siblings = el.parentElement ? [...el.parentElement.children].filter(other => other.tagName === el!.tagName) : [el];
      parts.unshift(`${el.localName}:nth-of-type(${siblings.indexOf(el)+1})`);
    }
    const path = parts.join(" > ") || "html";
    if (document.querySelector(path) !== element) throw new Error("Audit identity path is not unique");
    return [path];
  }), nodes.map(node => node.target));
}
async function analyzeWcag(page: Page) {
  const singleDocument = page.frames().length === 1;
  let attached = false;
  const onFrame = () => { attached = true; };
  page.on("frameattached", onFrame);
  try {
    // Direct axe.run avoids a scratch page for single-document cells. Use the
    // full cross-frame algorithm whenever frames exist, and fail if a frame
    // appears during a direct run rather than silently omitting it.
    const result = await new AxeBuilder({ page }).setLegacyMode(singleDocument)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    if (singleDocument) {
      expect(attached, "no frame omitted by direct axe analysis").toBe(false);
      expect(page.frames()).toHaveLength(1);
    }
    return result;
  } finally { page.removeListener("frameattached", onFrame); }
}
export async function scanCell(page: Page, manifest: UatManifest, cell: { id: string; persona: string; viewport: { width: number; height: number }; route: { id: string; route: string; host: string | undefined } }): Promise<ScanRecord> {
  const host = cell.route.host ?? personaHost(cell.persona);
  const tenant = manifest.tenants.find(t => t.slug === host)!.tenantId;
  let route = cell.route.route.replace("{tenant}", tenant);
  if (route.includes("{ticket}")) {
    await page.goto(`${fixtureOrigin(manifest, host)}/support`, { timeout: 120_000 });
    const link = page.getByRole("link", { name: "SUP-000001", exact: true });
    const ticket = await link.count() ? await link.getAttribute("href") : null;
    route = ticket ?? "/support/00000000-0000-4000-8000-000000000000";
  }
  if (cell.route.id === "mcp-authorize") {
    route += "?" + new URLSearchParams({ project_id: "c".repeat(32), client_id: "browser-example", redirect_uri: "http://127.0.0.1:3123/callback", resource: `http://localhost:${manifest.ports.app}/api/mcp/developer`, response_type: "code", state: "audit", code_challenge_method: "S256", code_challenge: "v".repeat(43) });
  }
  const errors: ScanRecord["errors"] = [];
  page.on("pageerror", error => errors.push({ name: error.name, serviceWorker: /service.?worker/i.test(error.message), sandbox: /sandbox|opaque/i.test(error.message), sources: [...(error.stack ?? "").matchAll(/https?:\/\/[^\s)]+/g)].map(match => { try { return normalize(new URL(match[0]).pathname); } catch { return "unknown"; } }).slice(0, 5) }));
  const failedRequests: ScanRecord["failedRequests"] = [];
  page.on("requestfailed", request => failedRequests.push({ path: normalize(new URL(request.url()).pathname), failure: request.failure()?.errorText ?? null }));
  const start = Date.now();
  const response = await page.goto(`${fixtureOrigin(manifest, host)}${route}`, { timeout: 120_000 });
  expect(response).toBeTruthy();
  expect(response!.status(), "no server/compile failures in matrix").toBeLessThan(500);
  await page.waitForLoadState("domcontentloaded");
  await test.step("local font readiness", () => expect.poll(() => page.evaluate(() => document.fonts.status), { timeout: 20_000 }).toBe("loaded"), { timeout: 25_000 });
  if (cell.route.id.startsWith("assessment") && new URL(page.url()).pathname === "/assessment") {
    const navigation = page.getByRole("navigation", { name: "Assessment stages" });
    await expect(navigation).toBeVisible({ timeout: 30_000 });
    if (cell.route.id === "assessment-dimensions") await navigation.getByRole("button").nth(1).click();
    if (cell.route.id === "assessment-results") await navigation.getByRole("button", { name: /AI Readiness/ }).click();
  }
  const final = normalize(new URL(page.url()).pathname.replace(/\/$/, "") || "/");
  const apiDenial = (cell.route.id.startsWith("mcp-") || cell.route.id === "remote-fixture") && [403,404].includes(response!.status()) && !(response!.headers()["content-type"] ?? "").includes("text/html");
  const kind = apiDenial ? "api-denial" : cell.route.id === "remote-fixture" && response!.ok() && final.startsWith("/m/") ? "fixture" : "product";
  // Dev-mode pages (notably Next's 404) can render their h1 after
  // domcontentloaded. Wait, bounded, for the expected visible heading count so
  // both modes record settled content; a real regression still fails strict
  // comparison. Only rendered h1s count: the shell's CSS-hidden pre-hydration
  // placeholder is not exposed to assistive technology and made counts racy.
  const baselineCell = process.env.A11Y_CANDIDATE === "0"
    ? JSON.parse(await readFile(resolve(import.meta.dirname, "baseline.json"), "utf8")).cells.find((c: { id: string }) => c.id === cell.id)
    : undefined;
  const expectedHeadings = baselineCell ? (baselineCell.headings ?? []).length : kind === "product" ? 1 : 0;
  if (expectedHeadings > 0) {
    await expect.poll(() => page.locator("h1:visible").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(expectedHeadings).catch(() => undefined);
  }
  const diagnostics = await page.evaluate(() => ({ title: document.title, h1: [...document.querySelectorAll("h1")].filter(e => e.checkVisibility()).map(e => e.textContent), overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), unlabeled: [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(el => !(el as HTMLInputElement).labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length }));
  // Authorization receipts are checked before axe. Capturing an initial
  // candidate is explicit and never changes the reviewed file.
  if (process.env.A11Y_CANDIDATE === "0") {
    const baseline = JSON.parse(await readFile(resolve(import.meta.dirname, "baseline.json"), "utf8"));
    const expected = baseline.cells.find((c: { id: string }) => c.id === cell.id);
    expect({ id: cell.id, status: response!.status(), final, kind, tenant, headings: diagnostics.h1.map(h => normalize(h ?? "")) }).toEqual(expected);
  }
  if (kind === "fixture") {
    expect(diagnostics.title).toBeTruthy(); await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(response!.headers()["content-security-policy"]).toContain("sandbox");
    expect(response!.headers()["content-security-policy"]).not.toContain("allow-same-origin");
    expect(await page.evaluate(() => window.origin)).toBe("null");
    const canUseServiceWorkers = await page.evaluate(async () => {
      try { await navigator.serviceWorker.getRegistrations(); return true; } catch { return false; }
    });
    expect(canUseServiceWorkers).toBe(false);
  }
  const axe = apiDenial ? { violations: [], incomplete: [] } : await test.step("axe WCAG analysis", () => analyzeWcag(page), { timeout: 60_000 });
  const requested = normalize(new URL(route, fixtureOrigin(manifest, host)).pathname.replace(/\/$/, "") || "/");
  const main = page.locator("main").first();
  const emptyMain = await main.count() > 0 && !(await main.innerText()).trim();
  const outcome = response!.status() >= 400 ? "denied" : final !== requested ? "redirected" : emptyMain ? "denied-blank" : "content";
  return { id: cell.id, tenant, completed: true, status: response!.status(), final, kind, outcome, diagnostics, errors, failedRequests, elapsedMs: Date.now()-start,
    violations: await Promise.all(axe.violations.map(async v => ({ rule: v.id, impact: v.impact, targets: await stableTargets(page, v.nodes) }))),
    incomplete: await Promise.all(axe.incomplete.map(async v => ({ rule: v.id, targets: await stableTargets(page, v.nodes) }))) };
}
