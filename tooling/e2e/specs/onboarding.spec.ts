import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, signIn, tenantOrigin } from "./fixtures";
import { inspectProvisionedDatabase } from "../provisioned-database";
import { withControl, workerOnce } from "./operations";

test("installation owner provisions a tenant, invitee claims ownership, and modules load", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await page.goto("/admin/tenants/new");
  await page.getByLabel("Owner email").fill("onboard@example.test");
  await page.getByLabel("Display name").fill("Example Onboard");
  await page.getByLabel("Slug").fill("onboard");
  await page.getByLabel("Data region").selectOption("eu");
  const queued = page.waitForResponse(r => r.url().endsWith("/api/admin/tenants") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create tenant", exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(202);
  const location = response.headers().location!;
  expect(location).toMatch(/^\/admin\/tenants\/ten_[a-f0-9-]+$/u);
  const tenantId = location.split("/").at(-1)!;
  await expect(page).toHaveURL(new RegExp(`/admin/tenants/${tenantId}$`));
  const jobId = await withControl(async db => (await db.query("select id from tenant_worker_jobs where tenant_id=$1 and kind='provision'", [tenantId])).rows[0].id);
  await workerOnce();
  await page.reload();
  await expect(page.getByText("Status: active", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: jobId })).toContainText("completed");
  const delivery = await withControl(async db => {
    // Explicit installation entitlements are configuration, separate from the
    // production job's migrations, grants, activation and credential custody.
    await db.query("insert into tenant_modules(tenant_id,module_key,module_version,enabled) select $1,module_key,version,true from module_catalog where enabled_by_default", [tenantId]);
    const proof = await inspectProvisionedDatabase(db, tenantId);
    expect(proof).toEqual({ schemas: ["brain", "support", "tenant_core"], role: { rolsuper: false, rolbypassrls: false } });
    const invite = await db.query("select id from tenant_owner_invites where tenant_id=$1", [tenantId]);
    const identity = await db.query('select id from ba_invitation where email=$1 and status=\'pending\'', ["onboard@example.test"]);
    const claim = JSON.parse(await readFile(join(process.env.TENANT_OWNER_INVITE_DIRECTORY!, `${invite.rows[0].id}.json`), "utf8"));
    return { ...claim, invitationId: identity.rows[0].id };
  });
  const context = await browser.newContext();
  const invitee = await context.newPage();
  try {
    const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
    await context.addCookies([{ name: "opentenant_dev_tenant", value: "onboard", url: origin }]);
    const signup = await context.request.post(`${origin}/api/auth/better-auth/login?return=/`, {
      headers: { origin }, form: { name: "Example Invitee", email: "onboard@example.test", password: process.env.E2E_PASSWORD!, action: "signup", invitation: delivery.invitationId },
    });
    expect(signup.ok()).toBe(true);
    await invitee.goto(origin);
    await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    await withControl(async db => {
      const role = await db.query('select role from ba_member m join identity_org_mappings o on o.external_organization_id=m."organizationId" where o.tenant_id=$1', [tenantId]);
      expect(role.rows).toEqual([{ role: "member" }]);
    });
    await invitee.goto(`${origin}${delivery.claimPath}`);
    await invitee.getByLabel("Owner claim token").fill(delivery.token);
    const granted = invitee.waitForResponse(r => r.url().endsWith("/owner-claim") && r.request().method() === "POST");
    await invitee.getByRole("button", { name: "Claim ownership" }).click();
    expect((await granted).status()).toBe(202);
    await workerOnce();
    await invitee.goto(`${origin}/settings/members`);
    await expect(invitee.getByRole("row").filter({ hasText: "onboard@example.test" })).toContainText("tenant_owner");
    await invitee.goto(origin);
    await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    for (const path of ["/assessment", "/support"]) {
      if (path === "/assessment") await expect(invitee.locator(`a[href="${path}"]`).first()).toBeVisible();
      expect((await invitee.goto(`${origin}${path}`))?.status()).toBe(200);
      await expect(invitee).toHaveURL(`${origin}${path}`);
      if (path === "/assessment") await expect(invitee.getByLabel("Client / organization", { exact: true })).toBeVisible();
      else await expect(invitee.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
      await expect(invitee.locator("body")).not.toContainText("Internal Server Error");
      await invitee.goto(origin);
    }
    // The same signed owner session also resolves through the verified host.
    const sessionCookie = (await context.cookies()).find(c => c.name === "opentenant_session")!;
    await context.addCookies([{ name: sessionCookie.name, value: sessionCookie.value, url: tenantOrigin("onboard"), httpOnly: true, sameSite: "Lax" }]);
    await invitee.goto(tenantOrigin("onboard"));
    await expect(invitee.getByText("Your modules", { exact: true })).toBeVisible();
    const replay = await context.request.post(`${origin}${delivery.claimPath.replace("/admin/", "/api/admin/")}`, { form: { token: delivery.token }, headers: { origin } });
    expect(replay.status()).toBe(400);
    await withControl(async db => {
      const audit = await db.query("select action from audit_events where tenant_id=$1", [tenantId]);
      expect(audit.rows.map(r => r.action)).toEqual(expect.arrayContaining(["tenant.created", "tenant.provisioned", "tenant.owner_invite_claimed", "tenant.owner_bootstrapped"]));
      const jobs = await db.query("select status from tenant_worker_jobs where tenant_id=$1", [tenantId]);
      expect(jobs.rows).toEqual([{ status: "completed" }, { status: "completed" }]);
    });
  } finally { await context.close(); }
});
