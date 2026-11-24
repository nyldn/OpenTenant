import { appendFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { root, readManifest, signInPersona } from "../audit/fixtures";
import { processTreeRss } from "../../uat/metrics.mjs";
export { resetFixtures } from "../../uat/reset.mjs";

export const output = resolve(root, "tooling/e2e/test-results/production");
export const mobileProfile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
export const routes = [
  { key: "home", path: "/", host: "alpha", persona: "tenant-owner", heading: "Example Alpha", control: 'a[href="/assessment"]' },
  { key: "settings", path: "/settings", host: "alpha", persona: "tenant-owner", heading: "Example Alpha", control: 'a[href="/settings/navigation"]' },
  { key: "navigation", path: "/settings/navigation", host: "alpha", persona: "tenant-owner", heading: "Navigation", control: 'input[name="label"]' },
  { key: "admin", path: "/admin", host: "admin", persona: "installation-owner", heading: "Tenants", control: 'a[href^="/admin/tenants/"]' },
  { key: "support", path: "/support", host: "alpha", persona: "tenant-owner", heading: "Support", control: 'input[name="subject"]' },
  { key: "assessment", path: "/assessment", host: "alpha", persona: "tenant-owner", heading: "AI Maturity Assessment", control: 'input[name="client"]' },
] as const;
export type ProductionRoute = typeof routes[number];

export async function builtManifest() {
  const manifest = await readManifest();
  expect((manifest as unknown as { mode: string }).mode).toBe("start");
  expect((await readFile(resolve(root, "apps/platform/.next/BUILD_ID"), "utf8")).trim()).not.toBe("");
  expect(process.env.PRODUCTION_RUNNER_PID, "Use production/run.mjs inside forge-job").toBeTruthy();
  return manifest;
}
export async function routeContext(browser: Browser, route: ProductionRoute, mobile = false) {
  const manifest = await builtManifest();
  const context = await browser.newContext(mobile ? mobileProfile : { viewport: { width: 1440, height: 900 } });
  // Browser-level allowlist preserves the real HTTP cache for warm samples.
  // page.route would disable it. CDP blocks all non-loopback URL patterns.
  await context.routeWebSocket(/.*/, ws => ws.close());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on("Fetch.requestPaused", event => {
    const url = new URL(event.request.url);
    const allowed = url.protocol === "blob:" || url.protocol === "data:" ||
      (url.protocol === "http:" && url.port === String(manifest.ports.app) &&
        (url.hostname === "admin.localhost" || manifest.tenants.some(t => url.hostname === `${t.slug}.localhost`)));
    void cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" });
  });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await signInPersona(page, manifest, route.persona, route.host);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const url = `http://${route.host}.localhost:${manifest.ports.app}${route.path}`;
  return { context, page, cdp, url };
}
export async function navigateReady(page: Page, url: string, route: ProductionRoute) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname.replace(/\/$/, "")).toBe(route.path.replace(/\/$/, ""));
  await expect(page.getByRole("heading", { name: route.heading, level: 1, exact: true })).toBeVisible();
  const control = route.key === "settings" && page.viewportSize()!.width < 768
    ? page.getByRole("button", { name: "Open navigation menu", exact: true })
    : page.locator(route.control).first();
  await expect(control).toBeVisible(); await expect(control).toBeEnabled();
  if (page.viewportSize()!.width < 768) await expect(page.locator('[data-slot="sidebar-container"]'), "mobile sidebar effect has hydrated").toHaveCount(0);
  if (route.key === "assessment") await expect(page.getByRole("button", { name: "Download engagement backup", exact: true })).toBeEnabled();
  // Browser time includes navigation, streaming, hydration, locator readiness
  // and two paint frames, without including the driver's clock/IPC origin.
  return page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
}
export const p95 = (values: number[]) => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1]!;
export async function record(value: object) { await appendFile(resolve(output, "measurements.jsonl"), JSON.stringify(value) + "\n"); }
export function gate(actual: number, limit: number, label: string) {
  expect(Number.isFinite(actual), `${label} must be measured`).toBe(true);
  if (process.env.PRODUCTION_BASELINE !== "1") expect.soft(actual, label).toBeLessThanOrEqual(limit);
}

export async function initialJs(page: Page) {
  // Collect the actual loaded JS graph, including modulepreloads and chunks
  // fetched after DOMContentLoaded. PDF/export chunks remain on-demand.
  await page.waitForTimeout(1000);
  const urls = await page.evaluate(() => [...new Set(performance.getEntriesByType("resource")
    .map(e => e.name).filter(name => new URL(name).pathname.endsWith(".js")))]);
  expect(urls.length).toBeGreaterThan(0);
  const chunks = [];
  for (const url of urls) {
    const response = await page.request.get(url); expect(response.status()).toBe(200);
    const body = await response.body();
    chunks.push({ path: new URL(url).pathname, gzipBytes: gzipSync(body, { level: 9 }).length });
  }
  return { gzipBytes: chunks.reduce((sum,c) => sum+c.gzipBytes, 0), chunks };
}
export async function rssBatch<T>(label: string, work: () => Promise<T>) {
  const owner = JSON.parse(await readFile(resolve(root, ".uat/active/owner.json"), "utf8"));
  let appPeak = 0, totalPeak = 0;
  const sample = async () => {
    const [app, total] = await Promise.all([processTreeRss(owner.pid), processTreeRss(Number(process.env.PRODUCTION_RUNNER_PID))]);
    appPeak = Math.max(appPeak, app); totalPeak = Math.max(totalPeak, total);
  };
  await sample();
  let pending = Promise.resolve();
  const timer = setInterval(() => { pending = pending.then(sample); }, 250);
  try { return await work(); }
  finally { clearInterval(timer); await pending; await sample(); await record({ kind: "rss", label, appPeak, totalPeak }); }
}

// Session-window CLS: max burst, gap <1s and duration <5s. Recent input is
// excluded. LCP is finalized before the first scripted interaction.
export async function observe(context: BrowserContext) {
  await context.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, maxInteraction: 0, interactions: 0, shifts: [] as Array<{ time: number; value: number; sources: Array<{ node: string; previous: number[]; current: number[] }> }> };
    Object.assign(window, { __productionMetrics: metrics });
    new PerformanceObserver(list => { for (const e of list.getEntries()) metrics.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    let start = 0, last = 0, sum = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> };
        if (e.hadRecentInput) continue;
        if (e.startTime-last >= 1000 || e.startTime-start >= 5000) { start = e.startTime; sum = 0; }
        last = e.startTime; sum += e.value; metrics.cls = Math.max(metrics.cls, sum);
        const rect = (r: DOMRectReadOnly) => [r.x, r.y, r.width, r.height];
        metrics.shifts.push({ time: e.startTime, value: e.value, sources: e.sources.map(s => ({
          node: s.node instanceof Element ? `${s.node.localName}#${s.node.id}.${[...s.node.classList].slice(0,4).join(".")}` : "detached",
          previous: rect(s.previousRect), current: rect(s.currentRect),
        })) });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTiming & { interactionId: number };
        if (e.interactionId) { metrics.interactions++; metrics.maxInteraction = Math.max(metrics.maxInteraction, e.duration); }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
}
export async function rendering(page: Page) {
  await page.waitForTimeout(1100); // Deliver observer records across input frames.
  return page.evaluate(() => {
    const metrics = (window as unknown as { __productionMetrics: { lcp: number; cls: number; maxInteraction: number; interactions: number; shifts: Array<{ time: number; value: number }> } }).__productionMetrics;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(e => new URL(e.name).pathname.endsWith(".js"));
    // Event Timing suppresses events below 16ms. Report the conservative
    // upper bound instead of claiming an unobservable zero-duration input.
    return { ...metrics, maxInteraction: Math.max(16, metrics.maxInteraction), profile: {
      ttfbMs: nav.responseStart, domContentLoadedMs: nav.domContentLoadedEventEnd,
      lastScriptResponseMs: Math.max(0, ...scripts.map(e => e.responseEnd)),
      scripts: scripts.map(e => ({ path: new URL(e.name).pathname, responseEndMs: e.responseEnd, durationMs: e.duration, transferBytes: e.transferSize })),
    } };
  });
}
