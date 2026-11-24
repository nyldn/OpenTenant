import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

/**
 * Executes the brand migrations rather than reading them.
 *
 * Every case writes a row the contract says must be refused. The alternative,
 * matching the migration text for substrings, is how `0018` shipped as invalid
 * PostgreSQL behind twenty passing assertions.
 */
const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

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

describeIntegration("control-plane brand upload provenance against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await controlPlaneMigrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'eu')`,
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

  async function uploadRequest(digest = DIGEST): Promise<string> {
    const inserted = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ('ten_alpha', $1, 'upload') returning request_id`,
      [`upload:${digest}`],
    );
    return inserted.rows[0]!.request_id;
  }

  function uploadValues(digest = DIGEST): string {
    return JSON.stringify({
      displayName: {
        value: "Alpha Industries",
        fileDigest: digest,
        uploadedByUserId: "user_admin",
        uploadedAt: "2026-07-28T10:00:00Z",
      },
    });
  }

  async function draftProposal(digest = DIGEST): Promise<string> {
    const requestId = await uploadRequest(digest);
    const inserted = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1') returning proposal_id`,
      [requestId, uploadValues(digest)],
    );
    return inserted.rows[0]!.proposal_id;
  }

  it("accepts upload provenance without a fabricated source URL", async () => {
    const proposalId = await draftProposal();
    const stored = await pool.query<{ proposed_values: Record<string, Record<string, string>> }>(
      "select proposed_values from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    const value = stored.rows[0]!.proposed_values.displayName!;
    expect(value.fileDigest).toBe(DIGEST);
    // The whole point. An upload never carries an invented HTTPS origin.
    expect(value.sourceUrl).toBeUndefined();
  });

  it("allows the pipeline to hydrate an initially empty draft exactly once", async () => {
    const requestId = await uploadRequest();
    const inserted = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', '{}', 'brand-md-v1') returning proposal_id`,
      [requestId],
    );
    const proposalId = inserted.rows[0]!.proposal_id;

    await pool.query(
      "update brand_proposals set proposed_values = $2::jsonb where proposal_id = $1",
      [proposalId, uploadValues()],
    );
    expect(await rejects(
      `update brand_proposals
          set proposed_values = proposed_values
                || jsonb_build_object(
                  'supportEmail',
                  jsonb_build_object(
                    'value', 'support@example.test',
                    'fileDigest', $2::text,
                    'uploadedByUserId', 'user_admin',
                    'uploadedAt', '2026-07-28T10:00:00Z'
                  )
                )
        where proposal_id = $1`,
      [proposalId, DIGEST],
    )).toContain("value keys and provenance are immutable");
  });

  it("seeds an insert-only parser registry while allowing a distinct later version", async () => {
    const seeded = await pool.query<{ parser_version: string }>(
      "select parser_version from brand_parser_versions order by parser_version",
    );
    expect(seeded.rows).toEqual([{ parser_version: "brand-md-v1" }]);

    await pool.query(
      `insert into brand_parser_versions (parser_version)
       values ('brand-md-v2')`,
    );
    expect(await rejects(
      `update brand_parser_versions
          set parser_version = 'brand-md-v1-rewritten'
        where parser_version = 'brand-md-v1'`,
    )).toContain("immutable");
    expect(await rejects(
      "delete from brand_parser_versions where parser_version = 'brand-md-v1'",
    )).toContain("cannot be deleted");
    expect(await rejects(
      "truncate brand_parser_versions cascade",
    )).toContain("immutable");
  });

  it("requires a known parser for uploads, freezes it, and preserves stored values", async () => {
    const requestId = await uploadRequest();
    expect(await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, null)`,
      [requestId, uploadValues()],
    )).toContain("upload proposals require a parser version");
    expect(await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-unknown')`,
      [requestId, uploadValues()],
    )).toContain("brand_proposals_parser_version_fk");

    const proposalId = await draftProposal(OTHER_DIGEST);
    const before = await pool.query<{ parser_version: string; proposed_values: unknown }>(
      "select parser_version, proposed_values from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    expect(before.rows[0]?.parser_version).toBe("brand-md-v1");
    await pool.query(
      "insert into brand_parser_versions (parser_version) values ('brand-md-v2')",
    );
    expect(await rejects(
      "update brand_proposals set parser_version = 'brand-md-v2' where proposal_id = $1",
      [proposalId],
    )).toContain("parser version is immutable");
    const after = await pool.query<{ parser_version: string; proposed_values: unknown }>(
      "select parser_version, proposed_values from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("pins request lookup to the real table instead of a temporary shadow", async () => {
    const requestId = await uploadRequest();
    const client = await pool.connect();
    try {
      await client.query(
        "create temporary table brand_seed_requests (request_id uuid, tenant_id text, origin text)",
      );
      await client.query(
        "insert into brand_seed_requests values ($1, 'ten_alpha', 'https')",
        [requestId],
      );
      let message = "";
      try {
        await client.query(
          `insert into public.brand_proposals
             (request_id, tenant_id, proposed_values, parser_version)
           values ($1, 'ten_alpha', $2::jsonb, null)`,
          [requestId, uploadValues()],
        );
      } catch (error) {
        message = (error as { message: string }).message;
      }
      expect(message).toContain("upload proposals require a parser version");
    } finally {
      await client.query("drop table if exists pg_temp.brand_seed_requests");
      client.release();
    }
  });

  it("freezes request origin and source after creation", async () => {
    const requestId = await uploadRequest();
    expect(await rejects(
      `update brand_seed_requests
          set origin = 'https', source_url = 'https://alpha.example.test/changed'
        where request_id = $1`,
      [requestId],
    )).toContain("source is immutable");
  });

  it("requires every stored value to match the request origin", async () => {
    const uploadRequestId = await uploadRequest();
    expect(await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
      [
        uploadRequestId,
        JSON.stringify({
          displayName: {
            value: "Alpha",
            sourceUrl: "https://alpha.example.test/brand",
            retrievedAt: "2026-07-28T10:00:00Z",
          },
        }),
      ],
    )).toContain("must match the upload request origin");

    const httpsRequest = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ('ten_alpha', 'https://alpha.example.test/origin-check') returning request_id`,
    );
    expect(await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, null)`,
      [httpsRequest.rows[0]!.request_id, uploadValues()],
    )).toContain("must match the HTTPS request origin");

    const digestRequestId = await uploadRequest(OTHER_DIGEST);
    expect(await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
      [digestRequestId, uploadValues(DIGEST)],
    )).toContain("digest must match its upload request");
  });

  it("stores the explicit no-parser representation for HTTPS proposals", async () => {
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ('ten_alpha', 'https://alpha.example.test/no-parser') returning request_id`,
    );
    const inserted = await pool.query<{ parser_version: string | null }>(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', '{}', null) returning parser_version`,
      [request.rows[0]!.request_id],
    );
    expect(inserted.rows[0]!.parser_version).toBeNull();
    expect(await rejects(
      "update brand_proposals set parser_version = 'brand-md-v1' where request_id = $1",
      [request.rows[0]!.request_id],
    )).toContain("parser version is immutable");
  });

  it("backfills an already-applied upload proposal without weakening terminality", async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    const migrations = await controlPlaneMigrations();
    const parserMigrationIndex = migrations.findIndex(
      (migration) => migration.id === "0022_brand_parser_versions",
    );
    expect(parserMigrationIndex).toBeGreaterThan(0);
    await applyMigrations(pool, migrations.slice(0, parserMigrationIndex));
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'eu')`,
    );
    const requestId = await uploadRequest();
    const inserted = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, 'ten_alpha', $2::jsonb) returning proposal_id`,
      [requestId, uploadValues()],
    );
    const proposalId = inserted.rows[0]!.proposal_id;
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );
    await pool.query(
      `update brand_proposals
          set status = 'applied', applied_at = now(), applied_by = 'user_admin'
        where proposal_id = $1`,
      [proposalId],
    );

    await expect(applyMigrations(pool, migrations)).resolves.toMatchObject({
      applied: migrations.slice(parserMigrationIndex).map((migration) => migration.id),
    });
    const stored = await pool.query<{ status: string; parser_version: string | null }>(
      "select status, parser_version from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    expect(stored.rows[0]).toEqual({
      status: "applied",
      parser_version: "brand-md-v1",
    });
    expect(await rejects(
      "update brand_proposals set parser_version = parser_version where proposal_id = $1",
      [proposalId],
    )).toContain("terminal");
  });

  it("rejects legacy proposal provenance that disagrees with its request", async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    const migrations = await controlPlaneMigrations();
    const parserMigrationIndex = migrations.findIndex(
      (migration) => migration.id === "0022_brand_parser_versions",
    );
    await applyMigrations(pool, migrations.slice(0, parserMigrationIndex));
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'eu')`,
    );
    const requestId = await uploadRequest();
    await pool.query(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, 'ten_alpha', $2::jsonb)`,
      [
        requestId,
        JSON.stringify({
          displayName: {
            value: "Alpha",
            sourceUrl: "https://alpha.example.test/legacy-mismatch",
            retrievedAt: "2026-07-28T10:00:00Z",
          },
        }),
      ],
    );

    await expect(applyMigrations(pool, migrations)).rejects.toThrow(
      "existing brand proposal provenance does not match its request origin",
    );
    const recorded = await pool.query(
      "select 1 from schema_migrations where id = '0022_brand_parser_versions'",
    );
    expect(recorded.rowCount).toBe(0);
  });

  it("rejects truncation of proposal and request provenance tables", async () => {
    await draftProposal();
    expect(await rejects("truncate brand_proposals")).toContain(
      "provenance cannot be truncated",
    );
    expect(await rejects("truncate brand_seed_requests cascade")).toContain(
      "provenance cannot be truncated",
    );
  });

  it("still accepts the unchanged HTTPS shape", async () => {
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ('ten_alpha', 'https://alpha.example.test/brand') returning request_id`,
    );
    await pool.query(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, 'ten_alpha', $2::jsonb)`,
      [
        request.rows[0]!.request_id,
        JSON.stringify({
          displayName: {
            value: "Alpha",
            sourceUrl: "https://alpha.example.test/brand",
            retrievedAt: "2026-07-28T10:00:00Z",
          },
        }),
      ],
    );
    const count = await pool.query("select count(*)::int as n from brand_proposals");
    expect(count.rows[0]!.n).toBe(1);
  });

  it("refuses a value mixing both provenance shapes", async () => {
    const requestId = await uploadRequest();
    // Not richer provenance. A value whose origin cannot be stated.
    const message = await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
      [
        requestId,
        JSON.stringify({
          displayName: {
            value: "Alpha",
            sourceUrl: "https://alpha.example.test/brand",
            retrievedAt: "2026-07-28T10:00:00Z",
            fileDigest: DIGEST,
            uploadedByUserId: "user_admin",
            uploadedAt: "2026-07-28T10:00:00Z",
          },
        }),
      ],
    );
    expect(message).toContain("brand_proposals_values_provenanced");
  });

  it("refuses a value with no provenance at all", async () => {
    const requestId = await uploadRequest();
    const message = await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
      [requestId, JSON.stringify({ displayName: { value: "Alpha" } })],
    );
    expect(message).toContain("brand_proposals_values_provenanced");
  });

  it("refuses a digest that is not full lower-case SHA-256 hex", async () => {
    const requestId = await uploadRequest();
    for (const digest of ["a".repeat(63), "A".repeat(64), "z".repeat(64), "sha256:" + "a".repeat(64)]) {
      const message = await rejects(
        `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
         values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
        [
          requestId,
          JSON.stringify({
            displayName: {
              value: "Alpha",
              fileDigest: digest,
              uploadedByUserId: "user_admin",
              uploadedAt: "2026-07-28T10:00:00Z",
            },
          }),
        ],
      );
      expect(message, `digest ${digest}`).toContain("brand_proposals_values_provenanced");
    }
  });

  it("refuses an upload request whose source URL is not an upload URI", async () => {
    const message = await rejects(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ('ten_alpha', 'https://alpha.example.test/brand', 'upload')`,
    );
    expect(message).toContain("brand_seed_requests_source_url_check");

    const fetched = await rejects(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ('ten_alpha', $1, 'https')`,
      [`upload:${DIGEST}`],
    );
    expect(fetched).toContain("brand_seed_requests_source_url_check");
  });

  it("treats an identical-digest re-upload as a collision rather than a second proposal", async () => {
    await draftProposal();
    // brand_seed_requests_one_open_source keys on (tenant_id, source_url) while
    // the request is open, and for an upload that key is the file digest.
    const message = await rejects(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ('ten_alpha', $1, 'upload')`,
      [`upload:${DIGEST}`],
    );
    expect(message).toContain("brand_seed_requests_one_open_source");
  });

  it("permits only one live draft per tenant", async () => {
    await draftProposal(DIGEST);
    const requestId = await uploadRequest(OTHER_DIGEST);
    const message = await rejects(
      `insert into brand_proposals (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_alpha', $2::jsonb, 'brand-md-v1')`,
      [requestId, uploadValues(OTHER_DIGEST)],
    );
    expect(message).toContain("brand_proposals_one_live_draft");
  });

  it("supersedes only a draft, and never a reviewed or applied proposal", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      "update brand_proposals set status = 'superseded', superseded_at = now() where proposal_id = $1",
      [proposalId],
    );

    const revived = await rejects(
      "update brand_proposals set status = 'draft', superseded_at = null where proposal_id = $1",
      [proposalId],
    );
    expect(revived).toContain("cannot be revived");

    const second = await draftProposal(OTHER_DIGEST);
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [second],
    );
    // A human has read this one. A newer file does not quietly replace it.
    const reviewedSupersede = await rejects(
      "update brand_proposals set status = 'superseded', superseded_at = now() where proposal_id = $1",
      [second],
    );
    expect(reviewedSupersede).toMatch(/brand_proposals_status_timestamps/);
  });

  it("makes an applied proposal terminal", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );
    await pool.query(
      `update brand_proposals
          set status = 'applied', applied_at = now(), applied_by = 'user_admin'
        where proposal_id = $1`,
      [proposalId],
    );

    for (const [sql, expected] of [
      ["update brand_proposals set status = 'draft' where proposal_id = $1", "terminal"],
      ["update brand_proposals set proposed_values = '{}'::jsonb where proposal_id = $1", "terminal"],
      ["delete from brand_proposals where proposal_id = $1", "cannot be deleted"],
    ] as const) {
      const message = await rejects(sql, [proposalId]);
      expect(message, sql).toContain(expected);
    }
  });

  it("rejects reviewed value mutation unless the same write invalidates review", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );

    expect(await rejects(
      `update brand_proposals
          set proposed_values = jsonb_set(proposed_values, '{displayName,value}', '"Changed"')
        where proposal_id = $1`,
      [proposalId],
    )).toContain("invalidate review");

    await pool.query(
      `update brand_proposals
          set proposed_values = jsonb_set(proposed_values, '{displayName,value}', '"Changed"'),
              status = 'draft', reviewed_at = null, reviewed_policy_version = null
        where proposal_id = $1`,
      [proposalId],
    );
    const edited = await pool.query<{
      status: string;
      reviewed_at: Date | null;
      reviewed_policy_version: number | null;
      proposed_values: Record<string, { value: string; fileDigest: string }>;
      parser_version: string;
    }>(
      `select status, reviewed_at, reviewed_policy_version, proposed_values, parser_version
         from brand_proposals where proposal_id = $1`,
      [proposalId],
    );
    expect(edited.rows[0]).toMatchObject({
      status: "draft",
      reviewed_at: null,
      reviewed_policy_version: null,
      parser_version: "brand-md-v1",
    });
    expect(edited.rows[0]!.proposed_values.displayName).toMatchObject({
      value: "Changed",
      fileDigest: DIGEST,
    });
  });

  it("freezes value keys and provenance through the edit transition", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );

    for (const [sql, values] of [
      [`update brand_proposals
          set proposed_values = jsonb_set(
                proposed_values,
                '{displayName,uploadedByUserId}',
                '"user_attacker"'
              ),
              status = 'draft', reviewed_at = null, reviewed_policy_version = null
        where proposal_id = $1`, [proposalId]],
      [`update brand_proposals
          set proposed_values = proposed_values
                || jsonb_build_object(
                  'supportEmail',
                  jsonb_build_object(
                    'value', 'support@example.test',
                    'fileDigest', $2::text,
                    'uploadedByUserId', 'user_admin',
                    'uploadedAt', '2026-07-28T10:00:00Z'
                  )
                ),
              status = 'draft', reviewed_at = null, reviewed_policy_version = null
        where proposal_id = $1`, [proposalId, DIGEST]],
      [`update brand_proposals
          set proposed_values = proposed_values - 'displayName',
              status = 'draft', reviewed_at = null, reviewed_policy_version = null
        where proposal_id = $1`, [proposalId]],
    ] as const) {
      expect(await rejects(sql, [...values]), sql).toContain(
        "value keys and provenance are immutable",
      );
    }
  });

  it("requires a real value change to invalidate review and keeps review separate from editing", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );

    expect(await rejects(
      `update brand_proposals
          set status = 'draft', reviewed_at = null, reviewed_policy_version = null
        where proposal_id = $1`,
      [proposalId],
    )).toContain("requires changed values");

    const draftId = await draftProposal(OTHER_DIGEST);
    expect(await rejects(
      `update brand_proposals
          set proposed_values = jsonb_set(proposed_values, '{displayName,value}', '"Changed"'),
              status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [draftId],
    )).toContain("cannot also edit");
  });

  it.each(["discarded", "superseded"] as const)(
    "keeps %s proposal values terminal",
    async (status) => {
      const proposalId = await draftProposal();
      await pool.query(
        status === "discarded"
          ? `update brand_proposals
                set status = 'discarded', discarded_at = now()
              where proposal_id = $1`
          : `update brand_proposals
                set status = 'superseded', superseded_at = now()
              where proposal_id = $1`,
        [proposalId],
      );
      expect(await rejects(
        `update brand_proposals
            set proposed_values = jsonb_set(proposed_values, '{displayName,value}', '"Changed"')
          where proposal_id = $1`,
        [proposalId],
      )).toContain("terminal");
    },
  );

  it("refuses to apply a proposal that was never reviewed", async () => {
    const proposalId = await draftProposal();
    const message = await rejects(
      `update brand_proposals
          set status = 'applied', applied_at = now(), applied_by = 'user_admin'
        where proposal_id = $1`,
      [proposalId],
    );
    expect(message).toContain("brand_proposals_status_timestamps");
  });

  it("refuses an applied row with no actor", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );
    // applied_by is what pairs the row with its audit event. Without it the
    // audit trail records that a change happened and not who made it.
    const message = await rejects(
      "update brand_proposals set status = 'applied', applied_at = now() where proposal_id = $1",
      [proposalId],
    );
    expect(message).toContain("brand_proposals_status_timestamps");
  });

  it("requires exactly reviewed or applied proposals to carry a policy version", async () => {
    const proposalId = await draftProposal();
    const missingVersion = await rejects(
      "update brand_proposals set status = 'reviewed', reviewed_at = now() where proposal_id = $1",
      [proposalId],
    );
    expect(missingVersion).toContain("brand_proposals_status_timestamps");

    const draftVersion = await rejects(
      "update brand_proposals set reviewed_policy_version = 1 where proposal_id = $1",
      [proposalId],
    );
    expect(draftVersion).toContain("brand_proposals_status_timestamps");

    await pool.query(
      `update brand_proposals
          set status = 'reviewed', reviewed_at = now(), reviewed_policy_version = 1
        where proposal_id = $1`,
      [proposalId],
    );

    const appliedWithoutVersion = await rejects(
      `update brand_proposals
          set status = 'applied', applied_at = now(), applied_by = 'user_admin',
              reviewed_policy_version = null
        where proposal_id = $1`,
      [proposalId],
    );
    expect(appliedWithoutVersion).toContain("brand_proposals_status_timestamps");

    await pool.query(
      `update brand_proposals
          set status = 'applied', applied_at = now(), applied_by = 'user_admin'
        where proposal_id = $1`,
      [proposalId],
    );
  });

  it("freezes proposal identity", async () => {
    const proposalId = await draftProposal();
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_beta', 'beta', 'Beta', 'active', 'eu')`,
    );
    const message = await rejects(
      "update brand_proposals set tenant_id = 'ten_beta' where proposal_id = $1",
      [proposalId],
    );
    expect(message).toContain("identity is immutable");
  });
});
