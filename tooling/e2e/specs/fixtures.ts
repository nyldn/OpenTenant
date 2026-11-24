import { test as base, expect } from "@playwright/test";
import { ownerToken, tenants } from "../tenants.mjs";

export function tenantOrigin(slug: string) {
  return `http://${slug}.example.test:${process.env.E2E_APP_PORT}`;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Browser requests also stay on loopback, including a synthetic unknown host.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1", "unknown.example.test", "onboard.example.test", ...tenants.map(({ slug }) => `${slug}.example.test`)].includes(url.hostname)
        ? route.continue() : route.abort("blockedbyclient");
    });
    await use(page);
  },
});

export const tenantTest = test.extend({
  context: async ({ context }, use) => {
    for (const { slug } of tenants) {
      await context.addCookies([{
        name: "opentenant_session", value: ownerToken(slug), url: tenantOrigin(slug),
        httpOnly: true, sameSite: "Lax",
      }]);
    }
    await use(context);
  },
});
export { expect };

export async function signIn(page: import("@playwright/test").Page) {
  if (process.env.E2E_PHASE === "legacy") {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
  } else {
    await page.context().addCookies([{ name: "opentenant_session", value: ownerToken("workspace"), url: process.env.LOCAL_PUBLIC_ORIGIN!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/");
  }
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
