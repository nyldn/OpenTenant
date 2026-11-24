import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { copyFile, readdir, rename, rm, stat, truncate } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test, expect, signIn } from "./fixtures";
import { withControl, workerOnce } from "./operations";

// This proof uses Better Auth, provisioned tenant fixtures and the real worker.
test("large export downloads with bounded size and cleans up on cancel", async ({ page }) => {
  test.setTimeout(300000);
  const tenantId = "tenant_e2e_beta";
  const directory = process.env.TENANT_EXPORT_DIRECTORY ?? join(homedir(), ".local/share/opentenant/tenant-exports");
  let jobId: string | undefined;
  await withControl(async db => {
    await db.query("delete from request_rate_limits where key like 'tenant-creation:%'");
    await db.query("create table export_bounds_e2e(tenant_id text not null references tenants(tenant_id),id integer not null,payload text not null,primary key(tenant_id,id))");
    // 64 MiB logical data with different MD5 blocks, rather than an all-zero
    // fixture whose compressed response would finish before cancellation.
    await db.query("insert into export_bounds_e2e select $1,i,(select string_agg(md5(i::text || ':' || j::text),'') from generate_series(1,512) j) from generate_series(1,4096) i", [tenantId]);
    await db.query("insert into export_bounds_e2e values ('tenant_e2e',0,'OTHER_TENANT_EXPORT_SENTINEL')");
    await db.query("insert into tenant_branding_assets(asset_id,tenant_id,display_name,mime_type,content) values ('asset_export_proof',$1,'Export proof','image/png',$2)", [tenantId, Buffer.from([0, 255, 128, 1])]);
  });
  try {
    await signIn(page);
    await page.goto(`/admin/tenants/${tenantId}`);
    const queued = page.waitForResponse(response => response.url().endsWith(`/api/admin/tenants/${tenantId}/lifecycle`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    expect((await queued).status()).toBe(202);
    jobId = await withControl(async db => (await db.query("select id from tenant_worker_jobs where tenant_id=$1 and kind='export' order by created_at desc limit 1", [tenantId])).rows[0].id);
    const row = page.getByRole("row").filter({ hasText: jobId! });
    await expect(row).toContainText("pending");
    await workerOnce();
    await expect(row).toContainText("completed", { timeout: 30000 });
    const link = row.getByRole("link", { name: "Download export, available for 24 hours", exact: true });
    const url = (await link.getAttribute("href"))!;
    const completed = page.waitForEvent("download"); await link.click();
    const download = await completed;
    expect(await download.failure()).toBeNull();
    const downloadedPath = (await download.path())!;
    const bytes = (await stat(downloadedPath)).size;
    expect(bytes).toBeGreaterThan(4 * 1024 ** 2); expect(bytes).toBeLessThan(2 * 1024 ** 3);
    const entries = (await promisify(execFile)("tar", ["-tzf", downloadedPath])).stdout;
    expect(entries).toContain("control.export_bounds_e2e.json"); expect(entries).toContain("control.tenant_branding_assets.json");
    const assets = JSON.parse((await promisify(execFile)("tar", ["-xOzf", downloadedPath, "control.tenant_branding_assets.json"])).stdout);
    const asset = assets.find((value: { asset_id: string }) => value.asset_id === "asset_export_proof");
    expect(Buffer.from(asset.content_base64, "base64")).toEqual(Buffer.from([0, 255, 128, 1]));
    // The database integration proof checks row contents and cross-tenant RLS.
    // Here the browser also verifies download authority is bound to the tenant.
    expect((await page.request.get(url.replace(tenantId, "tenant_e2e"))).status()).toBe(404);
    const cancelledEvent = page.waitForEvent("download"); await link.click();
    const cancelled = await cancelledEvent; await cancelled.cancel();
    expect(await cancelled.failure()).toMatch(/cancel/i);
    expect((await readdir(directory)).filter(name => name.startsWith(`.export-${jobId}-`))).toEqual([]);
    // A cancelled client must release the file without deleting a completed
    // archive or poisoning the next download.
    const retryEvent = page.waitForEvent("download"); await link.click();
    const retry = await retryEvent; expect(await retry.failure()).toBeNull();
    expect((await stat((await retry.path())!)).size).toBe(bytes);
    const archive = join(directory, `${jobId}.tar.gz`);
    const backup = `${archive}.proof-backup`;
    await copyFile(archive, backup);
    try {
      await truncate(archive, bytes - 1);
      expect(await page.evaluate(async endpoint => (await fetch(endpoint)).status, url)).toBe(404);
    } finally { await rename(backup, archive); }
    await withControl(db => db.query("update tenant_export_archives set expires_at=now()-interval '1 second' where id=$1 and tenant_id=$2", [jobId, tenantId]));
    expect(await page.evaluate(async endpoint => (await fetch(endpoint)).status, url)).toBe(404);
  } finally {
    await withControl(async db => {
      await db.query("drop table export_bounds_e2e");
      await db.query("delete from tenant_branding_assets where tenant_id=$1 and asset_id='asset_export_proof'", [tenantId]);
      if (jobId) await db.query("delete from tenant_export_archives where id=$1 and tenant_id=$2", [jobId, tenantId]);
    });
    if (jobId) await Promise.all([rm(join(directory, `${jobId}.tar.gz`), { force: true }), rm(join(directory, `${jobId}.json`), { force: true }), rm(join(directory, `${jobId}.tar.gz.proof-backup`), { force: true })]);
  }
});
