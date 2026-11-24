/** Real application email composition, PostgreSQL and SMTP. No provider mocks. */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgAccountLinkStore, PgTenantOrgResolver } from "@opentenant/database";
import type { TenantId } from "@opentenant/auth";
import { SmtpEmailTransport } from "../../notifications/src/smtp";
import { createSupportDeliveryService } from "../../../modules/support/src/email-delivery";
import { InMemorySupportDepthStore } from "../../../modules/support/src/support-depth-store";
import { betterAuthMailHooks } from "../../auth-better-auth/src/mail";
import { createBetterAuth } from "../../auth-better-auth/src/runtime";
import { BetterAuthIdentityGateway } from "../../auth-better-auth/src/gateway";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";

const databaseUrl = integrationDatabaseUrl("PROVISIONING_CONTROL_DATABASE_URL");
const required = process.env.MAILPIT_REQUIRED === "1";
const api = process.env.MAILPIT_HTTP_URL;
if (required && (!databaseUrl || !api)) throw new Error("SMTP proof requires Mailpit and an ephemeral control database");
const identitySecret = "synthetic-smtp-proof-identity-secret-over-32-chars";
const password = "synthetic-smtp-proof-password";
const smtpPassword = "synthetic-smtp-auth-password";
const runId = randomUUID();
const recipient = `verify-${runId}@example.test`;
const invitee = `invite-${runId}@example.test`;
const tenantId = "ten_smtp_proof" as TenantId;
const baseURL = "http://localhost:3000";

async function message(to: string, subject: string) {
  const url = new URL(api!);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password) throw new Error("Mailpit must be loopback HTTP");
  const get = async (path: string) => {
    const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(3000) });
    expect(response.ok).toBe(true);
    return response;
  };
  const list = await (await get("/api/v1/messages")).json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
  const record = list.messages.find(m => m.Subject === subject && m.To.some(r => r.Address === to));
  expect(record).toBeDefined();
  const detail = await (await get(`/api/v1/message/${record!.ID}`)).json() as { Subject: string; To: Array<{ Address: string }>; HTML: string; Text: string };
  expect(detail.Subject).toBe(subject);
  expect(detail.To.map(r => r.Address)).toEqual([to]);
  const raw = await (await get(`/api/v1/message/${record!.ID}/raw`)).text();
  const headers = raw.split(/\r?\n\r?\n/, 1)[0]!;
  for (const secret of [identitySecret, password, smtpPassword]) expect(headers).not.toContain(secret);
  expect(headers).not.toMatch(/^(?:authorization|cookie|set-cookie|x-api-key):/im);
  // Verification and invitation tokens belong only in the body URL.
  for (const token of detail.Text.matchAll(/[?&](?:token|invitation)=([^&\s]+)/g)) expect(headers).not.toContain(token[1]);
  return { ...detail, Text: detail.Text.replaceAll("\r\n", "\n") };
}

describe.skipIf(!required && (!api || !databaseUrl))("application email paths via real Mailpit", () => {
  let pool: Pool;
  let auth: ReturnType<typeof createBetterAuth>;
  let gateway: BetterAuthIdentityGateway;
  let accounts: PgAccountLinkStore;
  let owner: string;
  const transport = new SmtpEmailTransport({ host: "127.0.0.1", port: Number(process.env.MAILPIT_SMTP_PORT ?? 11026), secure: false, from: "notifications@example.test", auth: { user: "synthetic-smtp-user", pass: smtpPassword } });
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const directory = new URL("../../../tooling/migrations/sql/control-plane/", import.meta.url);
    for (const file of readdirSync(directory).filter(f => f.endsWith(".sql")).sort()) await pool.query(readFileSync(new URL(file, directory), "utf8"));
    await pool.query("insert into tenants (tenant_id, slug, display_name, status, data_region) values ($1,'smtp-proof','SMTP proof','active','us')", [tenantId]);
    const hooks = betterAuthMailHooks(transport, baseURL);
    auth = createBetterAuth(pool, { baseURL, secret: identitySecret, production: false }, hooks);
    accounts = new PgAccountLinkStore(pool, "better-auth");
    gateway = new BetterAuthIdentityGateway(auth, pool, new PgTenantOrgResolver(pool, "better-auth"), accounts, hooks);
    owner = (await auth.api.signUpEmail({ body: { email: recipient, name: "Synthetic Owner", password } })).user.id;
  }, 120_000);
  afterAll(async () => { await pool?.end(); });

  it("delivers Support service email with rendered HTML/text and secret-free headers", async () => {
    const store = new InMemorySupportDepthStore();
    const ticketNumber = `SUP-${runId}`;
    store.seedTicket({ tenantId, ticketId: "ticket_proof", ticketNumber, requesterId: "requester", status: "open", priority: "medium", version: 1, createdAt: new Date().toISOString() });
    const support = createSupportDeliveryService(store, { email: transport, directory: { resolveEmail: async id => id === tenantId ? { tenantId, address: recipient } : null } });
    const authority = { tenantId, actorId: "admin", kind: "tenant_admin" as const, permissions: ["support.ticket.manage"] };
    await support.setDeliveryPreference(authority, { subjectId: "requester", channel: "email", enabled: true, destinationRef: "directory:requester" });
    const request = { ticketId: "ticket_proof", ticketVersion: 1, channel: "email" as const, event: "reply" as const };
    expect(await support.deliver(authority, request)).toMatchObject({ status: "delivered" });
    const email = await message(recipient, `Support ticket ${ticketNumber}: reply`);
    for (const body of [email.HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""), email.Text]) {
      expect(body).toContain(`Support ticket ${ticketNumber}`);
      expect(body).toContain("Your support ticket has an update: reply.");
      expect(body).toContain("Open your support portal to view the ticket.");
    }
    expect(store.attempts).toHaveLength(1);
  });
  it("sends Better Auth signup verification through notifications and verifies its body URL", async () => {
    const email = await message(recipient, "Verify your email");
    expect(email.Text).toContain("Verify your email\nhttp://localhost:3000/api/auth/better-auth/verify-email?token=");
    expect(email.HTML).toBe(""); // Identity templates deliberately render plain text.
    const link = email.Text.match(/http:\/\/[^\s]+/)![0];
    const response = await auth.handler(new Request(link));
    expect(response.status).toBeLessThan(400);
    expect((await pool.query('select "emailVerified" from ba_user where id=$1', [owner])).rows[0].emailVerified).toBe(true);
  });
  it("sends a persisted Better Auth gateway invitation through notifications", async () => {
    const org = await gateway.createOrganization("SMTP proof organisation");
    await pool.query("insert into identity_org_mappings values ($1,'better-auth',$2)", [tenantId, org]);
    const invitedBy = await accounts.userIdForExternalSubject(owner, recipient, "Synthetic Owner");
    await gateway.invite({ tenantId, email: invitee, role: "tenant_member", invitedBy });
    const invitation = (await pool.query('select id from ba_invitation where email=$1 and "organizationId"=$2 and status=\'pending\'', [invitee, org])).rows[0];
    const email = await message(invitee, "Your tenant invitation");
    expect(email.Text.trim()).toBe(`Your tenant invitation\n${baseURL}/api/auth/better-auth/login?invitation=${invitation.id}`);
    expect(email.HTML).toBe("");
  });
});
