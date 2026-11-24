import { createHash } from "node:crypto";
import { Pool } from "pg";
import { CredentialCipher } from "@opentenant/database";
import { test, expect } from "./fixtures";
import { ownerToken } from "../tenants.mjs";
import { createSupportEmailDeliveryTask } from "../../../modules/support/src/delivery-worker";
import { PgSupportDeliveryStore, type SupportDeliveryTransaction } from "../../../modules/support/src/delivery-store";

// Alpha is isolated from the workspace queue used by the existing support
// list/accessibility specs. This spec uses the runner's real Mailpit fixture.
test("ticket email survives worker restart and retries once", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = "tenant_e2e_alpha";
  const origin = process.env.LOCAL_PUBLIC_ORIGIN!;
  // The local custom server builds request URLs on localhost. Use the same
  // supported tenant override as managed-support.spec.ts for same-origin POSTs.
  await page.context().addCookies([
    { name: "opentenant_dev_tenant", value: "alpha", url: origin },
    { name: "opentenant_session", value: ownerToken("alpha"), url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
  const control = new Pool({ connectionString: process.env.CONTROL_PLANE_DATABASE_URL });
  let runtime: Pool | undefined;
  let admin: Pool | undefined;
  try {
    const binding = (await control.query("select encrypted_connection from tenant_databases where tenant_id=$1", [tenantId])).rows[0];
    const connection = new CredentialCipher(process.env.TENANT_DB_ENCRYPTION_KEY!).decrypt(binding.encrypted_connection.toString("utf8"), tenantId);
    runtime = new Pool({ connectionString: connection });
    const ownerUrl = new URL(process.env.POSTGRES_ADMIN_DATABASE_URL!);
    ownerUrl.pathname = new URL(connection).pathname;
    admin = new Pool({ connectionString: ownerUrl.href });
    expect((await admin.query("select id from schema_migrations where id='tenant-support/0007_durable_email'")).rows).toHaveLength(1);
    const transaction: SupportDeliveryTransaction = async (tenant, work) => {
      const client = await runtime!.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
    };
    await transaction(tenantId, c => c.query("insert into support.delivery_preferences(tenant_id,subject_id,channel,enabled,destination_ref) values ($1,'user_e2e_alpha','email',true,'directory:alpha-owner')", [tenantId]));
    let destinationAvailable = true;
    const options = {
      withTenantDb: transaction,
      email: { host: "127.0.0.1", port: Number(process.env.IDENTITY_SMTP_PORT), from: "noreply@example.test", secure: false },
      directory: { resolveEmail: async (tenant: string, ref: string) =>
        destinationAvailable && tenant === tenantId && ref === "directory:alpha-owner"
          ? { tenantId, address: "alpha@example.test" }
          // A misbound directory entry must never reach the other tenant.
          : { tenantId: "tenant_e2e_beta", address: "beta@example.test" } },
    };
    await page.goto(`${origin}/support`);
    await page.getByLabel("Subject", { exact: true }).fill("Durable email browser proof");
    await page.getByLabel("What happened?", { exact: true }).fill("PRIVATE_TICKET_BODY stays in the portal.");
    await page.getByRole("button", { name: "Open ticket", exact: true }).click();
    await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/u);
    const ticketId = new URL(page.url()).pathname.split("/").at(-1)!;
    const ticket = (await admin.query("select ticket_number from support.tickets where id=$1", [ticketId])).rows[0];
    const number = ticket.ticket_number;
    const messages = async (event: string) => {
      const response = await fetch(`${process.env.MAILPIT_HTTP_URL}/api/v1/messages`);
      expect(response.ok).toBe(true);
      const mail = await response.json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
      return mail.messages.filter(m => m.Subject === `Support ticket ${number}: ${event}`);
    };
    // The original process claims and exits before SMTP. A new task instance
    // must recover the persisted lease using the same message identity.
    const abandoned = await new PgSupportDeliveryStore(transaction).claim(tenantId);
    expect(abandoned).toBeTruthy();
    expect(await createSupportEmailDeliveryTask(options)(tenantId)).toBe(0);
    await admin.query("update support.email_deliveries set lease_until=now()-interval '1 second' where id=$1", [abandoned!.id]);
    expect(await createSupportEmailDeliveryTask(options)(tenantId)).toBe(1);
    expect(await createSupportEmailDeliveryTask(options)(tenantId)).toBe(0);
    const created = await messages("created");
    expect(created).toHaveLength(1);
    expect(created[0]!.To.map(to => to.Address)).toEqual(["alpha@example.test"]);
    const contentResponse = await fetch(`${process.env.MAILPIT_HTTP_URL}/api/v1/message/${created[0]!.ID}`);
    const content = await contentResponse.json();
    expect(JSON.stringify(content)).toContain(createHash("sha256").update(abandoned!.idempotency_key).digest("hex"));
    expect(JSON.stringify(content)).not.toContain("PRIVATE_TICKET_BODY");

    await page.getByLabel("Reply", { exact: true }).fill("PRIVATE_REPLY_BODY stays in the portal.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("PRIVATE_REPLY_BODY stays in the portal.", { exact: true })).toBeVisible();
    destinationAvailable = false;
    await createSupportEmailDeliveryTask(options)(tenantId);
    expect(await messages("reply")).toHaveLength(0);
    await page.reload();
    const panel = page.getByRole("region", { name: "Email delivery", exact: true });
    await expect(panel).toContainText("failed");
    await expect(panel).not.toContainText("beta@example.test");
    destinationAvailable = true;
    await panel.getByRole("button", { name: "Retry email", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email queued for retry." })).toBeVisible();
    expect(await createSupportEmailDeliveryTask(options)(tenantId)).toBe(1);
    expect(await createSupportEmailDeliveryTask(options)(tenantId)).toBe(0);
    await page.reload();
    await expect(panel).toContainText("delivered");
    await expect(panel.getByRole("button", { name: "Retry email" })).toHaveCount(0);
    const replies = await messages("reply");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.To.map(to => to.Address)).toEqual(["alpha@example.test"]);
    expect(await messages("created")).toHaveLength(1);
    const audit = await admin.query("select e.actor from support.email_delivery_events e join support.email_deliveries d on d.id=e.delivery_id where d.ticket_id=$1 and e.action='manual_retry'", [ticketId]);
    expect(audit.rows).toEqual([{ actor: { kind: "user", userId: "user_e2e_alpha" } }]);
  } finally {
    await runtime?.end();
    await admin?.end();
    await control.end();
  }
});
