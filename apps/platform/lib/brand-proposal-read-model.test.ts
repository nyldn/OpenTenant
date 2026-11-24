import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "../../../tooling/migrations/src/runner";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import {
  BRAND_PROPOSAL_PAGE_MAX_ROWS,
  brandProposalPageRows,
} from "./brand-proposal-read-model";

describe("brand proposal page projection", () => {
  it("returns bounded typed provenance while tenant-filtering every table join", async () => {
    const uploadedAt = new Date("2026-09-06T15:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rows: [{
        display_name: "Example",
        proposal_id: "proposal_upload",
        source_url: `upload:${"a".repeat(64)}`,
        source_kind: "upload",
        file_digest: "a".repeat(64),
        parser_version: "brand-md-v1",
        source_user_id: "usr_uploader",
        source_at: uploadedAt,
        request_status: "completed",
        proposal_status: "draft",
        proposed_values: {
          displayName: {
            value: "Example",
            fileDigest: "a".repeat(64),
            uploadedByUserId: "usr_uploader",
            uploadedAt: uploadedAt.toISOString(),
          },
        },
        locked_keys: [],
        policy_version: 1,
        reviewed_policy_version: null,
        created_at: uploadedAt,
      }],
    });

    const rows = await brandProposalPageRows("ten_example", { query });

    expect(rows[0]?.source).toEqual({
      kind: "upload",
      fileDigest: "a".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedByUserId: "usr_uploader",
      uploadedAt,
    });
    expect(rows[0]?.source).not.toHaveProperty("content");
    expect(query).toHaveBeenCalledWith(expect.stringContaining(
      "join brand_policies b on b.tenant_id = t.tenant_id",
    ), ["ten_example"]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("left join brand_seed_requests r on r.tenant_id = t.tenant_id");
    expect(sql).toContain("p.tenant_id = r.tenant_id");
    expect(sql).not.toContain("uploadedByUserId");
    expect(sql).toContain(`limit ${BRAND_PROPOSAL_PAGE_MAX_ROWS}`);
  });

  it("fails closed on malformed persisted provenance", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        display_name: "Example",
        proposal_id: "proposal_upload",
        source_url: "upload:not-a-digest",
        source_kind: "upload",
        file_digest: "not-a-digest",
        parser_version: "brand-md-v1",
        source_user_id: "usr_uploader",
        source_at: new Date(),
        request_status: "completed",
        proposal_status: "draft",
        proposed_values: {},
        locked_keys: [],
        policy_version: 1,
        reviewed_policy_version: null,
        created_at: new Date(),
      }],
    });

    await expect(brandProposalPageRows("ten_example", { query })).rejects.toThrow(
      "invalid upload provenance",
    );
  });

  it.each([
    {
      label: "uploader",
      selectedActor: "usr_alpha",
      selectedAt: new Date("2026-09-06T15:00:00.000Z"),
      proposedValues: {
        colorPrimary: {
          value: "#123456",
          fileDigest: "a".repeat(64),
          uploadedByUserId: "usr_alpha",
          uploadedAt: "2026-09-06T15:00:00.000Z",
        },
        displayName: {
          value: "Example",
          fileDigest: "a".repeat(64),
          uploadedByUserId: "usr_beta",
          uploadedAt: "2026-09-06T15:00:00.000Z",
        },
      },
    },
    {
      label: "upload timestamp",
      selectedActor: "usr_alpha",
      selectedAt: new Date("2026-09-06T15:00:00.000Z"),
      proposedValues: {
        colorPrimary: {
          value: "#123456",
          fileDigest: "a".repeat(64),
          uploadedByUserId: "usr_alpha",
          uploadedAt: "2026-09-06T15:00:00.000Z",
        },
        displayName: {
          value: "Example",
          fileDigest: "a".repeat(64),
          uploadedByUserId: "usr_alpha",
          uploadedAt: "2026-09-06T15:00:01.000Z",
        },
      },
    },
  ])("fails closed when upload values disagree on $label", async ({
    proposedValues,
    selectedActor,
    selectedAt,
  }) => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        display_name: "Example",
        proposal_id: "proposal_upload",
        source_url: `upload:${"a".repeat(64)}`,
        source_kind: "upload",
        file_digest: "a".repeat(64),
        parser_version: "brand-md-v1",
        source_user_id: selectedActor,
        source_at: selectedAt,
        request_status: "completed",
        proposal_status: "draft",
        proposed_values: proposedValues,
        locked_keys: [],
        policy_version: 1,
        reviewed_policy_version: null,
        created_at: selectedAt,
      }],
    });

    await expect(brandProposalPageRows("ten_example", { query })).rejects.toThrow(
      "invalid upload provenance",
    );
  });

  it("rejects padded upload actor IDs", async () => {
    const uploadedAt = new Date("2026-09-06T15:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rows: [{
        display_name: "Example",
        proposal_id: "proposal_upload",
        source_url: `upload:${"a".repeat(64)}`,
        source_kind: "upload",
        file_digest: "a".repeat(64),
        parser_version: "brand-md-v1",
        source_user_id: " usr_uploader ",
        source_at: uploadedAt,
        request_status: "completed",
        proposal_status: "draft",
        proposed_values: {
          displayName: {
            value: "Example",
            fileDigest: "a".repeat(64),
            uploadedByUserId: " usr_uploader ",
            uploadedAt: uploadedAt.toISOString(),
          },
        },
        locked_keys: [],
        policy_version: 1,
        reviewed_policy_version: null,
        created_at: uploadedAt,
      }],
    });

    await expect(brandProposalPageRows("ten_example", { query })).rejects.toThrow(
      "invalid upload provenance",
    );
  });
});

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function controlPlaneMigrations(): Promise<MigrationFile[]> {
  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../tooling/migrations/sql/control-plane",
  );
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

describeIntegration("brand proposal page projection against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });
  const digest = "c".repeat(64);

  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await controlPlaneMigrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_projection', 'projection', 'Projection', 'active', 'eu'),
              ('ten_projection_other', 'projection-other', 'Other', 'active', 'eu')`,
    );
    await pool.query(
      `insert into brand_policies (tenant_id, defaults, locked_keys, overrides)
       values ('ten_projection', '{}', '[]', '{}'),
              ('ten_projection_other', '{}', '[]', '{}')`,
    );
    const uploadRequest = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, origin, status)
       values ('ten_projection', $1, 'upload', 'completed') returning request_id`,
      [`upload:${digest}`],
    );
    await pool.query(
      `insert into brand_proposals
         (request_id, tenant_id, proposed_values, parser_version)
       values ($1, 'ten_projection', $2::jsonb, 'brand-md-v1')`,
      [
        uploadRequest.rows[0]!.request_id,
        JSON.stringify({
          displayName: {
            value: "Projection",
            fileDigest: digest,
            uploadedByUserId: "usr_projection",
            uploadedAt: "2026-09-06T15:00:00.000Z",
          },
        }),
      ],
    );
    const legacyRequest = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, status)
       values ('ten_projection', 'https://brand.example.test', 'completed') returning request_id`,
    );
    await pool.query(
      `insert into brand_proposals
         (request_id, tenant_id, status, proposed_values, reviewed_at, reviewed_policy_version)
       values ($1, 'ten_projection', 'reviewed', $2::jsonb, now(), 1)`,
      [
        legacyRequest.rows[0]!.request_id,
        JSON.stringify({
          colorPrimary: {
            value: "#123456",
            sourceUrl: "https://brand.example.test",
            retrievedAt: "2026-09-05T12:00:00.000Z",
          },
        }),
      ],
    );
    const otherRequest = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, status)
       values ('ten_projection_other', 'https://other.example.test', 'completed') returning request_id`,
    );
    await pool.query(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, 'ten_projection_other', $2::jsonb)`,
      [
        otherRequest.rows[0]!.request_id,
        JSON.stringify({
          displayName: {
            value: "Other",
            sourceUrl: "https://other.example.test",
            retrievedAt: "2026-09-05T12:00:00.000Z",
          },
        }),
      ],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reads upload and legacy HTTPS attribution without cross-tenant rows or document content", async () => {
    const rows = await brandProposalPageRows("ten_projection", pool);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source?.kind).sort()).toEqual(["https", "upload"]);
    expect(rows.find((row) => row.source?.kind === "upload")?.source).toEqual({
      kind: "upload",
      fileDigest: digest,
      parserVersion: "brand-md-v1",
      uploadedByUserId: "usr_projection",
      uploadedAt: new Date("2026-09-06T15:00:00.000Z"),
    });
    expect(rows.find((row) => row.source?.kind === "https")?.source).toEqual({
      kind: "https",
      sourceUrl: "https://brand.example.test",
      retrievedAt: new Date("2026-09-05T12:00:00.000Z"),
    });
    expect(JSON.stringify(rows)).not.toContain("Other");
    expect(rows.some((row) => "document" in row || "raw_content" in row)).toBe(false);
  });
});
