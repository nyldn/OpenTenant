import { test, expect, signIn } from "./fixtures";
import { withControl, workerOnce } from "./operations";

test.beforeEach(async () => {
  // Each journey starts with its own synthetic mutation budget. Production
  // limits remain active for every request made within the case.
  await withControl(db => db.query(`delete from request_rate_limits where key like 'tenant-creation:%'`));
});

for (const width of [390, 1440]) test(`queued job reaches completed without reload at ${width}px, retries failed work, and stops on permission revocation`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  test.setTimeout(300000);
  await signIn(page);
  await page.goto("/admin/tenants/new");
  await page.getByLabel("Owner email").fill("progress@example.test");
  await page.getByLabel("Display name").fill("Example Progress");
  await page.getByLabel("Slug").fill(`progress-${width}`);
  await page.getByLabel("Data region").selectOption("eu");
  const queued = page.waitForResponse(response => response.url().endsWith("/api/admin/tenants") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create tenant", exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(202);
  const location = response.headers().location!;
  const tenantId = location.split("/").at(-1)!;
  await expect(page).toHaveURL(new RegExp(`${location}$`));
  const endpoint = `/api/admin/tenants/${tenantId}/jobs`;
  let unavailable = true;
  await page.route(`**${endpoint}`, async route => {
    if (unavailable) { unavailable = false; await route.fulfill({ status: 503, body: "Temporarily unavailable" }); }
    else await route.continue();
  });
  const jobId = await withControl(async db => (await db.query(`select id from tenant_worker_jobs where tenant_id=$1 and kind='provision'`, [tenantId])).rows[0].id);
  const row = page.getByRole("row").filter({ hasText: jobId });
  await expect(row).toContainText("pending");
  const statusError = page.getByRole("main").getByRole("alert");
  await expect(statusError).toContainText("Live status is temporarily unavailable");
  await page.evaluate(() => { Object.assign(window, { progressDocument: "same-document" }); });
  let documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents += 1; });
  // The synthetic failure is persisted just as worker reconciliation persists it.
  await withControl(async db => { await db.query(`update tenant_worker_jobs set status='failed',last_error='tenant_job_failed',attempts=5 where id=$1`, [jobId]); });
  await expect(row).toContainText("failed");
  await expect(statusError).toHaveCount(0);
  await row.getByRole("button", { name: "Retry job", exact: true }).click();
  await expect(row).toContainText("pending");
  await workerOnce();
  await expect(row).toContainText("completed", { timeout: 30000 });
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { progressDocument: string }).progressDocument)).toBe("same-document");
  expect(documents).toBe(0);
  await expect(page.getByRole("status").filter({ hasText: "provision: completed" })).toHaveCount(1);
  const status = await page.request.get(endpoint);
  expect(status.headers()["cache-control"]).toBe("no-store");
  const body = await status.json();
  expect(Object.keys(body.jobs[0]).sort()).toEqual(["attempts", "id", "kind", "status"]);
  await withControl(async db => { expect((await db.query(`select action from audit_events where tenant_id=$1 and action='tenant.job_retried'`, [tenantId])).rowCount).toBe(1); });
  let polls = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === endpoint) polls += 1; });
  await page.waitForTimeout(4500);
  expect(polls).toBe(0);
  // Start export work, then revoke the installation grant. Every poll must
  // reauthorize, remove stale tenant data, and stop after the first denial.
  // Every cached job is terminal, and the post-action refresh fails once.
  // Polling must still resume and show the queued export without a reload.
  unavailable = true;
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "export" })).toContainText("pending", { timeout: 15000 });
  expect(documents).toBe(0);
  await page.context().clearCookies();
  await expect(page.getByRole("heading", { name: "Tenant unavailable", exact: true })).toBeVisible();
  await expect(page.getByText("Check your access.", { exact: false })).toBeVisible();
  expect((await page.request.get(endpoint)).status()).toBe(403);
  polls = 0;
  await page.waitForTimeout(4500);
  expect(polls).toBe(0);
});
