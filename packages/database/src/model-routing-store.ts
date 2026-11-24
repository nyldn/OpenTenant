import { randomUUID } from "node:crypto";
import type {
  CrossBorderConsent,
  DataRegion,
  InstallationModelDefaults,
  ModelAllowlist,
  ModelOperationKind,
  ModelResolutionRecord,
  ModelRoutingStore,
  ModelSlots,
  ModelStreamTerminalRecord,
  RetentionPosture,
  TenantId,
  TenantModelPolicy,
  TenantModelSelection,
} from "@opentenant/platform-core";
import type { Pool } from "pg";

export class ModelRoutingStoreIntegrityError extends Error {}

interface SlotRow {
  scope: "tenant_module_use_case" | "tenant_module_default" | "installation_use_case" | "installation_default" | "platform_default";
  slot: "primary" | "secondary";
  provider: string;
  model: string;
}

function slots(rows: readonly SlotRow[], scope: SlotRow["scope"]): ModelSlots | undefined {
  const selected = rows.filter((row) => row.scope === scope);
  if (selected.length === 0) return undefined;
  return Object.fromEntries(selected.map((row) => [row.slot, { provider: row.provider, model: row.model }])) as ModelSlots;
}

export class PgModelRoutingStore implements ModelRoutingStore {
  constructor(private readonly pool: Pool) {}

  async tenantPolicy(tenantId: TenantId): Promise<TenantModelPolicy> {
    const result = await this.pool.query<{
      tenant_id: string;
      data_region: DataRegion;
      require_zero_retention: boolean;
    }>(
      `select tenant.tenant_id, tenant.data_region,
              coalesce(policy.require_zero_retention, false) as require_zero_retention
         from tenants tenant
         left join tenant_model_policies policy on policy.tenant_id = tenant.tenant_id
        where tenant.tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new ModelRoutingStoreIntegrityError("tenant model policy scope does not exist");
    return {
      tenantId: row.tenant_id as TenantId,
      dataRegion: row.data_region,
      requireZeroRetention: row.require_zero_retention,
    };
  }

  async allowlist(): Promise<ModelAllowlist> {
    const result = await this.pool.query<{
      allowlist_version: string;
      require_zero_retention: boolean;
      provider: string | null;
      model: string | null;
      region: DataRegion | null;
      retention_posture: RetentionPosture | null;
      upstream_provider: string | null;
      upstream_data_policy: string | null;
    }>(
      `with current_version as (
         select published.allowlist_version, published.require_zero_retention
           from model_allowlist_versions published
          order by published.created_at desc, published.allowlist_version desc
          limit 1
       )
       select current_version.allowlist_version, current_version.require_zero_retention,
              entry.provider, entry.model, entry.region, entry.retention_posture,
              entry.upstream_provider, entry.upstream_data_policy
         from current_version
         left join model_allowlist_entries entry
           on entry.allowlist_version = current_version.allowlist_version
        order by entry.provider, entry.model`,
    );
    const head = result.rows[0];
    if (!head) throw new ModelRoutingStoreIntegrityError("no model allowlist has been published");
    return {
      version: head.allowlist_version,
      requireZeroRetention: head.require_zero_retention,
      entries: result.rows.flatMap((row) => {
        if (!row.provider || !row.model || !row.region || !row.retention_posture) return [];
        const pin = row.upstream_provider && row.upstream_data_policy
          ? { upstreamProvider: row.upstream_provider, dataPolicy: row.upstream_data_policy }
          : undefined;
        return [{
          provider: row.provider,
          model: row.model,
          region: row.region,
          retentionPosture: row.retention_posture,
          ...(pin ? { pin } : {}),
        }];
      }),
    };
  }

  async tenantSelection(
    tenantId: TenantId,
    moduleId: string,
    useCase: string,
  ): Promise<TenantModelSelection> {
    const result = await this.pool.query<SlotRow>(
      `select scope, slot, provider, model
         from model_routing_slots
        where tenant_id = $1
          and module_id = $2
          and ((scope = 'tenant_module_use_case' and use_case = $3)
            or (scope = 'tenant_module_default' and use_case is null))
        order by scope, slot`,
      [tenantId, moduleId, useCase],
    );
    const moduleUseCase = slots(result.rows, "tenant_module_use_case");
    const moduleDefault = slots(result.rows, "tenant_module_default");
    return {
      ...(moduleUseCase ? { moduleUseCase } : {}),
      ...(moduleDefault ? { moduleDefault } : {}),
    };
  }

  async installationDefaults(useCase: string): Promise<InstallationModelDefaults> {
    const result = await this.pool.query<SlotRow>(
      `select scope, slot, provider, model
         from model_routing_slots
        where tenant_id is null
          and ((scope = 'installation_use_case' and use_case = $1)
            or (scope in ('installation_default', 'platform_default') and use_case is null))
        order by scope, slot`,
      [useCase],
    );
    const installationDefault = slots(result.rows, "installation_default");
    const platformDefault = slots(result.rows, "platform_default");
    return {
      byUseCase: slots(result.rows, "installation_use_case") ?? {},
      ...(installationDefault ? { default: installationDefault } : {}),
      ...(platformDefault ? { platformDefault } : {}),
    };
  }

  async activeCrossBorderConsent(tenantId: TenantId): Promise<CrossBorderConsent | null> {
    const result = await this.pool.query<{
      consent_id: string;
      actor_id: string;
      granted_at: Date;
      policy_version: string;
      provider: string | null;
      region: DataRegion | null;
      retention_posture: RetentionPosture | null;
    }>(
      `select consent.consent_id, consent.actor_id, consent.granted_at, consent.policy_version,
              pair.provider, pair.region, pair.retention_posture
         from model_cross_border_consents consent
         left join model_cross_border_consent_pairs pair on pair.consent_id = consent.consent_id
        where consent.tenant_id = $1 and consent.withdrawn_at is null
        order by pair.provider, pair.region`,
      [tenantId],
    );
    const head = result.rows[0];
    if (!head) return null;
    return {
      actorId: head.actor_id,
      grantedAt: new Date(head.granted_at),
      policyVersion: head.policy_version,
      pairs: result.rows.flatMap((row) =>
        row.provider && row.region && row.retention_posture
          ? [{ provider: row.provider, region: row.region, retentionPosture: row.retention_posture }]
          : []),
    };
  }

  async consentPolicyVersion(): Promise<string> {
    const result = await this.pool.query<{ policy_version: string }>(
      `select policy_version from model_consent_policy_versions
        order by published_at desc, policy_version desc limit 1`,
    );
    const row = result.rows[0];
    if (!row) throw new ModelRoutingStoreIntegrityError("no cross-border consent policy has been published");
    return row.policy_version;
  }

  async recordResolution(record: ModelResolutionRecord): Promise<void> {
    const resolutionId = record.resolutionId ?? `res_${randomUUID()}`;
    const operationKind: ModelOperationKind = record.operationKind ?? "resolve";
    await this.pool.query(
      `insert into model_resolution_events
        (resolution_id, tenant_id, module_id, use_case, provider, model, key_origin,
         region_served, retention_posture, allowlist_version, operation_kind)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [resolutionId, record.tenantId, record.moduleId, record.useCase, record.provider,
        record.model, record.keyOrigin, record.regionServed, record.retentionPosture,
        record.allowlistVersion, operationKind],
    );
  }

  async recordStreamTerminal(record: ModelStreamTerminalRecord): Promise<void> {
    await this.pool.query(
      `insert into model_stream_terminal_events (resolution_id, terminal_state, failure_code)
       values ($1, $2, $3)`,
      [record.resolutionId, record.state, record.state === "failed" ? record.failureCode : null],
    );
  }
}
