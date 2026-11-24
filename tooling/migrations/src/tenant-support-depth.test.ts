import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../sql/tenant-support/0004_support_depth.sql", import.meta.url),
);

describe("tenant support depth migration", () => {
  it("binds canonical depth records to tenant tickets under forced RLS", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "delivery_preferences",
      "delivery_attempts",
      "attachments",
      "sla_policies",
      "sla_states",
      "csat_responses",
      "depth_events",
    ]) {
      expect(sql).toContain(`alter table support.${table} enable row level security`);
      expect(sql).toContain(`alter table support.${table} force row level security`);
      expect(sql).toContain(`create policy ${table}_isolation`);
    }
    expect(sql.match(/references support\.tickets \(tenant_id, id\)/g)).toHaveLength(4);
    expect(sql).toContain(
      "foreign key (tenant_id, ticket_id, ticket_version) references support.outbox_events (tenant_id, ticket_id, ticket_version)",
    );
    expect(sql).toContain(
      "foreign key (tenant_id, retry_of) references support.delivery_attempts (tenant_id, id)",
    );
    expect(sql).toContain("attempt_number smallint not null check (attempt_number between 1 and 3)");
    expect(sql).toContain("unique (tenant_id, retry_of)");
    expect(sql).toContain("create trigger delivery_attempts_validate");
    expect(sql).toContain("new.attempt_number <> parent_attempt_number + 1");
    expect(sql).toContain("accumulated_paused_minutes numeric");
    expect(sql).toContain("state text not null check (state in ('running', 'paused', 'stopped'))");
    expect(sql).toContain("create trigger sla_states_guard_update");
  });

  it("keeps addresses, URLs, bytes, and mutable evidence out of canonical contracts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("destination_ref !~* '(^https?:|@)'");
    expect(sql).toContain("object_ref !~* '(^https?:|\\.\\.)'");
    expect(sql).toContain("byte_size bigint not null check (byte_size between 1 and 10485760)");
    expect(sql).toContain("constraint depth_events_content_free check");
    for (const table of ["delivery_attempts", "attachments", "csat_responses", "depth_events"]) {
      expect(sql).toContain(`create trigger ${table}_no_update_delete`);
      expect(sql).toContain(`revoke update, delete on support.${table} from tenant_app`);
    }
  });
});
