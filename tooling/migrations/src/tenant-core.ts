import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
const tenantCoreInitialSql = readFileSync(new URL("../sql/tenant-core/0001_init.sql", import.meta.url), "utf8");
const tenantCoreIdentityRemovalSql = readFileSync(new URL("../sql/tenant-core/0002_remove_identity_organization_id.sql", import.meta.url), "utf8");
const tenantCoreSingleTenantAnchorSql = readFileSync(new URL("../sql/tenant-core/0003_single_tenant_anchor.sql", import.meta.url), "utf8");
const tenantCoreDataRegionApSql = readFileSync(new URL("../sql/tenant-core/0004_data_region_ap.sql", import.meta.url), "utf8");
import { applyMigrations, type MigrationFile, type MigrationResult } from "./runner";

const INITIAL_ID = "tenant-core/0001_init";
const IDENTITY_REMOVAL_ID = "tenant-core/0002_remove_identity_organization_id";
const SINGLE_TENANT_ANCHOR_ID = "tenant-core/0003_single_tenant_anchor";
const DATA_REGION_AP_ID = "tenant-core/0004_data_region_ap";
const SCHEMA_COMMENT = "architecture spec section 9.2";
const POLICY_EXPRESSION = "(tenant_id = current_setting('app.tenant_id'::text, true))";

export const TENANT_CORE_MIGRATIONS: ReadonlyArray<MigrationFile> = Object.freeze([
  Object.freeze({ id: INITIAL_ID, sql: tenantCoreInitialSql }),
  Object.freeze({ id: IDENTITY_REMOVAL_ID, sql: tenantCoreIdentityRemovalSql }),
  Object.freeze({ id: SINGLE_TENANT_ANCHOR_ID, sql: tenantCoreSingleTenantAnchorSql }),
  Object.freeze({ id: DATA_REGION_AP_ID, sql: tenantCoreDataRegionApSql }),
]);

interface SchemaRow {
  schema_comment: string | null;
}

interface TableRow {
  table_name: string;
  relation_kind: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  type_name: string;
  nullable: boolean;
}

interface DefaultRow {
  table_name: string;
  column_name: string;
  default_expression: string;
}

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  definition: string;
}

interface TriggerRow {
  table_name: string;
  trigger_name: string;
}

interface RewriteRuleRow {
  table_name: string;
  rule_name: string;
}

interface PolicyRow {
  table_name: string;
  policy_name: string;
  permissive: boolean;
  command: string;
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
}

const EXPECTED_TABLES: ReadonlyArray<TableRow> = [
  { table_name: "module_schema_versions", relation_kind: "r", rls_enabled: true, rls_forced: true },
  { table_name: "tenant_meta", relation_kind: "r", rls_enabled: true, rls_forced: true },
];

const EXPECTED_BASE_COLUMNS: ReadonlyArray<ColumnRow> = [
  { table_name: "module_schema_versions", column_name: "applied_at", type_name: "timestamp with time zone", nullable: false },
  { table_name: "module_schema_versions", column_name: "module_key", type_name: "text", nullable: false },
  { table_name: "module_schema_versions", column_name: "tenant_id", type_name: "text", nullable: false },
  { table_name: "module_schema_versions", column_name: "version", type_name: "text", nullable: false },
  { table_name: "tenant_meta", column_name: "data_region", type_name: "text", nullable: false },
  { table_name: "tenant_meta", column_name: "provisioned_at", type_name: "timestamp with time zone", nullable: false },
  { table_name: "tenant_meta", column_name: "tenant_id", type_name: "text", nullable: false },
];

const ORGANIZATION_ID_COLUMN: ColumnRow = {
  table_name: "tenant_meta",
  column_name: "organization_id",
  type_name: "text",
  nullable: false,
};

const EXPECTED_DEFAULTS: ReadonlyArray<DefaultRow> = [
  { table_name: "module_schema_versions", column_name: "applied_at", default_expression: "now()" },
  { table_name: "tenant_meta", column_name: "provisioned_at", default_expression: "now()" },
];

const EXPECTED_CONSTRAINTS: ReadonlyArray<ConstraintRow> = [
  {
    table_name: "module_schema_versions",
    constraint_name: "module_schema_versions_pkey",
    constraint_type: "PRIMARY KEY",
    definition: "PRIMARY KEY (tenant_id, module_key)",
  },
  {
    table_name: "module_schema_versions",
    constraint_name: "module_schema_versions_tenant_id_fkey",
    constraint_type: "FOREIGN KEY",
    definition: "FOREIGN KEY (tenant_id) REFERENCES tenant_core.tenant_meta(tenant_id)",
  },
  {
    table_name: "tenant_meta",
    constraint_name: "tenant_meta_data_region_check",
    constraint_type: "CHECK",
    definition: "CHECK (data_region = ANY (ARRAY['us'::text, 'eu'::text]))",
  },
  {
    table_name: "tenant_meta",
    constraint_name: "tenant_meta_pkey",
    constraint_type: "PRIMARY KEY",
    definition: "PRIMARY KEY (tenant_id)",
  },
];

const EXPECTED_INDEXES: ReadonlyArray<IndexRow> = [
  {
    table_name: "module_schema_versions",
    index_name: "module_schema_versions_pkey",
    is_unique: true,
    is_primary: true,
    definition: "CREATE UNIQUE INDEX module_schema_versions_pkey ON tenant_core.module_schema_versions USING btree (tenant_id, module_key)",
  },
  {
    table_name: "tenant_meta",
    index_name: "tenant_meta_pkey",
    is_unique: true,
    is_primary: true,
    definition: "CREATE UNIQUE INDEX tenant_meta_pkey ON tenant_core.tenant_meta USING btree (tenant_id)",
  },
];

const EXPECTED_POLICIES: ReadonlyArray<PolicyRow> = [
  {
    table_name: "module_schema_versions",
    policy_name: "module_schema_versions_isolation",
    permissive: true,
    command: "ALL",
    roles: ["public"],
    using_expression: POLICY_EXPRESSION,
    check_expression: POLICY_EXPRESSION,
  },
  {
    table_name: "tenant_meta",
    policy_name: "tenant_meta_isolation",
    permissive: true,
    command: "ALL",
    roles: ["public"],
    using_expression: POLICY_EXPRESSION,
    check_expression: POLICY_EXPRESSION,
  },
];

function sameRows(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Legacy baselining compares canonical write behavior, not deployment
 * ownership. Role ownership, ACLs, and provider-managed database collation
 * remain deployment concerns. Non-internal triggers and rewrite rules are
 * rejected because they can alter writes despite an otherwise matching table.
 */
async function baselineLegacyTenantCore(client: PoolClient): Promise<ReadonlyArray<string>> {
  const schema = await client.query<SchemaRow>(
    `select obj_description(n.oid, 'pg_namespace') as schema_comment
       from pg_namespace n
      where n.nspname = 'tenant_core'`,
  );
  if (schema.rows.length === 0) return [];
  if (schema.rows.length !== 1 || schema.rows[0]?.schema_comment !== SCHEMA_COMMENT) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline");
  }

  const tables = await client.query<TableRow>(
    `select c.relname as table_name,
            c.relkind as relation_kind,
            c.relrowsecurity as rls_enabled,
            c.relforcerowsecurity as rls_forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core' and c.relkind not in ('i', 'I')
      order by c.relname`,
  );
  const columns = await client.query<ColumnRow>(
    `select c.relname as table_name,
            a.attname as column_name,
            format_type(a.atttypid, a.atttypmod) as type_name,
            not a.attnotnull as nullable
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
        and c.relkind in ('r', 'p')
        and a.attnum > 0
        and not a.attisdropped
      order by c.relname, a.attname`,
  );
  const defaults = await client.query<DefaultRow>(
    `select c.relname as table_name,
            a.attname as column_name,
            pg_get_expr(d.adbin, d.adrelid) as default_expression
       from pg_attrdef d
       join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       join pg_class c on c.oid = d.adrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
      order by c.relname, a.attname`,
  );
  const constraints = await client.query<ConstraintRow>(
    `select c.relname as table_name,
            con.conname as constraint_name,
            case con.contype
              when 'p' then 'PRIMARY KEY'
              when 'f' then 'FOREIGN KEY'
              when 'c' then 'CHECK'
              when 'u' then 'UNIQUE'
              when 'x' then 'EXCLUDE'
            end as constraint_type,
            pg_get_constraintdef(con.oid, true) as definition
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core' and con.contype in ('p', 'f', 'c', 'u', 'x')
      order by c.relname, con.conname`,
  );
  const indexes = await client.query<IndexRow>(
    `select c.relname as table_name,
            i.relname as index_name,
            x.indisunique as is_unique,
            x.indisprimary as is_primary,
            pg_get_indexdef(x.indexrelid) as definition
       from pg_index x
       join pg_class c on c.oid = x.indrelid
       join pg_class i on i.oid = x.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
        and c.relname in ('tenant_meta', 'module_schema_versions')
      order by c.relname, i.relname`,
  );
  const triggers = await client.query<TriggerRow>(
    `select c.relname as table_name,
            t.tgname as trigger_name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
        and c.relname in ('tenant_meta', 'module_schema_versions')
        and not t.tgisinternal
      order by c.relname, t.tgname`,
  );
  const rewriteRules = await client.query<RewriteRuleRow>(
    `select c.relname as table_name,
            r.rulename as rule_name
       from pg_rewrite r
       join pg_class c on c.oid = r.ev_class
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
        and c.relname in ('tenant_meta', 'module_schema_versions')
        and c.relkind in ('r', 'p')
      order by c.relname, r.rulename`,
  );
  const policies = await client.query<PolicyRow>(
    `select c.relname as table_name,
            p.polname as policy_name,
            p.polpermissive as permissive,
            case p.polcmd
              when '*' then 'ALL'
              when 'r' then 'SELECT'
              when 'a' then 'INSERT'
              when 'w' then 'UPDATE'
              when 'd' then 'DELETE'
            end as command,
            (select array_agg(
                      (case when role_oid = 0 then 'public' else pg_get_userbyid(role_oid) end)::text
                      order by role_oid
                    )
               from unnest(p.polroles) role_oid) as roles,
            pg_get_expr(p.polqual, p.polrelid) as using_expression,
            pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tenant_core'
      order by c.relname, p.polname`,
  );

  const baseColumns = [...EXPECTED_BASE_COLUMNS].sort((left, right) =>
    `${left.table_name}.${left.column_name}`.localeCompare(`${right.table_name}.${right.column_name}`),
  );
  const oldColumns = [...baseColumns, ORGANIZATION_ID_COLUMN].sort((left, right) =>
    `${left.table_name}.${left.column_name}`.localeCompare(`${right.table_name}.${right.column_name}`),
  );
  const isOldSchema = sameRows(columns.rows, oldColumns);
  const isProviderNeutralSchema = sameRows(columns.rows, baseColumns);

  if (!sameRows(tables.rows, EXPECTED_TABLES)) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (tables)");
  }
  if (!sameRows(defaults.rows, EXPECTED_DEFAULTS)) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (defaults)");
  }
  if (!sameRows(constraints.rows, EXPECTED_CONSTRAINTS)) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (constraints)");
  }
  if (!sameRows(indexes.rows, EXPECTED_INDEXES)) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (indexes)");
  }
  if (triggers.rows.length !== 0 || rewriteRules.rows.length !== 0) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (attached objects)");
  }
  if (!sameRows(policies.rows, EXPECTED_POLICIES)) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline (policies)");
  }
  if (!isOldSchema && !isProviderNeutralSchema) {
    throw new Error("untracked tenant_core schema does not exactly match a canonical legacy baseline");
  }

  return isOldSchema ? [INITIAL_ID] : [INITIAL_ID, IDENTITY_REMOVAL_ID];
}

async function inspectTenantIdentityAnchors(
  client: PoolClient,
  migration: MigrationFile,
): Promise<void> {
  if (migration.id !== SINGLE_TENANT_ANCHOR_ID) return;

  await assertUnambiguousTenantIdentityAnchor(client);
}

async function preflightTenantIdentityAnchors(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{
    table_name: string | null;
    rls_forced: boolean;
  }>(
    `select to_regclass('tenant_core.tenant_meta')::text as table_name,
            coalesce((
              select c.relforcerowsecurity
                from pg_class c
               where c.oid = to_regclass('tenant_core.tenant_meta')
            ), false) as rls_forced`,
  );
  if (rows.length !== 1) {
    throw new Error("tenant_core identity anchors could not be inspected safely");
  }
  if (rows[0]?.table_name === null) return;
  // Exact legacy baselining reports non-canonical RLS state. Do not change
  // that state merely to inspect anchors before the baseline runs.
  if (rows[0]?.rls_forced !== true) return;

  await assertUnambiguousTenantIdentityAnchor(client);
}

async function assertUnambiguousTenantIdentityAnchor(client: PoolClient): Promise<void> {
  const rls = await client.query<{
    anchor_rls_enabled: boolean;
    anchor_rls_forced: boolean;
  }>(
    `select c.relrowsecurity as anchor_rls_enabled,
            c.relforcerowsecurity as anchor_rls_forced
       from pg_class c
      where c.oid = to_regclass('tenant_core.tenant_meta')`,
  );
  if (
    rls.rows.length !== 1
    || rls.rows[0]?.anchor_rls_enabled !== true
    || rls.rows[0]?.anchor_rls_forced !== true
  ) {
    throw new Error("tenant_core identity anchors could not be inspected safely");
  }

  // The migration connection owns this table. Temporarily removing FORCE RLS
  // inside the same transaction and ACCESS EXCLUSIVE table lock lets a
  // non-BYPASSRLS owner inspect every anchor without exposing an unlocked
  // state to concurrent traffic. Rollback restores FORCE automatically.
  await client.query("alter table tenant_core.tenant_meta no force row level security");
  const { rows } = await client.query<{ anchor_count: number }>(
    "select count(*)::int as anchor_count from tenant_core.tenant_meta",
  );
  await client.query("alter table tenant_core.tenant_meta force row level security");

  if (rows.length !== 1 || !Number.isInteger(rows[0]?.anchor_count)) {
    throw new Error("tenant_core identity anchors could not be inspected safely");
  }
  if (rows[0]!.anchor_count > 1) {
    throw new Error("tenant_core has multiple identity anchors; automatic repair is prohibited");
  }
}

export function migrateTenantCore(pool: Pool): Promise<MigrationResult> {
  return applyMigrations(pool, TENANT_CORE_MIGRATIONS, {
    atomicCatalog: true,
    preflight: preflightTenantIdentityAnchors,
    baseline: baselineLegacyTenantCore,
    beforeApply: inspectTenantIdentityAnchors,
  });
}
