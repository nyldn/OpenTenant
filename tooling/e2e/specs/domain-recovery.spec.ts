import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, readManifest, root, signInPersona, withFixtureControl, type UatManifest } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
let stack: Awaited<ReturnType<typeof startTestStack>>;
let manifest: UatManifest;
test.beforeAll(async () => { test.setTimeout(240_000); stack = await startTestStack(`${root}/.uat/s1-domain.log`); manifest = await readManifest();

});
test.afterAll(async () => { await stack?.dispose(); });
test.beforeEach(async ({ page }) => { await guardLocalRequests(page, manifest); });

test("lost TXT challenge can be reissued after navigation and failed verification", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInPersona(page, manifest, "tenant-owner");
  const origin = fixtureOrigin(manifest, "alpha");
  await page.goto(`${origin}/settings/domains`);
  await page.getByLabel("Custom subdomain").fill("recover.customer.test");
  await page.getByRole("button", { name: "Add custom domain", exact: true }).click();
  const oldToken = await page.getByTestId("challenge-token").textContent();
  await page.goto(`${origin}/settings`); await page.goto(`${origin}/settings/domains`);
  const domain = page.getByTestId("custom-domain").filter({ hasText: "recover.customer.test" });
  await expect(domain).toContainText("_opentenant-challenge.recover.customer.test");
  await domain.getByRole("button", { name: "Verify DNS", exact: true }).click();
  await expect(domain).toContainText("failed");
  await page.reload(); await expect(domain).toContainText("failed");
  await domain.getByRole("button", { name: "Reissue TXT challenge", exact: true }).click();
  const token = await page.getByTestId("challenge-token").textContent();
  expect(token).not.toBe(oldToken);
  const record = "_opentenant-challenge.recover.customer.test";
  const dns = `http://127.0.0.1:${manifest.ports.dns}/__e2e/dns`;
  expect((await request.post(dns, { data: { record, records: [[oldToken]] } })).ok()).toBe(true);
  await domain.getByRole("button", { name: "Verify DNS", exact: true }).click();
  await expect(domain).toContainText("failed");
  expect((await request.post(dns, { data: { record, records: [[token]] } })).ok()).toBe(true);
  await domain.getByRole("button", { name: "Verify DNS", exact: true }).click();
  await expect(domain.getByText("active", { exact: true })).toBeVisible();
  await withFixtureControl(async db => {
    expect((await db.query("select action from audit_events where subject=$1", ["recover.customer.test"])).rows).toContainEqual({ action: "domain.challenge_reissued" });
    await db.query("update domains set challenge_expires_at=now()-interval '1 hour' where host=$1", ["recover.customer.test"]);
  });
  await domain.getByRole("button", { name: "Reissue TXT challenge", exact: true }).click();
  await expect(domain.getByText("pending", { exact: true })).toBeVisible();
  await withFixtureControl(async db => {
    const row = (await db.query("select * from domains where host=$1", ["recover.customer.test"])).rows[0];
    expect(row.active).toBe(false); expect(row.verified_at).toBeNull(); expect(row.verification_valid_until).toBeNull(); expect(row.next_check_at).toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
  });
  await signInPersona(page, manifest, "tenant-owner", "beta");
  const denied = await page.request.post(`${fixtureOrigin(manifest, "beta")}/api/settings/domains`, { headers: { origin: fixtureOrigin(manifest, "beta") }, form: { action: "reissue", host: "recover.customer.test" } });
  expect(denied.status()).toBe(400); expect(await denied.text()).not.toContain(token!);
});
