import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { routes, routeContext, navigateReady, initialJs, p95, record, gate, rssBatch, resetFixtures, observe, rendering, output } from "../production/fixtures";
import { proveDownloads } from "../production/downloads";

// Frozen only after the built baseline in docs/reviews/2026-11-17-wave6-v3.md.
// Baseline mode records measurements without performance assertions, while
// retaining status, identity, readiness, download and focus assertions.
export const budgets = {
  warmP95Ms: 2000, coldMs: 5000, lcpMs: 2500, cls: .1, interactionMs: 200,
  shellJsBytes: 300 * 1024, assessmentJsBytes: 500 * 1024,
  assessmentLcpMs: 4035,
  assessmentCls: { desktop: 0.6659583333333333 * 1.1, mobile: 0.7476928022730845 * 1.1 },
  appRssBytes: Math.ceil(805728256 * 11 / 10),
  totalRssBytes: Math.ceil(2029195264 * 11 / 10),
};
const shellJsLimits = { home: 374033, settings: 374665, navigation: 376276, admin: 375292, support: 374033 };

test("built critical routes meet latency payload and stability budgets", async ({ browser }) => {
  await record({ kind: "browser", version: browser.version(), desktop: "1440x900, DPR 1, CPU/network unthrottled", mobile: "390x844, DPR 1, CPU 4x slowdown, 150ms latency, 1.6Mbps down/750Kbps up" });
  for (const route of routes) {
    await rssBatch(`warm:${route.key}`, async () => {
      const { context, page, url } = await routeContext(browser, route);
      try {
        await navigateReady(page, url, route); // Prime this route outside samples.
        const samples = [];
        for (let i = 0; i < 20; i++) samples.push(await navigateReady(page, url, route));
        const js = await initialJs(page);
        await record({ kind: "warm", route: route.key, path: route.path, host: route.host, role: route.persona, samples, p95Ms: p95(samples), ...js });
        gate(p95(samples), budgets.warmP95Ms, `${route.key} warm p95`);
        gate(js.gzipBytes, route.key === "assessment" ? budgets.assessmentJsBytes : shellJsLimits[route.key], `${route.key} initial JS gzip`);
      } finally { await context.close(); }
    });
  }
  // Repeat identical warmed workloads. Compare application RSS after charts
  // and all routes are loaded; do not call route-to-route growth a leak.
  for (let batch = 0; batch < 3; batch++) await rssBatch(`repeat:${batch}`, async () => {
    for (const route of routes) {
      const { context, page, url } = await routeContext(browser, route);
      try { await navigateReady(page, url, route); } finally { await context.close(); }
    }
  });
});

test("cold first navigation meets budgets over five fresh production starts per route", async ({ browser }) => {
  for (const route of routes) {
    const fixture = await routeContext(browser, route);
    const storageState = await fixture.context.storageState();
    await fixture.context.close();
    const samples: number[] = [];
    await rssBatch(`cold:${route.key}`, async () => {
      for (let start = 0; start < 5; start++) {
        // Reset stops and starts Next and the worker, restoring the database.
        // Its static SVG readiness probe does not warm an application route.
        const reset = await resetFixtures();
        expect(reset).toMatchObject({ reset: "seed", verified: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
        try {
          const page = await context.newPage();
          samples.push(await navigateReady(page, fixture.url, route));
        } finally { await context.close(); }
      }
    });
    await record({ kind: "cold", route: route.key, samples, maxMs: Math.max(...samples), freshStarts: samples.length });
    gate(Math.max(...samples), budgets.coldMs, `${route.key} cold maximum`);
  }
});

test("mobile lab LCP CLS and scripted interaction delay meet built budgets", async ({ browser }) => {
  for (const route of routes) await rssBatch(`mobile:${route.key}`, async () => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const { context, page, cdp, url } = await routeContext(browser, route, true);
      try {
        await observe(context);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, connectionType: "cellular4g" });
        await cdp.send("Network.clearBrowserCache");
        await navigateReady(page, url, route);
        const beforeInput = await rendering(page);
        expect(beforeInput.lcp, "LCP observer must report a paint").toBeGreaterThan(0);
        const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
        await menu.focus(); await page.keyboard.press("Enter");
        const close = page.getByRole("button", { name: "Close menu", exact: true });
        await expect(close).toBeVisible(); await close.focus();
        await page.keyboard.press("Enter"); await expect(menu).toBeFocused();
        if (["navigation", "support", "assessment"].includes(route.key)) {
          const input = page.locator(route.control).first();
          await input.focus(); await page.keyboard.type(" lab", { delay: 30 });
          await expect(input).toBeFocused();
        }
        const metrics = { ...await rendering(page), lcp: beforeInput.lcp };
        samples.push(metrics);
        gate(metrics.lcp, route.key === "assessment" ? budgets.assessmentLcpMs : budgets.lcpMs, `${route.key} mobile LCP`);
        gate(metrics.cls, route.key === "assessment" ? budgets.assessmentCls.mobile : budgets.cls, `${route.key} full-session-window CLS`);
        gate(metrics.maxInteraction, budgets.interactionMs, `${route.key} maximum scripted event duration`);
      } finally { await context.close(); }
    }
    await record({ kind: "mobile", route: route.key, samples, lcpMs: Math.max(...samples.map(s => s.lcp)), cls: Math.max(...samples.map(s => s.cls)), interactionMs: Math.max(...samples.map(s => s.maxInteraction)) });
  });
});

for (const width of [1440, 390]) test(`production CSV JSON PDF downloads are complete and keyboard accessible at ${width}`, async ({ browser }, info) => {
  await rssBatch(`downloads:${width}`, async () => {
    const { context, page, url } = await routeContext(browser, routes[5], width === 390);
    try {
      await observe(context); await navigateReady(page, url, routes[5]);
      await proveDownloads(page, info);
      const metrics = await rendering(page);
      await record({ kind: "downloads", width, ...metrics });
      gate(metrics.cls, width === 390 ? budgets.assessmentCls.mobile : budgets.assessmentCls.desktop, `downloads ${width} session-window CLS`);
      gate(metrics.maxInteraction, budgets.interactionMs, `downloads ${width} scripted interaction duration`);
    } finally { await context.close(); }
  });
});

test("production batches report bounded RSS without repeated workload growth", async () => {
  const records = (await readFile(`${output}/measurements.jsonl`, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const batches = records.filter(r => r.kind === "rss");
  expect(batches).toHaveLength(routes.length * 3 + 3 + 2);
  for (const batch of batches) {
    expect(batch.appPeak).toBeGreaterThan(0); expect(batch.totalPeak).toBeGreaterThan(batch.appPeak);
    gate(batch.appPeak, budgets.appRssBytes, `${batch.label} application RSS`);
    gate(batch.totalPeak, budgets.totalRssBytes, `${batch.label} application/browser/runner RSS`);
  }
  const repeated = batches.filter(r => r.label.startsWith("repeat:"));
  gate(repeated[2].appPeak, repeated[0].appPeak * 1.1, "third identical batch application RSS versus first +10%");
  await record({ kind: "rss-summary", appPeak: Math.max(...batches.map(r => r.appPeak)), totalPeak: Math.max(...batches.map(r => r.totalPeak)), repeated });
});
