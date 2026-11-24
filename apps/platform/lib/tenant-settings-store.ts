import type { PoolClient } from "pg";
import { controlPlanePool } from "./control-plane";

export interface BrandPolicyRow {
  defaults?: unknown;
  locked_keys?: unknown;
  overrides?: unknown;
}

export interface NavigationOverrideRow {
  label: string | null;
  group_name: string | null;
  sort_order: number | null;
  visible: boolean | null;
  locked_fields: unknown;
}

export async function readBrandPolicy(tenantId: string): Promise<BrandPolicyRow | undefined> {
  const { rows } = await controlPlanePool().query<BrandPolicyRow>(
    "select defaults, locked_keys, overrides from brand_policies where tenant_id = $1",
    [tenantId],
  );
  return rows[0];
}

export async function writeBrandOverrides(
  client: PoolClient,
  tenantId: string,
  overrides: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into brand_policies (tenant_id, overrides, version, updated_at)
     values ($1, $2::jsonb, 1, now())
     on conflict (tenant_id) do update set
       overrides = $2::jsonb,
       version = brand_policies.version + 1,
       updated_at = now()`,
    [tenantId, JSON.stringify(overrides)],
  );
}

export async function readNavigationOverride(
  tenantId: string,
  itemId: string,
): Promise<NavigationOverrideRow | undefined> {
  const { rows } = await controlPlanePool().query<NavigationOverrideRow>(
    `select label, group_name, sort_order, visible, locked_fields
       from navigation_overrides
      where tenant_id = $1 and item_id = $2`,
    [tenantId, itemId],
  );
  return rows[0];
}

export async function writeNavigationOverride(
  client: PoolClient,
  tenantId: string,
  itemId: string,
  row: NavigationOverrideRow,
): Promise<void> {
  await client.query(
    `insert into navigation_overrides
       (tenant_id, item_id, label, group_name, sort_order, visible, locked_fields, version)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 1)
     on conflict (tenant_id, item_id)
     do update set
       label = $3,
       group_name = $4,
       sort_order = $5,
       visible = $6,
       version = navigation_overrides.version + 1`,
    [
      tenantId,
      itemId,
      row.label,
      row.group_name,
      row.sort_order,
      row.visible,
      JSON.stringify(row.locked_fields),
    ],
  );
}

export async function writeModuleAccessPolicy(
  client: PoolClient,
  input: {
    tenantId: string;
    moduleKey: string;
    mode: "identity" | "passcode";
    passcodeHash: string | null;
  },
): Promise<void> {
  await client.query(
    `insert into module_access_policies (tenant_id, module_key, mode, passcode_hash)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, module_key)
     do update set
       mode = $3,
       passcode_hash = $4,
       version = module_access_policies.version + 1,
       updated_at = now()`,
    [input.tenantId, input.moduleKey, input.mode, input.passcodeHash],
  );
}

export type RoutineArea = "domain_metadata" | "integration_metadata" | "module_metadata";

export async function writeRoutineMetadata(
  client: PoolClient,
  input: {
    area: RoutineArea;
    tenantId: string;
    resourceKey: string;
    metadata: Record<string, string>;
  },
): Promise<boolean> {
  const { tenantId, resourceKey, metadata } = input;
  let result;

  switch (input.area) {
    case "domain_metadata":
      result = await client.query(
        `update domains set
           display_label = case when $3 then nullif($4, '') else display_label end,
           verification_note = case when $5 then nullif($6, '') else verification_note end
         where tenant_id = $1 and host = $2`,
        [
          tenantId,
          resourceKey,
          Object.hasOwn(metadata, "displayLabel"),
          metadata.displayLabel ?? "",
          Object.hasOwn(metadata, "verificationNote"),
          metadata.verificationNote ?? "",
        ],
      );
      break;
    case "integration_metadata":
      result = await client.query(
        `update oauth_token_vault set
           display_name = case when $3 then nullif($4, '') else display_name end,
           health_note = case when $5 then nullif($6, '') else health_note end,
           updated_at = now()
         where tenant_id = $1 and provider = $2`,
        [
          tenantId,
          resourceKey,
          Object.hasOwn(metadata, "displayName"),
          metadata.displayName ?? "",
          Object.hasOwn(metadata, "healthNote"),
          metadata.healthNote ?? "",
        ],
      );
      break;
    case "module_metadata":
      result = await client.query(
        `update tenant_modules set
           settings = jsonb_strip_nulls(settings || jsonb_build_object(
             'displayLabel', case when $3 then nullif($4, '') else settings->>'displayLabel' end,
             'supportNote', case when $5 then nullif($6, '') else settings->>'supportNote' end
           ))
         where tenant_id = $1 and module_key = $2`,
        [
          tenantId,
          resourceKey,
          Object.hasOwn(metadata, "displayLabel"),
          metadata.displayLabel ?? "",
          Object.hasOwn(metadata, "supportNote"),
          metadata.supportNote ?? "",
        ],
      );
      break;
  }

  return result.rowCount === 1;
}

export async function writeManagedSupportPolicy(
  client: PoolClient,
  tenantId: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await client.query(
    "update tenants set managed_support_enabled = $2 where tenant_id = $1 returning tenant_id",
    [tenantId, enabled],
  );
  return result.rowCount === 1;
}
