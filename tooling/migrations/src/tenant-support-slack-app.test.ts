import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../sql/tenant-support/0005_slack_app_contracts.sql", import.meta.url),
);

describe("tenant support Slack app migration", () => {
  it("installation- and tenant-binds provider-independent records under forced RLS", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "slack_app_connections",
      "slack_app_channels",
      "slack_ticket_threads",
      "slack_identity_mappings",
      "slack_action_receipts",
    ]) {
      expect(sql).toContain(`alter table support.${table} enable row level security`);
      expect(sql).toContain(`alter table support.${table} force row level security`);
      expect(sql).toContain(`create policy ${table}_isolation`);
    }
    expect(sql).toContain("unique (installation_id, tenant_id, id)");
    expect(sql).toContain("foreign key (installation_id, tenant_id, connection_id)");
    expect(sql).toContain(
      "foreign key (installation_id, tenant_id, connection_id, channel_id)",
    );
    expect(sql).toContain("foreign key (tenant_id, ticket_id) references support.tickets (tenant_id, id)");
  });

  it("keeps provider credentials and mutable authority out of the contracts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|bot_token|oauth_code)\b/i);
    expect(sql).not.toContain("provider_permissions");
    expect(sql).toContain("create trigger slack_action_receipts_no_update_delete");
    expect(sql).toContain("revoke update, delete on support.slack_action_receipts from tenant_app");
  });
});
