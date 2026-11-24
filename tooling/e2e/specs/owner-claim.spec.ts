import { test, expect } from "@playwright/test";
import { fixtureOrigin, guardLocalRequests, mailMessage, mailMessages, root, withFixtureControl } from "../audit/fixtures";
import { startTestStack } from "../../uat/test-stack.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("pending invite signup accepts membership then claims ownership once", async ({ page }) => {
  test.setTimeout(360_000);
  const stack = await startTestStack(`${root}/.uat/a1-owner-proof.log`);
  try {
    const manifest = stack.manifest;
    await guardLocalRequests(page, manifest);
    const invitation = (await mailMessages(manifest)).messages.find(m => m.To.some(to => to.Address === "pending@example.test") && m.Subject === "Your tenant invitation");
    expect(invitation).toBeTruthy();
    const mail = await mailMessage(manifest, invitation!.ID);
    const link = new URL((mail.Text as string).match(/https?:\/\/[^\s<>]+\/api\/auth\/better-auth\/login\?[^\s<>]+/)![0]);
    const gatewayOrigin = fixtureOrigin(manifest, "pending");
    const gatewayProbe = await page.request.post(`${gatewayOrigin}/api/auth/better-auth/login`, { headers: { origin: gatewayOrigin, accept: "application/json" }, form: { email: "pending@example.test", password: "incorrect-password" } });
    expect([400, 403]).toContain(gatewayProbe.status());
    console.info(`A1 owner stage: ${gatewayProbe.status() === 403 ? "fixture_origin_adaptation_rejected" : "fixture_origin_accepted"}`);
    // Test the application at its real listener too. B0's UAT gateway rewrites
    // Origin to localhost, unlike a browser or SSH forward. Do not relax the
    // application's same-origin check to accommodate that fixture transform.
    link.port = String(manifest.ports.next);
    const directProbe = await page.request.post(`${link.origin}/api/auth/better-auth/login`, { headers: { origin: link.origin, accept: "application/json" }, form: { email: "pending@example.test", password: "incorrect-password" } });
    expect(directProbe.status()).toBe(400);
    console.info("A1 owner stage: direct_origin_accepted");
    // The historical pending fixture already owns an account. This receipt
    // distinguishes duplicate signup from origin/cookie or invitation failures.
    await withFixtureControl(async db => {
      expect((await db.query("select count(*)::int as count from ba_user where email='pending@example.test'")).rows[0].count).toBe(1);
    });
    console.info("A1 owner stage: fixture_account_already_exists");
    await page.goto(link.href);
    await page.getByText("Create an account", { exact: true }).click();
    const signup = page.locator("details form");
    await signup.getByLabel("Name", { exact: true }).fill("Example Pending Owner");
    await signup.getByLabel("Email", { exact: true }).fill("pending@example.test");
    await signup.getByLabel("Password", { exact: true }).fill("synthetic-owner-password-123");
    const receipt = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/better-auth/login" && response.request().method() === "POST");
    await signup.getByRole("button", { name: "Create account", exact: true }).click();
    const signupResponse = await receipt;
    console.info(`A1 owner stage: ${signupResponse.status() === 403 ? "signup_origin_rejected" : signupResponse.ok() ? "signup_completed" : "signup_account_rejected"}`);
    expect(signupResponse.status()).toBe(400);
    await expect(page.getByRole("alert").filter({ hasText: "sign in" })).toBeVisible();
    await expect(signup.getByLabel("Email", { exact: true })).toHaveValue("pending@example.test");
    await expect(signup.getByLabel("Password", { exact: true })).toHaveValue("");
    expect(link.searchParams.get("return")).toBe("/admin/tenants/tenant_uat_pending/owner-claim");
    // A fresh account is a separate branch of the same real invitation journey.
    // Remove only this synthetic unused account, preserving the invitation.
    await withFixtureControl(async db => {
      await db.query("delete from ba_user where email='pending@example.test'");
    });
    await signup.getByLabel("Password", { exact: true }).fill("synthetic-owner-password-123");
    await signup.getByRole("button", { name: /Try again|Create account/ }).click();
    await expect(page.getByRole("heading", { name: "Claim tenant ownership" })).toBeVisible();
    await expect(page.getByText("Owner claim token", { exact: true })).toBeVisible();
    await withFixtureControl(async db => {
      expect((await db.query("select status from ba_invitation where id=$1", [link.searchParams.get("invitation")])).rows[0].status).toBe("accepted");
      expect((await db.query(`select count(*)::int as count from ba_session s join ba_user u on u.id=s."userId" join ba_member m on m."userId"=u.id and m."organizationId"=s."activeOrganizationId" join identity_org_mappings o on o.external_organization_id=m."organizationId" where u.email='pending@example.test' and o.tenant_id='tenant_uat_pending' and m.role='member'`)).rows[0].count).toBeGreaterThan(0);
    });
    console.info("A1 owner stage: invitation_accepted_active_org_bound");
    // Retry the same invitation with the now-existing account and known password.
    const pendingOrigin = link.origin;
    await page.request.post(`${pendingOrigin}/api/auth/better-auth/sign-out`, { headers: { origin: pendingOrigin } });
    await page.goto(link.href);
    const login = page.locator("main > form").first();
    await login.getByLabel("Email", { exact: true }).fill("pending@example.test");
    await login.getByLabel("Password", { exact: true }).fill("synthetic-owner-password-123");
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Owner claim token", { exact: true })).toBeVisible();
    console.info("A1 owner stage: existing_account_retry_bound");
    // The operator supplies the separate token, never the identity invitation ID.
    const { readFile } = await import("node:fs/promises");
    const { glob } = await import("node:fs/promises");
    let token = "";
    const invite = await withFixtureControl(async db => (await db.query("select id from tenant_owner_invites where tenant_id='tenant_uat_pending' and revoked_at is null")).rows[0]);
    const files: string[] = [];
    for await (const file of glob(join(tmpdir(), "opentenant-uat-*", "invites", `${invite.id}.json`))) files.push(file);
    expect(files).toHaveLength(1);
    const delivery = JSON.parse(await readFile(files[0]!, "utf8"));
    expect(delivery.tenantId).toBe("tenant_uat_pending");
    expect(delivery.email).toBe("pending@example.test");
    token = delivery.token;
    expect(Boolean(token)).toBe(true);
    const origin = link.origin;
    const endpoint = `${origin}/api/admin/tenants/tenant_uat_pending/owner-claim`;
    const submitClaim = () => page.request.post(endpoint, { form: { token }, headers: { origin, accept: "application/json" } });
    const wrongTenant = await page.request.post(`${origin}/api/admin/tenants/tenant_e2e_alpha/owner-claim`, { form: { token }, headers: { origin } });
    expect(wrongTenant.status()).toBe(403);
    await withFixtureControl(async db => { await db.query("update tenant_owner_invites set expires_at=now()-interval '1 second' where id=$1", [invite.id]); });
    expect((await submitClaim()).status()).toBe(400);
    await withFixtureControl(async db => { await db.query("update tenant_owner_invites set expires_at=now()+interval '72 hours',email='other@example.test' where id=$1", [invite.id]); });
    expect((await submitClaim()).status()).toBe(400);
    await withFixtureControl(async db => { await db.query("update tenant_owner_invites set email='pending@example.test' where id=$1", [invite.id]); });
    await page.getByLabel("Owner claim token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Claim ownership", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Ownership granted", { timeout: 60_000 });
    await withFixtureControl(async db => {
      expect((await db.query("select count(*)::int as count from tenant_owner_invites where id=$1 and consumed_at is not null and granted_at is not null", [invite.id])).rows[0].count).toBe(1);
    });
    console.info("A1 owner stage: owner_grant_completed");
    await page.getByRole("link", { name: "Open tenant", exact: true }).click();
    await expect(page.getByText("Your modules", { exact: true })).toBeVisible();
    const replay = await page.request.post(`${origin}/api/admin/tenants/tenant_uat_pending/owner-claim`, { form: { token }, headers: { origin, accept: "application/json" } });
    expect(replay.status()).toBe(400);
  } finally { await stack.dispose(); }
});
