import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TenantId } from "@opentenant/platform-core";
import { Pool } from "pg";
import { applyMigrations, type MigrationFile } from "../../../tooling/migrations/src/runner";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { PgModelRoutingStore } from "./model-routing-store";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function migrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../tooling/migrations/sql/control-plane");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

describeIntegration("PgModelRoutingStore against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });
  const store = new PgModelRoutingStore(pool);
  const alpha = "ten_alpha" as TenantId;

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await migrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'eu'),
              ('ten_beta', 'beta', 'Beta', 'active', 'ap')`,
    );
    await pool.query(
      `insert into model_allowlist_versions
        (allowlist_version, require_zero_retention, created_by, created_at)
       values ('v1', false, 'owner', '2026-09-05T00:00:00Z'),
              ('v2', true, 'owner', '2026-09-06T00:00:00Z')`,
    );
    await pool.query(
      `insert into model_allowlist_entries
        (allowlist_version, provider, model, region, retention_posture)
       values ('v1', 'synthetic', 'old', 'eu', 'provider_default'),
              ('v2', 'synthetic', 'current', 'eu', 'zero_retention')`,
    );
    await pool.query(
      `insert into model_consent_policy_versions (policy_version, published_by, published_at)
       values ('cb-1', 'owner', '2026-09-05T00:00:00Z'),
              ('cb-2', 'owner', '2026-09-06T00:00:00Z')`,
    );
  });

  afterAll(async () => pool.end());

  it("keeps policy and selection reads bound to the requested tenant", async () => {
    await pool.query(
      `insert into tenant_model_policies (tenant_id, require_zero_retention, updated_by)
       values ('ten_alpha', true, 'alpha-admin'), ('ten_beta', false, 'beta-admin')`,
    );
    await pool.query(
      `insert into model_routing_slots
        (tenant_id, module_id, use_case, scope, slot, provider, model, configured_by)
       values ('ten_alpha', 'support', 'triage', 'tenant_module_use_case', 'primary', 'synthetic', 'current', 'alpha-admin'),
              ('ten_beta', 'support', 'triage', 'tenant_module_use_case', 'primary', 'synthetic', 'other', 'beta-admin')`,
    );

    await expect(store.tenantPolicy(alpha)).resolves.toEqual({ tenantId: alpha, dataRegion: "eu", requireZeroRetention: true });
    await expect(store.tenantSelection(alpha, "support", "triage")).resolves.toEqual({
      moduleUseCase: { primary: { provider: "synthetic", model: "current" } },
    });
  });

  it("reads the newest allowlist and consent policy versions", async () => {
    await expect(store.allowlist()).resolves.toEqual({
      version: "v2",
      requireZeroRetention: true,
      entries: [{ provider: "synthetic", model: "current", region: "eu", retentionPosture: "zero_retention" }],
    });
    await expect(store.consentPolicyVersion()).resolves.toBe("cb-2");
  });

  it("returns only the requested tenant's active consent and exact pairs", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into model_cross_border_consents
          (consent_id, tenant_id, actor_id, granted_at, policy_version)
         values ('con_alpha', 'ten_alpha', 'alpha-admin', '2026-09-06T12:00:00Z', 'cb-2'),
                ('con_beta', 'ten_beta', 'beta-admin', '2026-09-06T12:00:00Z', 'cb-2')`,
      );
      await client.query(
        `insert into model_cross_border_consent_pairs
          (consent_id, provider, region, retention_posture)
         values ('con_alpha', 'synthetic', 'us', 'zero_retention'),
                ('con_beta', 'synthetic', 'us', 'provider_default')`,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    await expect(store.activeCrossBorderConsent(alpha)).resolves.toEqual({
      actorId: "alpha-admin",
      grantedAt: new Date("2026-09-06T12:00:00Z"),
      policyVersion: "cb-2",
      pairs: [{ provider: "synthetic", region: "us", retentionPosture: "zero_retention" }],
    });
  });

  it("maps installation scopes and writes linked stream evidence", async () => {
    await pool.query(
      `insert into model_routing_slots
        (tenant_id, module_id, use_case, scope, slot, provider, model, configured_by)
       values (null, null, 'triage', 'installation_use_case', 'primary', 'synthetic', 'current', 'owner'),
              (null, null, null, 'installation_default', 'secondary', 'synthetic', 'backup', 'owner'),
              (null, null, null, 'platform_default', 'primary', 'synthetic', 'fallback', 'owner')`,
    );
    await expect(store.installationDefaults("triage")).resolves.toEqual({
      byUseCase: { primary: { provider: "synthetic", model: "current" } },
      default: { secondary: { provider: "synthetic", model: "backup" } },
      platformDefault: { primary: { provider: "synthetic", model: "fallback" } },
    });

    const record = {
      operationKind: "stream",
      tenantId: alpha,
      moduleId: "support",
      useCase: "triage",
      provider: "synthetic",
      model: "current",
      keyOrigin: "installation",
      regionServed: "eu",
      retentionPosture: "zero_retention",
      allowlistVersion: "v2",
    } as const;
    await store.recordResolution({ ...record, resolutionId: "res_store" });
    await store.recordResolution({ ...record, resolutionId: "res_resolve", operationKind: "resolve" });
    await store.recordResolution({ ...record, resolutionId: "res_complete", operationKind: "complete" });
    await store.recordStreamTerminal({ resolutionId: "res_store", state: "failed", failureCode: "ADAPTER_ERROR" });
    const evidence = await pool.query(
      `select resolution.tenant_id, resolution.operation_kind, terminal.terminal_state, terminal.failure_code
         from model_resolution_events resolution
         left join model_stream_terminal_events terminal using (resolution_id)
        where resolution.resolution_id in ('res_store', 'res_resolve', 'res_complete')
        order by resolution.operation_kind`,
    );
    expect(evidence.rows).toEqual([
      { tenant_id: "ten_alpha", operation_kind: "complete", terminal_state: null, failure_code: null },
      { tenant_id: "ten_alpha", operation_kind: "resolve", terminal_state: null, failure_code: null },
      { tenant_id: "ten_alpha", operation_kind: "stream", terminal_state: "failed", failure_code: "ADAPTER_ERROR" },
    ]);
  });
});
