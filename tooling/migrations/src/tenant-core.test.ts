import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { TENANT_CORE_MIGRATIONS, migrateTenantCore } from "./tenant-core";

const POLICY_EXPRESSION = "(tenant_id = current_setting('app.tenant_id'::text, true))";

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function canonicalLegacyRows(withOrganizationId: boolean) {
  return {
    schema: [{ schema_comment: "architecture spec section 9.2" }],
    tables: [
      { table_name: "module_schema_versions", relation_kind: "r", rls_enabled: true, rls_forced: true },
      { table_name: "tenant_meta", relation_kind: "r", rls_enabled: true, rls_forced: true },
    ],
    columns: [
      { table_name: "module_schema_versions", column_name: "applied_at", type_name: "timestamp with time zone", nullable: false },
      { table_name: "module_schema_versions", column_name: "module_key", type_name: "text", nullable: false },
      { table_name: "module_schema_versions", column_name: "tenant_id", type_name: "text", nullable: false },
      { table_name: "module_schema_versions", column_name: "version", type_name: "text", nullable: false },
      { table_name: "tenant_meta", column_name: "data_region", type_name: "text", nullable: false },
      ...(withOrganizationId
        ? [{ table_name: "tenant_meta", column_name: "organization_id", type_name: "text", nullable: false }]
        : []),
      { table_name: "tenant_meta", column_name: "provisioned_at", type_name: "timestamp with time zone", nullable: false },
      { table_name: "tenant_meta", column_name: "tenant_id", type_name: "text", nullable: false },
    ],
    defaults: [
      { table_name: "module_schema_versions", column_name: "applied_at", default_expression: "now()" },
      { table_name: "tenant_meta", column_name: "provisioned_at", default_expression: "now()" },
    ],
    constraints: [
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
    ],
    indexes: [
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
    ],
    triggers: [] as Array<{ table_name: string; trigger_name: string }>,
    rewriteRules: [] as Array<{ table_name: string; rule_name: string }>,
    policies: [
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
    ],
  };
}

function tenantCorePool(options: {
  legacy?: ReturnType<typeof canonicalLegacyRows> | null;
  recorded?: Array<{ id: string; checksum: string }>;
  anchorCount?: number;
} = {}) {
  const sql: string[] = [];
  const values: unknown[][] = [];
  const clientQuery = vi.fn(async (statement: string, parameters?: unknown[]) => {
    sql.push(statement);
    values.push(parameters ?? []);
    if (statement === "select id, checksum from schema_migrations") {
      return { rows: options.recorded ?? [] };
    }
    if (statement.includes("to_regclass('tenant_core.tenant_meta')")) {
      if (statement.includes("anchor_rls_enabled")) {
        return { rows: [{ anchor_rls_enabled: true, anchor_rls_forced: true }] };
      }
      const exists = options.legacy !== null
        && (options.legacy !== undefined || (options.recorded?.length ?? 0) > 0);
      return {
        rows: [{
          table_name: exists ? "tenant_core.tenant_meta" : null,
          rls_forced: options.legacy?.tables[1]?.rls_forced ?? true,
        }],
      };
    }
    if (statement.includes("as schema_comment") && statement.includes("pg_namespace")) {
      return { rows: options.legacy?.schema ?? [] };
    }
    if (statement.includes("as rls_enabled") && statement.includes("pg_class")) {
      return { rows: options.legacy?.tables ?? [] };
    }
    if (statement.includes("as type_name") && statement.includes("pg_attribute")) {
      return { rows: options.legacy?.columns ?? [] };
    }
    if (statement.includes("as default_expression") && statement.includes("pg_attrdef")) {
      return { rows: options.legacy?.defaults ?? [] };
    }
    if (statement.includes("as constraint_type") && statement.includes("pg_constraint")) {
      return { rows: options.legacy?.constraints ?? [] };
    }
    if (statement.includes("as index_name") && statement.includes("pg_index")) {
      return { rows: options.legacy?.indexes ?? [] };
    }
    if (statement.includes("as trigger_name") && statement.includes("pg_trigger")) {
      return { rows: options.legacy?.triggers ?? [] };
    }
    if (statement.includes("as rule_name") && statement.includes("pg_rewrite")) {
      return { rows: options.legacy?.rewriteRules ?? [] };
    }
    if (statement.includes("as policy_name") && statement.includes("pg_policy")) {
      return { rows: options.legacy?.policies ?? [] };
    }
    if (statement.includes("as anchor_count")) {
      return { rows: [{ anchor_count: options.anchorCount ?? 0 }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return {
    pool: { connect } as unknown as Pool,
    sql,
    values,
    clientQuery,
    release,
  };
}

describe("tenant-core migration catalog", () => {
  it("embeds the canonical SQL files under path-qualified ids", () => {
    expect(TENANT_CORE_MIGRATIONS.map(({ id }) => id)).toEqual([
      "tenant-core/0001_init",
      "tenant-core/0002_remove_identity_organization_id",
      "tenant-core/0003_single_tenant_anchor",
      "tenant-core/0004_data_region_ap",
    ]);
    expect(TENANT_CORE_MIGRATIONS[0]?.sql).toContain("create schema tenant_core");
    expect(TENANT_CORE_MIGRATIONS[1]?.sql).toContain("drop column if exists organization_id");
    expect(TENANT_CORE_MIGRATIONS[2]?.sql).toContain("tenant_meta_singleton_key");
  });

  it("applies and tracks the canonical migrations for a fresh database", async () => {
    const stub = tenantCorePool({ legacy: null });

    await expect(migrateTenantCore(stub.pool)).resolves.toEqual({
      applied: [
        "tenant-core/0001_init",
        "tenant-core/0002_remove_identity_organization_id",
        "tenant-core/0003_single_tenant_anchor",
        "tenant-core/0004_data_region_ap",
      ],
      skipped: [],
    });

    expect(stub.sql).toContain(TENANT_CORE_MIGRATIONS[0]?.sql);
    expect(stub.sql).toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
    expect(stub.values).toContainEqual([
      "tenant-core/0001_init",
      checksum(TENANT_CORE_MIGRATIONS[0]?.sql ?? ""),
    ]);
  });

  it("replays a fully tracked canonical catalog without reapplying SQL", async () => {
    const recorded = TENANT_CORE_MIGRATIONS.map((migration) => ({
      id: migration.id,
      checksum: checksum(migration.sql),
    }));
    const stub = tenantCorePool({ recorded });

    await expect(migrateTenantCore(stub.pool)).resolves.toEqual({
      applied: [],
      skipped: recorded.map(({ id }) => id),
    });

    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[0]?.sql);
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
  });

  it("baselines exact legacy migration 0001 then applies the later migrations", async () => {
    const stub = tenantCorePool({ legacy: canonicalLegacyRows(true) });

    await expect(migrateTenantCore(stub.pool)).resolves.toEqual({
      applied: [
        "tenant-core/0002_remove_identity_organization_id",
        "tenant-core/0003_single_tenant_anchor",
        "tenant-core/0004_data_region_ap",
      ],
      skipped: ["tenant-core/0001_init"],
    });

    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[0]?.sql);
    expect(stub.sql).toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
    expect(stub.sql).toContain(TENANT_CORE_MIGRATIONS[2]?.sql);
  });

  it("baselines both migrations when the exact legacy schema is already provider-neutral", async () => {
    const stub = tenantCorePool({ legacy: canonicalLegacyRows(false) });

    await expect(migrateTenantCore(stub.pool)).resolves.toEqual({
      applied: ["tenant-core/0003_single_tenant_anchor", "tenant-core/0004_data_region_ap"],
      skipped: TENANT_CORE_MIGRATIONS.slice(0, 2).map(({ id }) => id),
    });

    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[0]?.sql);
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
    expect(stub.sql).toContain(TENANT_CORE_MIGRATIONS[2]?.sql);
  });

  it("fails closed on an ambiguous untracked tenant-core schema", async () => {
    const legacy = canonicalLegacyRows(true);
    legacy.tables[0] = { ...legacy.tables[0]!, rls_forced: false };
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    expect(stub.sql).toContain("rollback");
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[0]?.sql);
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
  });

  it("fails closed when an untracked schema has a non-canonical constraint", async () => {
    const legacy = canonicalLegacyRows(true);
    legacy.constraints[2] = {
      ...legacy.constraints[2]!,
      definition: "CHECK (data_region IS NOT NULL)",
    };
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    expect(stub.sql).toContain("rollback");
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
  });

  it("fails closed when an untracked schema has a non-canonical column default", async () => {
    const legacy = canonicalLegacyRows(false);
    legacy.defaults[1] = {
      ...legacy.defaults[1]!,
      default_expression: "clock_timestamp()",
    };
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when an untracked canonical table has a user trigger", async () => {
    const legacy = canonicalLegacyRows(true);
    legacy.triggers.push({ table_name: "tenant_meta", trigger_name: "rewrite_tenant" });
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    expect(stub.sql).toContain("rollback");
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[1]?.sql);
  });

  it("fails closed when an untracked canonical table has a rewrite rule", async () => {
    const legacy = canonicalLegacyRows(false);
    legacy.rewriteRules.push({ table_name: "tenant_meta", rule_name: "rewrite_tenant" });
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );

    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when an untracked canonical table has an extra unique constraint", async () => {
    const legacy = canonicalLegacyRows(false);
    legacy.constraints.push({
      table_name: "tenant_meta",
      constraint_name: "tenant_meta_data_region_key",
      constraint_type: "UNIQUE",
      definition: "UNIQUE (data_region)",
    });
    legacy.indexes.push({
      table_name: "tenant_meta",
      index_name: "tenant_meta_data_region_key",
      is_unique: true,
      is_primary: false,
      definition: "CREATE UNIQUE INDEX tenant_meta_data_region_key ON tenant_core.tenant_meta USING btree (data_region)",
    });
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );
    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when an untracked canonical table has a standalone index", async () => {
    const legacy = canonicalLegacyRows(true);
    legacy.indexes.push({
      table_name: "tenant_meta",
      index_name: "tenant_meta_data_region_idx",
      is_unique: false,
      is_primary: false,
      definition: "CREATE INDEX tenant_meta_data_region_idx ON tenant_core.tenant_meta USING btree (data_region)",
    });
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );
    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when a canonical table is not an ordinary relation", async () => {
    const legacy = canonicalLegacyRows(false);
    legacy.tables[1] = { ...legacy.tables[1]!, relation_kind: "p" };
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );
    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when an unexpected relation exists in the tenant schema", async () => {
    const legacy = canonicalLegacyRows(false);
    legacy.tables.push({
      table_name: "tenant_meta_export",
      relation_kind: "v",
      rls_enabled: false,
      rls_forced: false,
    });
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );
    expect(stub.sql).toContain("rollback");
  });

  it("fails closed when a canonical timestamp has a type modifier", async () => {
    const legacy = canonicalLegacyRows(true);
    legacy.columns[0] = {
      ...legacy.columns[0]!,
      type_name: "timestamp(0) with time zone",
    };
    const stub = tenantCorePool({ legacy });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "untracked tenant_core schema does not exactly match a canonical legacy baseline",
    );
    expect(stub.sql).toContain("rollback");
  });

  it("rejects multiple tenant identity anchors before applying the singleton migration", async () => {
    const recorded = TENANT_CORE_MIGRATIONS.slice(0, 2).map((migration) => ({
      id: migration.id,
      checksum: checksum(migration.sql),
    }));
    const stub = tenantCorePool({ recorded, anchorCount: 2 });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "tenant_core has multiple identity anchors; automatic repair is prohibited",
    );

    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[2]?.sql);
    expect(stub.sql).toContain("rollback");
  });

  it("rejects multiple anchors in an untracked legacy catalog before writing tracking rows", async () => {
    const stub = tenantCorePool({
      legacy: canonicalLegacyRows(false),
      anchorCount: 2,
    });

    await expect(migrateTenantCore(stub.pool)).rejects.toThrow(
      "tenant_core has multiple identity anchors; automatic repair is prohibited",
    );

    expect(stub.sql).not.toContain(
      "insert into schema_migrations (id, checksum) values ($1, $2)",
    );
    expect(stub.sql).not.toContain(TENANT_CORE_MIGRATIONS[2]?.sql);
  });

  it("holds the anchor inspection transaction through singleton enforcement", async () => {
    const stub = tenantCorePool({
      legacy: canonicalLegacyRows(false),
      anchorCount: 1,
    });

    await expect(migrateTenantCore(stub.pool)).resolves.toEqual({
      applied: ["tenant-core/0003_single_tenant_anchor", "tenant-core/0004_data_region_ap"],
      skipped: TENANT_CORE_MIGRATIONS.slice(0, 2).map(({ id }) => id),
    });

    const firstInspection = stub.sql.indexOf(
      "alter table tenant_core.tenant_meta no force row level security",
    );
    const singletonMigration = stub.sql.indexOf(TENANT_CORE_MIGRATIONS[2]!.sql);
    expect(firstInspection).toBeGreaterThan(-1);
    expect(singletonMigration).toBeGreaterThan(firstInspection);
    expect(stub.sql.slice(firstInspection, singletonMigration)).not.toContain("commit");
  });
});

// Fresh provisioning uses this catalog, so directory-only migrations must fail CI.
it("lists every tenant-core SQL file in order", async () => {
  const files = (await readdir(new URL("../sql/tenant-core/", import.meta.url)))
    .filter(file => file.endsWith(".sql"))
    .sort()
    .map(file => `tenant-core/${file.replace(/\.sql$/u, "")}`);
  expect(TENANT_CORE_MIGRATIONS.map(migration => migration.id)).toEqual(files);
});
