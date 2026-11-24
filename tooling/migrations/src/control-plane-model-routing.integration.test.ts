import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

/**
 * Executes migration 0018 rather than reading it.
 *
 * The sibling unit suite asserts twenty substrings of the file and passed for
 * the whole time 0018 was invalid PostgreSQL: the unique index carried
 * `nulls not distinct` in the table-constraint position, which the grammar only
 * accepts after the column list. `create index` never ran, so the constraints
 * below existed as text and enforced nothing. Text matching cannot tell the
 * difference between a constraint and a comment describing one.
 *
 * Each case here writes rows that the contract says must be refused, so a
 * constraint that stops being enforced fails a test instead of passing one.
 */
const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function controlPlaneMigrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

describeIntegration("control-plane model routing against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await controlPlaneMigrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'eu'),
              ('ten_beta', 'beta', 'Beta', 'active', 'ap')`,
    );
    await pool.query(
      `insert into model_allowlist_versions (allowlist_version, require_zero_retention, created_by)
       values ('v1', false, 'owner_root')`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function rejects(sql: string, values: unknown[] = []): Promise<string> {
    try {
      await pool.query(sql, values);
    } catch (error) {
      return (error as { message: string }).message;
    }
    throw new Error(`expected PostgreSQL to reject: ${sql}`);
  }

  it("applies every control-plane migration against a real server", async () => {
    // The bare fact that beforeEach completed is the assertion 0018 lacked.
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and (table_name like 'model\\_%' or table_name = 'tenant_model_policies')`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "model_allowlist_entries",
      "model_allowlist_versions",
      "model_consent_policy_versions",
      "model_cross_border_consent_pairs",
      "model_cross_border_consents",
      "model_provider_credentials",
      "model_resolution_events",
      "model_routing_slots",
      "model_stream_terminal_events",
      "tenant_model_policies",
    ]);
  });

  it("creates the slot uniqueness index that the invalid grammar had silently dropped", async () => {
    const index = await pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'model_routing_slots_scope_idx'",
    );
    expect(index.rowCount).toBe(1);
    expect(index.rows[0]!.indexdef).toContain("NULLS NOT DISTINCT");
  });

  it("treats two installation-scope slots with null tenant and module as a collision", async () => {
    // This is what `nulls not distinct` buys. Under the default semantics both
    // rows insert, because null <> null, and the installation gets two primary
    // slots for one use case with no defined winner.
    const insert = `insert into model_routing_slots
      (tenant_id, module_id, use_case, scope, slot, provider, model, configured_by)
      values (null, null, 'triage', 'installation_use_case', 'primary', $1, $2, 'owner_root')`;
    await pool.query(insert, ["anthropic", "claude-a"]);
    const message = await rejects(insert, ["openai", "gpt-a"]);
    expect(message).toContain("model_routing_slots_scope_idx");
  });

  it("allows the same use case in a different scope and a different slot", async () => {
    await pool.query(
      `insert into model_routing_slots
        (tenant_id, module_id, use_case, scope, slot, provider, model, configured_by)
       values (null, null, 'triage', 'installation_use_case', 'primary', 'anthropic', 'claude-a', 'owner_root'),
              (null, null, 'triage', 'installation_use_case', 'secondary', 'openai', 'gpt-a', 'owner_root'),
              ('ten_alpha', 'support', 'triage', 'tenant_module_use_case', 'primary', 'anthropic', 'claude-a', 'admin_alpha')`,
    );
    const rows = await pool.query("select count(*)::int as n from model_routing_slots");
    expect(rows.rows[0]!.n).toBe(3);
  });

  it("refuses a scope whose null pattern contradicts its name", async () => {
    // A tenant-scoped slot with no tenant would resolve for everyone.
    const message = await rejects(
      `insert into model_routing_slots
        (tenant_id, module_id, use_case, scope, slot, provider, model, configured_by)
       values (null, 'support', 'triage', 'tenant_module_use_case', 'primary', 'anthropic', 'claude-a', 'admin_alpha')`,
    );
    expect(message).toMatch(/model_routing_slots/);
  });

  it("refuses an openrouter allowlist entry that is not pinned upstream", async () => {
    const message = await rejects(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture, pinned_upstream)
       values ('v1', 'openrouter', 'some/model', 'eu', 'zero_retention', false)`,
    );
    expect(message).toMatch(/model_allowlist_entries/);

    await pool.query(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture, pinned_upstream,
         upstream_provider, upstream_data_policy)
       values ('v1', 'openrouter', 'some/model', 'eu', 'zero_retention', true,
               'synthetic-upstream', 'eu-zero-retention')`,
    );
  });

  it("refuses regions and retention postures outside the accepted vocabulary", async () => {
    const region = await rejects(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture)
       values ('v1', 'anthropic', 'claude-a', 'uk', 'zero_retention')`,
    );
    expect(region).toMatch(/region/);

    const posture = await rejects(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture)
       values ('v1', 'anthropic', 'claude-a', 'eu', 'best_effort')`,
    );
    expect(posture).toMatch(/retention_posture/);
  });

  it("refuses an allowlist entry citing a version that was never published", async () => {
    const message = await rejects(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture)
       values ('v9', 'anthropic', 'claude-a', 'eu', 'zero_retention')`,
    );
    expect(message).toMatch(/allowlist_version|foreign key/);
  });

  /**
   * A consent and the pairs it covers are one fact recorded in two tables, so
   * they are granted in one transaction. 0019 refuses a consent with no pairs
   * at commit, which is why every grant here needs the pair.
   */
  async function grantConsent(consentId: string, provider = "anthropic"): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into model_cross_border_consents
          (consent_id, tenant_id, actor_id, granted_at, policy_version)
         values ($1, 'ten_alpha', 'admin_alpha', now(), 'cb-1')`,
        [consentId],
      );
      await client.query(
        `insert into model_cross_border_consent_pairs
          (consent_id, provider, region, retention_posture)
         values ($1, $2, 'us', 'zero_retention')`,
        [consentId, provider],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  it("permits only one live cross-border consent per tenant", async () => {
    await grantConsent("con_1");
    let message = "";
    try {
      await grantConsent("con_2");
    } catch (error) {
      message = (error as { message: string }).message;
    }
    expect(message).toContain("model_cross_border_active_consent_idx");

    // Withdrawing the first frees the tenant to grant again, which is the
    // behaviour a partial index gives and a plain unique constraint would not.
    await pool.query(
      "update model_cross_border_consents set withdrawn_at = now(), withdrawn_by = 'admin_alpha' where consent_id = 'con_1'",
    );
    await grantConsent("con_2");
  });

  it("refuses a consent that records no pairs", async () => {
    // ADR-006 section 7: consent is stored with the pairs it covers "so a later
    // audit can see what was agreed rather than that something was". A pairless
    // row reads in the trail as agreement to everything and to nothing.
    const message = await rejects(
      `insert into model_cross_border_consents
        (consent_id, tenant_id, actor_id, granted_at, policy_version)
       values ('con_bare', 'ten_alpha', 'admin_alpha', now(), 'cb-1')`,
    );
    expect(message).toContain("must name the pairs it covers");
  });

  it("refuses a half-recorded withdrawal", async () => {
    await grantConsent("con_1");
    // An actor with no timestamp, or a timestamp with no actor, is an audit row
    // that cannot answer who withdrew consent or when.
    const halfWithdrawn = await rejects(
      "update model_cross_border_consents set withdrawn_at = now() where consent_id = 'con_1'",
    );
    expect(halfWithdrawn).toMatch(/model_cross_border_consents/);

    const backdated = await rejects(
      `update model_cross_border_consents
          set withdrawn_at = granted_at - interval '1 hour', withdrawn_by = 'admin_alpha'
        where consent_id = 'con_1'`,
    );
    expect(backdated).toMatch(/model_cross_border_consents/);
  });

  it("freezes a granted consent against everything except withdrawal", async () => {
    await grantConsent("con_1");

    const rewritten = await rejects(
      "update model_cross_border_consents set actor_id = 'someone_else' where consent_id = 'con_1'",
    );
    expect(rewritten).toContain("only withdrawal may be recorded");

    const versionSwap = await rejects(
      "update model_cross_border_consents set policy_version = 'cb-2' where consent_id = 'con_1'",
    );
    expect(versionSwap).toContain("only withdrawal may be recorded");

    const deleted = await rejects(
      "delete from model_cross_border_consents where consent_id = 'con_1'",
    );
    expect(deleted).toContain("append-only");

    await pool.query(
      "update model_cross_border_consents set withdrawn_at = now(), withdrawn_by = 'admin_alpha' where consent_id = 'con_1'",
    );
    const reinstated = await rejects(
      "update model_cross_border_consents set withdrawn_at = null, withdrawn_by = null where consent_id = 'con_1'",
    );
    expect(reinstated).toContain("cannot be re-withdrawn or reinstated");
  });

  it("refuses to widen or drop the pairs a consent covers", async () => {
    await grantConsent("con_1");

    const widened = await rejects(
      `update model_cross_border_consent_pairs set provider = 'openai' where consent_id = 'con_1'`,
    );
    expect(widened).toContain("consent pairs are immutable");

    const dropped = await rejects(
      "delete from model_cross_border_consent_pairs where consent_id = 'con_1'",
    );
    expect(dropped).toContain("consent pairs are immutable");

    // Appending after withdrawal would grant scope the tenant never agreed to,
    // to a record the console already shows as revoked.
    await pool.query(
      "update model_cross_border_consents set withdrawn_at = now(), withdrawn_by = 'admin_alpha' where consent_id = 'con_1'",
    );
    const appended = await rejects(
      `insert into model_cross_border_consent_pairs (consent_id, provider, region, retention_posture)
       values ('con_1', 'openai', 'us', 'zero_retention')`,
    );
    expect(appended).toContain("withdrawn consent");
  });

  it("refuses to rewrite a published allowlist", async () => {
    await pool.query(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture)
       values ('v1', 'anthropic', 'claude-a', 'eu', 'zero_retention')`,
    );

    // model_resolution_events cites allowlist_version. If the entries behind a
    // version can change, the citation names a set that no longer exists.
    const retargeted = await rejects(
      "update model_allowlist_entries set region = 'us' where allowlist_version = 'v1'",
    );
    expect(retargeted).toContain("publish a new allowlist version");

    const removed = await rejects("delete from model_allowlist_entries where allowlist_version = 'v1'");
    expect(removed).toContain("publish a new allowlist version");

    const versionEdited = await rejects(
      "update model_allowlist_versions set require_zero_retention = true where allowlist_version = 'v1'",
    );
    expect(versionEdited).toContain("publish a new allowlist version");
  });

  it("keeps inference records append-only", async () => {
    await pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model,
         key_origin, region_served, retention_posture, allowlist_version)
       values ('res_1', 'ten_alpha', 'support', 'triage', 'anthropic', 'claude-a',
               'installation', 'eu', 'zero_retention', 'v1')`,
    );

    const rewritten = await rejects(
      "update model_resolution_events set provider = 'openai' where tenant_id = 'ten_alpha'",
    );
    expect(rewritten).toContain("append-only evidence");

    const erased = await rejects("delete from model_resolution_events where tenant_id = 'ten_alpha'");
    expect(erased).toContain("append-only evidence");
  });

  it("scopes provider credentials so an installation row and a tenant row coexist", async () => {
    const insert = `insert into model_provider_credentials
      (tenant_id, provider, encrypted_credential, updated_by)
      values ($1, 'anthropic', $2, 'owner_root')`;
    const cipher = Buffer.from("synthetic-ciphertext");
    await pool.query(insert, [null, cipher]);
    await pool.query(insert, ["ten_alpha", cipher]);

    const collision = await rejects(insert, [null, cipher]);
    expect(collision).toContain("model_provider_credentials_scope_idx");

    const empty = await rejects(
      `insert into model_provider_credentials (tenant_id, provider, encrypted_credential, updated_by)
       values ('ten_beta', 'openai', ''::bytea, 'owner_root')`,
    );
    expect(empty).toMatch(/model_provider_credentials/);
  });

  it("has no column able to hold a prompt, a completion or a plaintext credential", async () => {
    // The unit suite checks the file for these names. This checks the schema,
    // which is what a later migration could quietly widen.
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and (table_name like 'model\\_%' or table_name = 'tenant_model_policies')`,
    );
    const offenders = columns.rows.filter((row) =>
      /^(prompt|completion|response|credential|api_key|secret)$/u.test(row.column_name)
    );
    expect(offenders).toEqual([]);
  });
});
