import { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, tenantTest as test, tenantOrigin } from "./fixtures";

test("scheduled DNS loss stops custom-host routing", async ({ page, request }) => {
  test.setTimeout(120_000);
  const local = `http://127.0.0.1:${process.env.E2E_APP_PORT}`;
  await page.goto(`${tenantOrigin("alpha")}/settings/domains`);
  await page.getByLabel("Custom subdomain").fill("app.customer.test");
  const added = page.waitForResponse((response) => response.url().endsWith("/api/settings/domains") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add custom domain" }).click();
  expect((await added).status()).toBe(200);
  const token = await page.getByTestId("challenge-token").textContent();
  const record = await page.getByTestId("challenge-record").textContent();
  expect(record).toBe("_opentenant-challenge.app.customer.test");
  expect(token).toMatch(/^opentenant-[a-f0-9]{64}$/);
  const domain = page.getByTestId("custom-domain").filter({ hasText: "app.customer.test" });
  await expect(domain.getByText("pending", { exact: true })).toBeVisible();
  await domain.getByRole("button", { name: "Verify DNS" }).click();
  await expect(domain.getByText("failed", { exact: true })).toBeVisible();
  // A failed check is announced, and the shared form relabels its submit button as the retry.
  await expect(domain.getByRole("alert").filter({ hasText: "TXT record not verified" })).toBeVisible();
  // Only the isolated test server exposes this control, in its own in-memory resolver.
  expect((await request.post(`http://127.0.0.1:${process.env.E2E_DNS_PORT}/__e2e/dns`, { data: { record, records: [[token]] } })).ok()).toBe(true);
  await domain.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(domain.getByText("active", { exact: true })).toBeVisible();
  const database = new Pool({ connectionString: process.env.CONTROL_PLANE_DATABASE_URL });
  try {
    const stored = await database.query("select tenant_id, active, verification, challenge_hash from domains where host = 'app.customer.test'");
    expect(stored.rows).toEqual([expect.objectContaining({ tenant_id: "tenant_e2e_alpha", active: true, verification: "verified" })]);
    expect(stored.rows[0].challenge_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toContain(token);
    const audit = await database.query("select tenant_id, action from audit_events where subject = 'app.customer.test' order by sequence");
    expect(audit.rows).toEqual(["domain.added", "domain.verification_checked", "domain.verification_checked"].map((action) => ({ tenant_id: "tenant_e2e_alpha", action })));
  } finally { await database.end(); }
  const resolved = await request.get(`${local}/`, { headers: { host: "app.customer.test" } });
  expect(resolved.status()).toBe(200);
  expect(await resolved.text()).toContain("Example Alpha");
  const login = await request.get(`${local}/auth/login?return=%2Fsupport`, { headers: { host: "app.customer.test" }, maxRedirects: 0 });
  expect(login.status()).toBe(302);
  expect(login.headers().location).toBe("https://alpha.example.test/auth/login?return=%2Fsupport");
  await domain.getByRole("button", { name: "Remove domain" }).click();
  await expect(domain).toHaveCount(0);
  expect((await request.get(`${local}/`, { headers: { host: "app.customer.test" } })).status()).toBe(404);

  await test.step("scheduled DNS loss stops custom-host routing", async () => {
    const host = "scheduled.customer.test";
    const record = `_opentenant-challenge.${host}`;
    const local = `http://127.0.0.1:${process.env.E2E_APP_PORT}`;
    const dns = `http://127.0.0.1:${process.env.E2E_DNS_PORT}/__e2e/dns`;
    await page.goto(`${tenantOrigin("alpha")}/settings/domains`);
    await page.getByLabel("Custom subdomain").fill(host);
    await page.getByRole("button", { name: "Add custom domain", exact: true }).click();
    const token = await page.getByTestId("challenge-token").textContent();
    expect((await request.post(dns, { data: { record, records: [[token]] } })).ok()).toBe(true);
    const domain = page.getByTestId("custom-domain").filter({ hasText: host });
    await domain.getByRole("button", { name: "Verify DNS", exact: true }).click();
    await expect(domain.getByText("active", { exact: true })).toBeVisible();
    const database = new Pool({ connectionString: process.env.CONTROL_PLANE_DATABASE_URL });
    try {
      const before = (await database.query("select next_check_at, verification_valid_until from domains where host=$1", [host])).rows[0];
      // Use the worker's existing TypeScript loader, outside Playwright's CJS transform.
      const run = async (now: Date): Promise<{ checked: number }> => {
        const { stdout } = await promisify(execFile)(process.execPath, [
          "--conditions=react-server", "--import", "../../tooling/provisioning/register.mjs", "--input-type=module", "-e", `
            import { Pool } from "pg";
            import { runCustomDomainRechecks } from "./lib/custom-domains-job.ts";
            const pool = new Pool({ connectionString: process.env.CONTROL_PLANE_DATABASE_URL });
            try {
              const result = await runCustomDomainRechecks({ pool,
                now: () => new Date(process.env.E2E_DOMAIN_CHECK_AT), stagger: async () => {},
                resolveTxt: async record => {
                  const url = new URL("http://127.0.0.1:" + process.env.E2E_DNS_PORT + "/__e2e/dns");
                  url.searchParams.set("record", record);
                  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
                  if (!response.ok) throw new Error("Test DNS unavailable");
                  return response.json();
                },
              });
              process.stdout.write(JSON.stringify(result));
            } finally { await pool.end(); }
          `,
        ], { cwd: resolve(import.meta.dirname, "../../../apps/platform"),
          env: { ...process.env, E2E_DOMAIN_CHECK_AT: now.toISOString() }, timeout: 15_000 });
        return JSON.parse(stdout);
      };
      expect(before.next_check_at.getTime()).toBeLessThan(before.verification_valid_until.getTime());
      expect((await run(new Date(before.next_check_at.getTime() - 1))).checked).toBe(0);
      expect((await run(before.next_check_at)).checked).toBe(1);
      const extended = (await database.query("select verification_valid_until from domains where host=$1", [host])).rows[0].verification_valid_until;
      expect(extended.getTime()).toBeGreaterThan(before.verification_valid_until.getTime());
      expect((await request.get(`${local}/`, { headers: { host } })).status()).toBe(200);
      expect((await request.post(dns, { data: { record, records: [] } })).ok()).toBe(true);
      expect((await run(extended)).checked).toBe(1);
      expect((await database.query("select active, recheck_reason from domains where host=$1", [host])).rows).toEqual([{ active: false, recheck_reason: "dns_unverified" }]);
      expect((await request.get(`${local}/`, { headers: { host } })).status()).toBe(404);
      const audit = (await database.query("select tenant_id, actor, detail from audit_events where subject=$1 and action='domain.reverification_checked' order by sequence", [host])).rows;
      expect(audit).toEqual([
        { tenant_id: "tenant_e2e_alpha", actor: { kind: "system", job: "custom_domain_reverify" }, detail: { verification: "verified", active: true, reason: null } },
        { tenant_id: "tenant_e2e_alpha", actor: { kind: "system", job: "custom_domain_reverify" }, detail: { verification: "failed", active: false, reason: "dns_unverified" } },
      ]);
      // Expiry alone also refuses routing, even before a scheduler has run.
      await database.query("update domains set active=true, verification='verified', verification_valid_until=now()-interval '1 second' where host=$1", [host]);
      expect((await request.get(`${local}/`, { headers: { host } })).status()).toBe(404);
    } finally { await database.end(); }
  });
});
