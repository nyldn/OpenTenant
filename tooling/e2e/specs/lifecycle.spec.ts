import { tenantTest as test, expect, signIn, tenantOrigin } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { withControl, workerOnce } from "./operations";

test.beforeEach(async () => {
  // Isolate the synthetic operator's budget from earlier journey cases while
  // keeping the production limiter active throughout this case.
  await withControl(db => db.query(`delete from request_rate_limits where key like 'tenant-creation:%'`));
});

test("suspension blocks tenant pages and APIs with 423, then resume restores access", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/admin/tenants/tenant_e2e_beta");
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByText("Status: suspended", { exact: true })).toBeVisible();
  try {
    const origin = tenantOrigin("beta");
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Tenant suspended", exact: true })).toBeVisible();
    await expect(page.getByText("Your modules", { exact: true })).toHaveCount(0);
    const response = await request.post(`http://127.0.0.1:${process.env.E2E_APP_PORT}/api/support/tickets`, { headers: { host: new URL(origin).host } });
    expect(response.status()).toBe(423);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toContain("tenant_e2e_beta");
  } finally {
    await page.goto(`${process.env.LOCAL_PUBLIC_ORIGIN}/admin/tenants/tenant_e2e_beta`);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  }
  await page.goto(tenantOrigin("beta"));
  await expect(page.getByRole("heading", { name: "Example Beta", exact: true })).toBeVisible();
});

for (const width of [390, 1440]) test(`deletion requires confirmation and undo cancels erasure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  const tenantId = "tenant_e2e_beta";
  const lifecycle = `${origin}/api/admin/tenants/${tenantId}/lifecycle`;
  const unconfirmed = await page.request.post(lifecycle, { headers: { origin }, form: { action: "delete" } });
  expect(unconfirmed.status()).toBe(400);
  await page.goto(`/admin/tenants/${tenantId}`);
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("permanent erasure");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  const confirm = dialog.getByRole("button", { name: "Delete Example Beta", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type the tenant name to confirm:").fill("Wrong tenant");
  await expect(confirm).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze()).violations).toEqual([]);
  await dialog.getByLabel("Type the tenant name to confirm:").fill("Example Beta");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Schedule deletion", exact: true })).toBeFocused();
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type the tenant name to confirm:").fill("Example Beta");
  await confirm.click();
  await expect(page.getByText("Status: deleted", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Scheduled deletion" })).toContainText("Permanent erasure is scheduled");
  const jobId = await withControl(async db => (await db.query(`select id from tenant_worker_jobs where tenant_id=$1 and kind='erase' order by created_at desc limit 1`, [tenantId])).rows[0].id);
  await page.getByRole("button", { name: "Cancel scheduled deletion", exact: true }).click();
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: jobId })).toContainText("cancelled");
  // Redeliver the old queue payload through the real worker after restoration.
  await withControl(async db => {
    await db.query(`update tenant_worker_jobs set status='pending',run_at=now() where id=$1`, [jobId]);
    await db.query(`select graphile_worker.add_job('tenant_job',payload:=$1::json,queue_name:=$2,job_key:=$3)`, [JSON.stringify({ jobId }), `tenant:${tenantId}`, `tenant-job:${jobId}`]);
  });
  await workerOnce();
  await withControl(async db => {
    expect((await db.query(`select status,database_erased_at from tenants where tenant_id=$1`, [tenantId])).rows[0]).toEqual({ status: "active", database_erased_at: null });
    expect((await db.query(`select action from audit_events where tenant_id=$1 and action='tenant.deletion_cancelled' and detail->>'jobId'=$2`, [tenantId, jobId])).rowCount).toBe(1);
  });
});
