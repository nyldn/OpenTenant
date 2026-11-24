import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("TENANT_SUPPORT_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function migrationsIn(catalog: string): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", catalog);
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => ({
    id: `${catalog}/${name.replace(/\.sql$/u, "")}`,
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

const envelope = {
  schemaVersion: 1,
  tenantId: "ten_alpha",
  ticketNumber: "SUP-000001",
  ticketVersion: 1,
  kind: "created",
  status: "open",
  priority: "medium",
  category: "other",
  assignedRef: null,
  openedAt: "2026-07-27T09:00:00.000Z",
  updatedAt: "2026-07-27T09:00:00.000Z",
  occurredAt: "2026-07-27T09:00:00.000Z",
};

describeIntegration("tenant-support ticket version and outbox against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });
  let ticketId = "";

  beforeAll(async () => {
    await pool.query("drop schema if exists support cascade");
    await pool.query("drop schema if exists tenant_core cascade");
    await pool.query("drop table if exists schema_migrations");
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'tenant_app') then
          create role tenant_app nologin;
        end if;
      end $$;
    `);
    await applyMigrations(pool, await migrationsIn("tenant-core"));
    await applyMigrations(pool, await migrationsIn("tenant-support"));
    await pool.query(
      `insert into tenant_core.tenant_meta (tenant_id, data_region)
       values ('ten_alpha', 'us')`,
    );
    const { rows } = await pool.query<{ id: string }>(
      `insert into support.tickets (tenant_id, ticket_number, created_by, subject, description, category)
       values ('ten_alpha', 'SUP-000001', 'user_1', 'subject', 'description', 'other')
       returning id`,
    );
    ticketId = rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("defaults new tickets to canonical version 1", async () => {
    const { rows } = await pool.query<{ version: string }>(
      `select version from support.tickets where id = $1`,
      [ticketId],
    );
    expect(Number(rows[0]!.version)).toBe(1);
  });

  it("only lets the canonical version advance by exactly one", async () => {
    await pool.query(
      `update support.tickets set version = version + 1 where id = $1`,
      [ticketId],
    );
    await expect(
      pool.query(`update support.tickets set version = version + 5 where id = $1`, [ticketId]),
    ).rejects.toThrow("must advance by exactly one");
    await expect(
      pool.query(`update support.tickets set version = version - 1 where id = $1`, [ticketId]),
    ).rejects.toThrow("must advance by exactly one");
  });

  it("accepts a queue-metadata envelope and denies content keys structurally", async () => {
    await pool.query(
      `insert into support.outbox_events (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
       values ('ten_alpha', $1, 'SUP-000001', 1, 'created', $2::jsonb)`,
      [ticketId, JSON.stringify(envelope)],
    );
    for (const denied of ["subject", "body", "description", "message", "attachments"]) {
      await expect(
        pool.query(
          `insert into support.outbox_events (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
           values ('ten_alpha', $1, 'SUP-000001', 99, 'created', $2::jsonb)`,
          [ticketId, JSON.stringify({ ...envelope, [denied]: "leaked" })],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("enforces one event per canonical ticket version", async () => {
    await expect(
      pool.query(
        `insert into support.outbox_events (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
         values ('ten_alpha', $1, 'SUP-000001', 1, 'created', $2::jsonb)`,
        [ticketId, JSON.stringify(envelope)],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("keeps event identity and payload append-only", async () => {
    await expect(
      pool.query(`update support.outbox_events set payload = '{}'::jsonb where ticket_version = 1`),
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(`update support.outbox_events set ticket_version = 50 where ticket_version = 1`),
    ).rejects.toThrow("append-only");
  });

  it("allows delivery-state transitions but freezes terminal states", async () => {
    await pool.query(
      `update support.outbox_events set claimed_at = now(), attempts = attempts + 1
       where ticket_version = 1`,
    );
    await pool.query(
      `update support.outbox_events set status = 'delivered', delivered_at = now()
       where ticket_version = 1`,
    );
    await expect(
      pool.query(`update support.outbox_events set status = 'pending' where ticket_version = 1`),
    ).rejects.toThrow("terminal status is immutable");
  });

  it("rejects an unknown event kind and a non-positive version", async () => {
    await expect(
      pool.query(
        `insert into support.outbox_events (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
         values ('ten_alpha', $1, 'SUP-000001', 3, 'exfiltrate', $2::jsonb)`,
        [ticketId, JSON.stringify(envelope)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        `insert into support.outbox_events (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
         values ('ten_alpha', $1, 'SUP-000001', 0, 'created', $2::jsonb)`,
        [ticketId, JSON.stringify(envelope)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("denies tenant_app deletes on the outbox while RLS stays forced", async () => {
    const { rows } = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where oid = 'support.outbox_events'::regclass`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const { rows: grants } = await pool.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'tenant_app'
          and table_schema = 'support' and table_name = 'outbox_events'`,
    );
    const privileges = grants.map((grant) => grant.privilege_type).sort();
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("SELECT");
    expect(privileges).toContain("UPDATE");
    expect(privileges).not.toContain("DELETE");
  });

  it("binds support delivery attempts to canonical outbox versions and a bounded retry chain", async () => {
    const rootAttempt = "00000000-0000-4000-8000-000000000801";
    const retryAttempt = "00000000-0000-4000-8000-000000000802";
    await pool.query(
      `insert into support.delivery_attempts
         (id, tenant_id, ticket_id, ticket_version, channel, event,
          destination_ref, idempotency_key, status, safe_error_class,
          retry_of, root_attempt_id, attempt_number)
       values
         ($2, 'ten_alpha', $1, 1, 'email', 'created',
          'email_destination_01', 'ten_alpha/SUP-000001/1/email/created',
          'failed', 'transient', null, $2, 1)`,
      [ticketId, rootAttempt],
    );
    await pool.query(
      `insert into support.delivery_attempts
         (id, tenant_id, ticket_id, ticket_version, channel, event,
          destination_ref, idempotency_key, status, safe_error_class,
          retry_of, root_attempt_id, attempt_number)
       values
         ($3, 'ten_alpha', $1, 1, 'email', 'created',
          'email_destination_01', 'ten_alpha/SUP-000001/1/email/created/retry/2',
          'delivered', null, $2, $2, 2)`,
      [ticketId, rootAttempt, retryAttempt],
    );
    await expect(
      pool.query(
        `insert into support.delivery_attempts
           (id, tenant_id, ticket_id, ticket_version, channel, event,
            destination_ref, idempotency_key, status, safe_error_class,
            retry_of, root_attempt_id, attempt_number)
         values
           ('00000000-0000-4000-8000-000000000803', 'ten_alpha', $1, 2,
            'email', 'created', 'email_destination_01',
            'ten_alpha/SUP-000001/2/email/created', 'delivered', null, null,
            '00000000-0000-4000-8000-000000000803', 1)`,
        [ticketId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool.query(
        `insert into support.delivery_attempts
           (id, tenant_id, ticket_id, ticket_version, channel, event,
            destination_ref, idempotency_key, status, safe_error_class,
            retry_of, root_attempt_id, attempt_number)
         values
           ('00000000-0000-4000-8000-000000000804', 'ten_alpha', $1, 1,
            'email', 'created', 'email_destination_01',
            'ten_alpha/SUP-000001/1/email/created/retry/3', 'delivered', null,
            $2, '00000000-0000-4000-8000-000000000804', 3)`,
        [ticketId, retryAttempt],
      ),
    ).rejects.toThrow("invalid delivery retry chain");
    await expect(
      pool.query(
        `update support.delivery_attempts set status = 'delivered', safe_error_class = null
          where id = $1`,
        [rootAttempt],
      ),
    ).rejects.toThrow("append-only");
  });

  it("persists monotonic paused SLA state and immutable CSAT/evidence", async () => {
    await pool.query(
      `insert into support.sla_states
         (tenant_id, ticket_id, state, accumulated_paused_minutes, paused_at, last_transition_at)
       values ('ten_alpha', $1, 'running', 0, null, '2026-07-27T09:00:00Z')`,
      [ticketId],
    );
    await pool.query(
      `update support.sla_states
          set state = 'paused', accumulated_paused_minutes = 5,
              paused_at = '2026-07-27T09:10:00Z',
              last_transition_at = '2026-07-27T09:10:00Z'
        where ticket_id = $1`,
      [ticketId],
    );
    await expect(
      pool.query(
        `update support.sla_states
            set accumulated_paused_minutes = 1,
                last_transition_at = '2026-07-27T09:05:00Z'
          where ticket_id = $1`,
        [ticketId],
      ),
    ).rejects.toThrow("invalid SLA state transition");

    await pool.query(
      `insert into support.csat_responses
         (tenant_id, ticket_id, requester_id, rating, comment)
       values ('ten_alpha', $1, 'user_1', 5, 'synthetic response')`,
      [ticketId],
    );
    await expect(
      pool.query(
        `update support.csat_responses set rating = 1 where ticket_id = $1`,
        [ticketId],
      ),
    ).rejects.toThrow("append-only");
    await pool.query(
      `insert into support.depth_events
         (tenant_id, actor_id, action, subject_ref, detail)
       values
         ('ten_alpha', 'user_1', 'support.csat.submitted', 'SUP-000001',
          '{"rating": 5}'::jsonb)`,
    );
    await expect(
      pool.query(
        `insert into support.depth_events
           (tenant_id, actor_id, action, subject_ref, detail)
         values
           ('ten_alpha', 'user_1', 'support.csat.submitted', 'SUP-000001',
            '{"comment": "leak"}'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("forces RLS on every support-depth table", async () => {
    for (const table of [
      "delivery_preferences",
      "delivery_attempts",
      "attachments",
      "sla_policies",
      "sla_states",
      "csat_responses",
      "depth_events",
    ]) {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relrowsecurity, relforcerowsecurity
           from pg_class
          where oid = $1::regclass`,
        [`support.${table}`],
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });
});
