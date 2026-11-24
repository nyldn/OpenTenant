import { appendFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CELLS, batchRoutes } from "../audit/inventory.mjs";
import { assertFixtureIdentity, guardLocalRequests, readManifest, signInPersona } from "../audit/fixtures";
import { scanCell } from "../audit/scan";
const routes = new Set(batchRoutes(Number(process.env.A11Y_BATCH ?? 0)).map(r => r.id));
test.beforeAll(async () => { await assertFixtureIdentity(await readManifest()); });
for (const cell of CELLS.filter(c => process.env.A11Y_LIST_ALL === "1" || routes.has(c.route.id))) {
  test(`persona accessibility ${cell.id}`, async ({ page }) => {
    test.setTimeout(180_000);
    try {
      const manifest = await readManifest();
      await page.setViewportSize(cell.viewport); await guardLocalRequests(page, manifest);
      await signInPersona(page, manifest, cell.persona, cell.persona === "tenant-owner" && ["beta", "hostile", "fresh"].includes(cell.route.host ?? "") ? cell.route.host : undefined);
      const record = await scanCell(page, manifest, cell);
      if (record.kind === "product" && ["home", "beta-home", "hostile-home", "fresh-home"].includes(cell.route.id)) {
        await test.step("semantic palette passes contrast for every tenant and theme", async () => {
          const pairs = await page.locator("html").evaluate(root => {
            const style = getComputedStyle(root);
            const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
            const luminance = (hex: string) => {
              const rgb = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255)
                .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
              return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
            };
            const ratio = (a: string, b: string) => {
              const x = luminance(read(a)), y = luminance(read(b));
              return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            };
            return ["background", "card", "popover", "primary", "secondary", "muted", "accent", "destructive", "sidebar", "sidebar-primary", "sidebar-accent", "success", "warning", "danger", "info"].map(name => ({ name, ratio: ratio(name, name === "background" ? "foreground" : `${name}-foreground`), minimum: 4.5 }))
              .concat(["background", "card", "popover", "sidebar"].map(name => ({ name: `focus on ${name}`, ratio: ratio(name, "ring"), minimum: 3 })));
          });
          for (const pair of pairs) expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(pair.minimum);
        });
      }
      await appendFile(process.env.A11Y_OUTPUT!, JSON.stringify(record) + "\n");
    } catch (error) {
      await appendFile(process.env.A11Y_OUTPUT!, JSON.stringify({ id: cell.id, completed: false, error: "cell_failed" }) + "\n");
      throw error;
    }
  });
}
