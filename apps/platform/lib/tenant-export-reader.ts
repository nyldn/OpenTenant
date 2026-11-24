import type { PoolClient } from "pg";
import { installedModules } from "../opentenant-modules";
import { ExportBudget, TenantExportError } from "./tenant-export-bounds";

export type AppendExportTable = (name: string, rows: AsyncIterable<string>) => Promise<void>;
export type ExportSource = (append: AppendExportTable, budget: ExportBudget) => Promise<void>;
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
// Credential columns are removed in PostgreSQL, before they reach worker memory.
const secretColumns = ['encrypted_connection', 'token_hash', 'encrypted_token', 'encrypted_access_token', 'encrypted_refresh_token', 'encrypted_credential', 'access_token', 'refresh_token', 'passcode_hash', 'input', 'token', 'password', 'accessToken', 'refreshToken', 'idToken', 'clientSecret', 'secret', 'private_key'];
const projection = (asset: boolean) => asset
  ? `(to_jsonb(t) - 'content' - $2::text[]) || jsonb_build_object('content_base64',replace(encode(t.content,'base64'),chr(10),''),'content_encoding','base64')`
  : `to_jsonb(t) - $2::text[]`;

/** A transaction-local NO SCROLL cursor never loads the complete result in pg. */
export async function* exportCursor(client: PoolClient, sql: string, values: unknown[], budget: ExportBudget): AsyncGenerator<string> {
  budget.check();
  await client.query("set local statement_timeout = '5s'");
  await client.query("set local idle_in_transaction_session_timeout = '60s'");
  await client.query(`declare tenant_export_rows no scroll cursor for ${sql}`, values);
  try {
    while (true) {
      budget.check();
      const { rows } = await client.query<{ json: string | null }>(`fetch forward ${budget.limits.pageRows} from tenant_export_rows`);
      for (const row of rows) {
        budget.check();
        if (row.json === null) throw new TenantExportError("row_byte_limit");
        yield row.json;
      }
      if (rows.length < budget.limits.pageRows) return;
    }
  } finally { await client.query("close tenant_export_rows").catch(() => undefined); }
}

function tableRows(client: PoolClient, table: string, predicate: string, tenantId: string, budget: ExportBudget, asset = false) {
  // Oversized values become NULL on the server, bounding each fetched page even
  // when a tenant stores an arbitrarily large JSON or text value.
  return exportCursor(client, `select case when octet_length(j::text) <= $3 then j::text else null end as json from (select ${projection(asset)} as j from ${table} t where ${predicate}) exported`, [tenantId, secretColumns, budget.limits.maxRowBytes], budget);
}

export async function exportTenantTables(client: PoolClient, tenantId: string, append: AppendExportTable, budget: ExportBudget): Promise<void> {
  const { rows } = await client.query<{ table_schema: string; table_name: string }>(`select table_schema,table_name from information_schema.tables where table_schema = any($1::text[]) and table_type='BASE TABLE' order by table_schema,table_name limit $2`, [["tenant_core", ...installedModules.modules.flatMap(definition => definition.tenantSchemas ?? [])], budget.limits.maxTables + 1]);
  if (rows.length > budget.limits.maxTables) throw new TenantExportError("table_limit");
  for (const table of rows) {
    budget.check();
    await append(`tenant.${table.table_schema}.${table.table_name}`, tableRows(client, `${identifier(table.table_schema)}.${identifier(table.table_name)}`, `current_setting('app.tenant_id',true)=$1`, tenantId, budget));
  }
}

interface ForeignKey { child_table: string; parent_table: string; child_columns: string[]; parent_columns: string[] }
async function controlPredicates(client: PoolClient, budget: ExportBudget): Promise<Map<string, string[]>> {
  const tables = await client.query<{ table_name: string; column_name: string }>(`select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in ('tenant_id','owner_tenant_id') order by c.table_name limit $1`, [budget.limits.maxCatalogRows + 1]);
  if (tables.rows.length > budget.limits.maxCatalogRows) throw new TenantExportError("catalog_limit");
  const predicates = new Map<string, string[]>();
  for (const table of tables.rows) {
    // Tables with two tenant selectors require both bindings. An OR here could
    // disclose data jointly owned by another tenant.
    const conditions = predicates.get(table.table_name) ?? [];
    conditions.push(`${identifier(table.column_name)}=$1`);
    predicates.set(table.table_name, conditions);
  }
  for (const [table, conditions] of predicates) predicates.set(table, [conditions.join(" and ")]);
  const foreignKeys = await client.query<ForeignKey>(
    `select child.relname as child_table,parent.relname as parent_table,
       array(select a.attname::text from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord) as child_columns,
       array(select a.attname::text from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord) as parent_columns
     from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid
     join pg_namespace cn on cn.oid=child.relnamespace join pg_namespace pn on pn.oid=parent.relnamespace
     where c.contype='f' and cn.nspname='public' and pn.nspname='public' limit $1`, [budget.limits.maxCatalogRows + 1]);
  if (foreignKeys.rows.length > budget.limits.maxCatalogRows) throw new TenantExportError("catalog_limit");
  const direct = new Set(predicates.keys());
  const pending = [...predicates].map(([table, conditions]) => ({ table, predicate: conditions[0]!, path: [table] }));
  let predicateBytes = 0;
  for (let index = 0; index < pending.length; index++) {
    budget.check();
    for (const fk of foreignKeys.rows) {
      const parent = pending[index]!;
      if (fk.parent_table !== parent.table || direct.has(fk.child_table) || parent.path.includes(fk.child_table)) continue;
      if (parent.path.length >= 32) throw new TenantExportError("catalog_limit");
      const predicate = `(${fk.child_columns.map(identifier).join(",")}) in (select ${fk.parent_columns.map(identifier).join(",")} from public.${identifier(parent.table)} where (${parent.predicate}))`;
      predicateBytes += Buffer.byteLength(predicate);
      if (predicateBytes > budget.limits.maxRowBytes) throw new TenantExportError("catalog_limit");
      const conditions = predicates.get(fk.child_table) ?? [];
      conditions.push(predicate); predicates.set(fk.child_table, conditions);
      pending.push({ table: fk.child_table, predicate, path: [...parent.path, fk.child_table] });
      if (pending.length > budget.limits.maxCatalogRows) throw new TenantExportError("catalog_limit");
    }
  }
  return predicates;
}

export async function exportControlTables(client: PoolClient, tenantId: string, append: AppendExportTable, budget: ExportBudget): Promise<void> {
  for (const [table, conditions] of await controlPredicates(client, budget)) {
    await append(`control.${table}`, tableRows(client, `public.${identifier(table)}`, conditions.map(condition => `(${condition})`).join(" or "), tenantId, budget, table === "tenant_branding_assets"));
  }
}
