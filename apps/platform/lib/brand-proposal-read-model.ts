import { controlPlanePool } from "./control-plane";

export const BRAND_PROPOSAL_PAGE_MAX_ROWS = 100;

export type BrandProposalSourceProjection =
  | {
    readonly kind: "upload";
    readonly fileDigest: string;
    readonly parserVersion: string;
    readonly uploadedByUserId: string;
    readonly uploadedAt: Date;
  }
  | {
    readonly kind: "https";
    readonly sourceUrl: string;
    readonly retrievedAt: Date | null;
  };

export interface BrandProposalPageRow {
  display_name: string;
  proposal_id: string | null;
  source_url: string | null;
  source: BrandProposalSourceProjection | null;
  request_status: string | null;
  proposal_status: string | null;
  proposed_values: unknown;
  locked_keys: unknown;
  policy_version: number;
  reviewed_policy_version: number | null;
  created_at: Date | null;
}

interface BrandProposalPageDatabaseRow extends Omit<BrandProposalPageRow, "source"> {
  source_kind: unknown;
  file_digest: unknown;
  parser_version: unknown;
  source_at: unknown;
}

interface BrandProposalQuery {
  query<T>(sql: string, values: readonly unknown[]): Promise<{ rows: T[] }>;
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("brand proposal source has an invalid timestamp");
  }
  return value;
}

function uploadAttribution(proposedValues: unknown): {
  readonly uploadedByUserId: string;
  readonly uploadedAt: Date;
} {
  if (
    typeof proposedValues !== "object"
    || proposedValues === null
    || Array.isArray(proposedValues)
  ) {
    throw new Error("brand proposal has invalid upload provenance");
  }
  const values = Object.values(proposedValues);
  if (values.length === 0) {
    throw new Error("brand proposal has invalid upload provenance");
  }
  const actors = new Set<string>();
  const timestamps = new Set<string>();
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("brand proposal has invalid upload provenance");
    }
    const proposed = value as Record<string, unknown>;
    const actor = proposed.uploadedByUserId;
    const timestamp = proposed.uploadedAt;
    if (
      typeof actor !== "string"
      || actor !== actor.trim()
      || actor.length === 0
      || actor.length > 255
      || typeof timestamp !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(timestamp)
      || !Number.isFinite(new Date(timestamp).getTime())
    ) {
      throw new Error("brand proposal has invalid upload provenance");
    }
    actors.add(actor);
    timestamps.add(timestamp);
  }
  if (actors.size !== 1 || timestamps.size !== 1) {
    throw new Error("brand proposal has invalid upload provenance");
  }
  const uploadedByUserId = actors.values().next().value;
  const timestamp = timestamps.values().next().value;
  if (uploadedByUserId === undefined || timestamp === undefined) {
    throw new Error("brand proposal has invalid upload provenance");
  }
  return { uploadedByUserId, uploadedAt: new Date(timestamp) };
}

function sourceProjection(row: BrandProposalPageDatabaseRow): BrandProposalSourceProjection | null {
  if (row.proposal_id === null || row.source_url === null) return null;
  const sourceKind = row.source_kind === undefined
    ? row.source_url.startsWith("upload:") ? "upload" : "https"
    : row.source_kind;
  if (sourceKind === "https") {
    if (typeof row.source_url !== "string" || row.source_url.length > 2048) {
      throw new Error("brand proposal has invalid HTTPS provenance");
    }
    return {
      kind: "https",
      sourceUrl: row.source_url,
      retrievedAt: dateOrNull(row.source_at),
    };
  }
  if (
    sourceKind !== "upload"
    || typeof row.file_digest !== "string"
    || !/^[0-9a-f]{64}$/u.test(row.file_digest)
    || typeof row.parser_version !== "string"
    || !/^[a-z][a-z0-9-]{2,63}$/u.test(row.parser_version)
  ) {
    throw new Error("brand proposal has invalid upload provenance");
  }
  const attribution = uploadAttribution(row.proposed_values);
  return {
    kind: "upload",
    fileDigest: row.file_digest,
    parserVersion: row.parser_version,
    ...attribution,
  };
}

export async function brandProposalPageRows(
  tenantId: string,
  db: BrandProposalQuery = controlPlanePool(),
): Promise<BrandProposalPageRow[]> {
  const { rows } = await db.query<BrandProposalPageDatabaseRow>(
    `select t.display_name,
            p.proposal_id,
            r.source_url,
            r.origin as source_kind,
            case when r.origin = 'upload' then substring(r.source_url from 8) end as file_digest,
            p.parser_version,
            case when r.origin = 'https' then (
                select (item.value ->> 'retrievedAt')::timestamptz
                  from jsonb_each(p.proposed_values) as item
                 where item.value ? 'retrievedAt'
                 order by item.key
                 limit 1
            ) end as source_at,
            r.status as request_status,
            p.status as proposal_status,
            p.proposed_values,
            b.locked_keys,
            b.version as policy_version,
            p.reviewed_policy_version,
            p.created_at
       from tenants t
       join brand_policies b on b.tenant_id = t.tenant_id
       left join brand_seed_requests r on r.tenant_id = t.tenant_id
       left join brand_proposals p
         on p.request_id = r.request_id and p.tenant_id = r.tenant_id
      where t.tenant_id = $1
      order by p.created_at desc nulls last
      limit ${BRAND_PROPOSAL_PAGE_MAX_ROWS}`,
    [tenantId],
  );
  return rows.map((row) => {
    const {
      source_kind: _sourceKind,
      file_digest: _fileDigest,
      parser_version: _parserVersion,
      source_at: _sourceAt,
      ...pageRow
    } = row;
    return { ...pageRow, source: sourceProjection(row) };
  });
}
