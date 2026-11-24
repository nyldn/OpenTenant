import type { InstallationAuthority, TenantId } from "@opentenant/auth";
import {
  decideModuleCapability,
  MODULE_CAPABILITIES,
  type ModuleCapability,
  type ModuleCapabilityDenialReason,
} from "@opentenant/module-sdk";
import type { Pool, PoolClient } from "pg";
import type { AuditActor } from "@opentenant/security";
import { PgAuditStore } from "./audit-store";

export interface GrantTenantCapabilityInput {
  readonly tenantId: TenantId;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly capability: string;
  readonly expiresAt: Date | null;
  readonly authority: InstallationAuthority;
}

export interface GrantModuleCreatorCapabilityInput {
  readonly tenantId: TenantId;
  readonly creatorUserId: string;
  readonly capability: string;
  readonly expiresAt: Date | null;
  readonly authority: InstallationAuthority;
}

export interface RevokeModuleCreatorCapabilityInput {
  readonly tenantId: TenantId;
  readonly creatorUserId: string;
  readonly capability: string;
  readonly authority: InstallationAuthority;
}

export interface AuthorizeModuleCapabilityInput {
  readonly tenantId: TenantId;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly capability: string;
  readonly runtimePermissions: readonly string[];
  readonly identityBacked: boolean;
  readonly actor: AuditActor;
  readonly correlationId: string;
}

export interface RevokeTenantCapabilityInput {
  readonly tenantId: TenantId;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly capability: string;
  readonly authority: InstallationAuthority;
}

export interface BoundedBrokerResult<T> {
  readonly value: T;
  readonly resultCount: number;
  readonly resultSize: "none" | "one" | "small" | "bounded";
}

export type ModuleCapabilityGrantResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: ModuleCapabilityDenialReason | "missing_grant_authority";
    };

type ModuleCapabilityGrantDenialReason = Exclude<ModuleCapabilityGrantResult, { allowed: true }>["reason"];

export type ModuleCapabilityRevocationResult = ModuleCapabilityGrantResult;
export type ModuleCreatorCapabilityAuthorityResult = ModuleCapabilityGrantResult;

export type AuthorizedCapabilityResult<T> =
  | { readonly allowed: true; readonly value: T }
  | { readonly allowed: false; readonly reason: ModuleCapabilityDenialReason };

interface CapabilityBindingRow {
  tenant_exists: boolean;
  module_version: string | null;
  ownership_scope: string | null;
  tenant_bound: boolean;
  active_version_bound: boolean;
  manifest_requested: boolean;
  creator_authorized: boolean;
  tenant_granted: boolean;
  grant_active: boolean;
  runtime_permission: string | null;
}

const correlationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BROKER_OPERATION_TIMEOUT_MS = 5_000;

async function boundedBrokerOperation<T>(operation: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Module capability broker operation timed out")),
          BROKER_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Control-plane boundary for immutable declarations, tenant grants, and fresh broker authorization. */
export class PgModuleCapabilityStore {
  private readonly audit: PgAuditStore;

  constructor(private readonly pool: Pool) {
    this.audit = new PgAuditStore(pool);
  }

  async grantModuleCreatorCapability(
    input: GrantModuleCreatorCapabilityInput,
  ): Promise<ModuleCreatorCapabilityAuthorityResult> {
    return this.transaction(async (client) => {
      let reason: ModuleCapabilityGrantDenialReason;
      if (
        input.authority.kind !== "installation_owner"
        || !input.authority.permissions.includes("owner.support.module_grant.manage")
      ) {
        reason = "missing_grant_authority";
      } else if (!MODULE_CAPABILITIES.includes(input.capability as ModuleCapability)) {
        reason = "unknown_capability";
      } else {
        await client.query(
          `update module_creator_capability_authorities
              set revoked_at = clock_timestamp()
            where tenant_id = $1 and creator_user_id = $2 and capability = $3
              and revoked_at is null and expires_at <= clock_timestamp()`,
          [input.tenantId, input.creatorUserId, input.capability],
        );
        const { rows } = await client.query<{ authority_id: string }>(
          `insert into module_creator_capability_authorities
            (tenant_id, creator_user_id, capability, granted_by_user_id, expires_at)
           select tenant.tenant_id, creator.user_id, $3, $4, $5
             from tenants tenant
             join platform_users creator on creator.user_id = $2
            where tenant.tenant_id = $1
           on conflict (tenant_id, creator_user_id, capability)
             where revoked_at is null
           do nothing
           returning authority_id`,
          [input.tenantId, input.creatorUserId, input.capability,
            input.authority.userId, input.expiresAt],
        );
        if (rows[0]?.authority_id) {
          await this.appendCreatorAuthorityDecision(client, input, {
            action: "module.creator_capability.granted",
            decision: "allowed",
            reason: null,
          });
          return { allowed: true };
        }
        reason = "creator_authority_denied";
      }
      await this.appendCreatorAuthorityDecision(client, input, {
        action: "module.creator_capability.grant_denied",
        decision: "denied",
        reason,
      });
      return { allowed: false, reason };
    });
  }

  async revokeModuleCreatorCapability(
    input: RevokeModuleCreatorCapabilityInput,
  ): Promise<ModuleCreatorCapabilityAuthorityResult> {
    return this.transaction(async (client) => {
      let reason: ModuleCapabilityGrantDenialReason;
      if (
        input.authority.kind !== "installation_owner"
        || !input.authority.permissions.includes("owner.support.module_grant.manage")
      ) {
        reason = "missing_grant_authority";
      } else if (!MODULE_CAPABILITIES.includes(input.capability as ModuleCapability)) {
        reason = "unknown_capability";
      } else {
        const { rows } = await client.query<{ revoked: boolean }>(
          `update module_creator_capability_authorities
              set revoked_at = clock_timestamp()
            where tenant_id = $1 and creator_user_id = $2 and capability = $3
              and revoked_at is null
          returning true as revoked`,
          [input.tenantId, input.creatorUserId, input.capability],
        );
        if (rows[0]?.revoked) {
          await this.appendCreatorAuthorityDecision(client, input, {
            action: "module.creator_capability.revoked",
            decision: "allowed",
            reason: null,
          });
          return { allowed: true };
        }
        reason = "creator_authority_denied";
      }
      await this.appendCreatorAuthorityDecision(client, input, {
        action: "module.creator_capability.revoke_denied",
        decision: "denied",
        reason,
      });
      return { allowed: false, reason };
    });
  }

  async grantTenantCapability(input: GrantTenantCapabilityInput): Promise<ModuleCapabilityGrantResult> {
    return this.transaction(async (client) => {
      let reason: ModuleCapabilityGrantDenialReason;
      if (
        input.authority.kind !== "installation_owner"
        || !input.authority.permissions.includes("owner.support.module_grant.manage")
      ) {
        reason = "missing_grant_authority";
      } else if (!MODULE_CAPABILITIES.includes(input.capability as ModuleCapability)) {
        reason = "unknown_capability";
      } else {
        const { rows: declarations } = await client.query<{ capability: string }>(
          `select capability
             from module_version_capabilities
            where module_key = $1 and module_version = $2 and capability = $3`,
          [input.moduleKey, input.moduleVersion, input.capability],
        );
        if (!declarations[0]) reason = "manifest_not_requested";
        else {
          await client.query(
            `update tenant_module_capability_grants
                set revoked_at = clock_timestamp()
              where tenant_id = $1 and module_key = $2 and module_version = $3
                and capability = $4 and revoked_at is null
                and expires_at <= clock_timestamp()`,
            [input.tenantId, input.moduleKey, input.moduleVersion, input.capability],
          );
          const { rows } = await client.query<{ granted: boolean }>(
            `insert into tenant_module_capability_grants
              (tenant_id, module_key, module_version, capability,
               granted_by_user_id, expires_at)
             select $1, capability.module_key, capability.module_version,
                    capability.capability, $5, $6
               from module_version_capabilities capability
               join module_creator_capability_authorities creator_authority
                 on creator_authority.authority_id = capability.creator_authority_id
               join tenant_modules assignment
                 on assignment.module_key = capability.module_key
                and assignment.module_version = capability.module_version
                and assignment.tenant_id = $1 and assignment.enabled = true
               join module_catalog catalog on catalog.module_key = capability.module_key
               cross join installation_metadata installation
              where capability.module_key = $2 and capability.module_version = $3
                and capability.capability = $4
                and creator_authority.tenant_id = $1
                and creator_authority.revoked_at is null
                and (creator_authority.expires_at is null
                     or creator_authority.expires_at > clock_timestamp())
                and installation.singleton = true
                and (
                  catalog.ownership_scope = 'platform'
                  or (catalog.ownership_scope = 'installation'
                      and catalog.installation_id = installation.installation_id)
                  or (catalog.ownership_scope = 'tenant'
                      and catalog.installation_id = installation.installation_id
                      and catalog.owner_tenant_id = $1)
                )
             on conflict (tenant_id, module_key, module_version, capability)
               where revoked_at is null
             do nothing
             returning true as granted`,
            [input.tenantId, input.moduleKey, input.moduleVersion, input.capability,
              input.authority.userId, input.expiresAt],
          );
          if (rows[0]?.granted) {
            await this.appendDecision(client, {
              tenantId: input.tenantId,
              actor: { kind: "installation_owner", userId: input.authority.userId },
              moduleKey: input.moduleKey,
              moduleVersion: input.moduleVersion,
              capability: input.capability,
              correlationId: null,
              action: "module.capability.granted",
              decision: "allowed",
              reason: null,
            });
            return { allowed: true };
          }
          reason = "tenant_binding_invalid";
        }
      }
      await this.appendDecision(client, {
        tenantId: await this.existingTenantScope(client, input.tenantId),
        actor: { kind: "installation_owner", userId: input.authority.userId },
        moduleKey: input.moduleKey,
        moduleVersion: input.moduleVersion,
        capability: input.capability,
        correlationId: null,
        action: "module.capability.grant_denied",
        decision: "denied",
        reason,
      });
      return { allowed: false, reason };
    });
  }

  async revokeTenantCapability(input: RevokeTenantCapabilityInput): Promise<ModuleCapabilityRevocationResult> {
    return this.transaction(async (client) => {
      let reason: ModuleCapabilityGrantDenialReason;
      if (
        input.authority.kind !== "installation_owner"
        || !input.authority.permissions.includes("owner.support.module_grant.manage")
      ) {
        reason = "missing_grant_authority";
      } else if (!MODULE_CAPABILITIES.includes(input.capability as ModuleCapability)) {
        reason = "unknown_capability";
      } else {
        const { rows } = await client.query<{ revoked: boolean }>(
          `update tenant_module_capability_grants
              set revoked_at = clock_timestamp()
            where tenant_id = $1 and module_key = $2 and module_version = $3
              and capability = $4 and revoked_at is null
          returning true as revoked`,
          [input.tenantId, input.moduleKey, input.moduleVersion, input.capability],
        );
        if (rows[0]?.revoked) {
          await this.appendDecision(client, {
            tenantId: input.tenantId,
            actor: { kind: "installation_owner", userId: input.authority.userId },
            moduleKey: input.moduleKey,
            moduleVersion: input.moduleVersion,
            capability: input.capability,
            correlationId: null,
            action: "module.capability.revoked",
            decision: "allowed",
            reason: null,
          });
          return { allowed: true };
        }
        reason = "tenant_grant_missing";
      }
      await this.appendDecision(client, {
        tenantId: await this.existingTenantScope(client, input.tenantId),
        actor: { kind: "installation_owner", userId: input.authority.userId },
        moduleKey: input.moduleKey,
        moduleVersion: input.moduleVersion,
        capability: input.capability,
        correlationId: null,
        action: "module.capability.revoke_denied",
        decision: "denied",
        reason,
      });
      return { allowed: false, reason };
    });
  }

  async withAuthorizedCapability<T>(
    input: AuthorizeModuleCapabilityInput,
    operation: () => Promise<BoundedBrokerResult<T>>,
  ): Promise<AuthorizedCapabilityResult<T>> {
    if (!correlationIdPattern.test(input.correlationId)) {
      throw new Error("Module capability invocation requires a valid correlation ID");
    }
    const outcome = await this.transaction(async (client) => {
      const { rows } = await client.query<CapabilityBindingRow>(
        `select exists(select 1 from tenants where tenant_id = $1) as tenant_exists,
                assignment.module_version,
                catalog.ownership_scope,
                coalesce(
                  catalog.ownership_scope = 'platform'
                  or (catalog.ownership_scope = 'installation'
                      and catalog.installation_id = installation.installation_id)
                  or (catalog.ownership_scope = 'tenant'
                      and catalog.installation_id = installation.installation_id
                      and catalog.owner_tenant_id = $1), false
                ) as tenant_bound,
                coalesce(assignment.enabled = true
                  and assignment.module_version = capability.module_version, false)
                  as active_version_bound,
                capability.capability is not null as manifest_requested,
                coalesce(creator_authority.authority_id is not null
                  and creator_authority.revoked_at is null
                  and (creator_authority.expires_at is null
                       or creator_authority.expires_at > clock_timestamp()), false)
                  as creator_authorized,
                capability_grant.capability is not null as tenant_granted,
                coalesce(capability_grant.revoked_at is null
                  and (capability_grant.expires_at is null
                       or capability_grant.expires_at > clock_timestamp()), false)
                  as grant_active,
                capability.runtime_permission
           from module_catalog catalog
           cross join installation_metadata installation
           left join tenant_modules assignment
             on assignment.module_key = catalog.module_key and assignment.tenant_id = $1
            and assignment.module_version = $4
           left join module_version_capabilities capability
             on capability.module_key = catalog.module_key
            and capability.module_version = $4
            and capability.capability = $3
           left join module_creator_capability_authorities creator_authority
             on creator_authority.authority_id = capability.creator_authority_id
            and creator_authority.tenant_id = $1
           left join lateral (
             select candidate.capability, candidate.revoked_at, candidate.expires_at
               from tenant_module_capability_grants candidate
              where candidate.tenant_id = assignment.tenant_id
                and candidate.module_key = capability.module_key
                and candidate.module_version = capability.module_version
                and candidate.capability = capability.capability
              order by candidate.granted_at desc, candidate.grant_id desc
              limit 1
           ) capability_grant on true
          where catalog.module_key = $2 and installation.singleton = true`,
        [input.tenantId, input.moduleKey, input.capability, input.moduleVersion],
      );
      const row = rows[0];
      const decision = decideModuleCapability({
        moduleKey: input.moduleKey,
        capability: input.capability,
        ownershipScope: row?.ownership_scope ?? "unknown",
        tenantBound: row?.tenant_bound ?? false,
        activeVersionBound: row?.active_version_bound ?? false,
        manifestRequested: row?.manifest_requested ?? false,
        creatorAuthorized: row?.creator_authorized ?? false,
        tenantGranted: row?.tenant_granted ?? false,
        grantActive: row?.grant_active ?? false,
        identityBacked: input.identityBacked,
        requiredRuntimePermission: row?.runtime_permission ?? null,
        runtimePermissions: input.runtimePermissions,
      });
      if (!decision.allowed) {
        await this.appendDecision(client, {
          tenantId: row?.tenant_exists ? input.tenantId : null,
          actor: input.actor,
          moduleKey: input.moduleKey,
          moduleVersion: input.moduleVersion,
          capability: input.capability,
          correlationId: input.correlationId,
          action: "module.capability.denied",
          decision: "denied",
          reason: decision.reason,
        });
        return decision;
      }

      const lock = await client.query(
        `select 1
           from module_version_capabilities capability
           join module_creator_capability_authorities creator_authority
             on creator_authority.authority_id = capability.creator_authority_id
            and creator_authority.tenant_id = $1
            and creator_authority.revoked_at is null
            and (creator_authority.expires_at is null
                 or creator_authority.expires_at > clock_timestamp())
           join tenant_module_capability_grants capability_grant
             on capability_grant.module_key = capability.module_key
            and capability_grant.module_version = capability.module_version
            and capability_grant.capability = capability.capability
           join tenant_modules assignment
             on assignment.tenant_id = capability_grant.tenant_id
            and assignment.module_key = capability_grant.module_key
            and assignment.module_version = capability_grant.module_version
          where capability_grant.tenant_id = $1 and capability_grant.module_key = $2
            and capability_grant.module_version = $3 and capability_grant.capability = $4
            and assignment.enabled = true
            and capability_grant.revoked_at is null
            and (capability_grant.expires_at is null
                 or capability_grant.expires_at > clock_timestamp())
          for share of creator_authority, capability, capability_grant, assignment`,
        [input.tenantId, input.moduleKey, input.moduleVersion, input.capability],
      );
      if (lock.rowCount !== 1) {
        const denied = { allowed: false as const, reason: "grant_inactive" as const };
        await this.appendDecision(client, {
          tenantId: input.tenantId,
          actor: input.actor,
          moduleKey: input.moduleKey,
          moduleVersion: input.moduleVersion,
          capability: input.capability,
          correlationId: input.correlationId,
          action: "module.capability.denied",
          decision: "denied",
          reason: denied.reason,
        });
        return denied;
      }

      try {
        const result = await boundedBrokerOperation(operation);
        if (
          !Number.isInteger(result.resultCount)
          || result.resultCount < 0
          || result.resultCount > 25
          || !["none", "one", "small", "bounded"].includes(result.resultSize)
        ) {
          throw new Error("Broker operation returned invalid bounded evidence");
        }
        await this.appendDecision(client, {
          tenantId: input.tenantId,
          actor: input.actor,
          moduleKey: input.moduleKey,
          moduleVersion: input.moduleVersion,
          capability: input.capability,
          correlationId: input.correlationId,
          action: "module.capability.used",
          decision: "allowed",
          reason: null,
          resultCount: result.resultCount,
          resultSize: result.resultSize,
        });
        return { allowed: true as const, value: result.value };
      } catch {
        await this.appendDecision(client, {
          tenantId: input.tenantId,
          actor: input.actor,
          moduleKey: input.moduleKey,
          moduleVersion: input.moduleVersion,
          capability: input.capability,
          correlationId: input.correlationId,
          action: "module.capability.error",
          decision: "denied",
          reason: "broker_operation_failed",
        });
        return { failed: true as const };
      }
    });
    if ("failed" in outcome) throw new Error("Module capability broker operation failed");
    return outcome;
  }

  private async appendDecision(client: PoolClient, input: {
    tenantId: TenantId | null;
    actor: AuditActor;
    moduleKey: string;
    moduleVersion: string | null;
    capability: string | null;
    correlationId: string | null;
    action: string;
    decision: "allowed" | "denied";
    reason: string | null;
    requestCount?: number;
    authorizedCount?: number;
    resultCount?: number;
    resultSize?: string;
  }): Promise<void> {
    await this.audit.appendWithClient(client, {
      occurredAt: new Date(),
      actor: input.actor,
      tenantId: await this.existingTenantScope(client, input.tenantId),
      action: input.action,
      subject: input.moduleVersion === null
        ? input.moduleKey
        : `${input.moduleKey}@${input.moduleVersion}`,
      detail: {
        moduleVersion: input.moduleVersion,
        capability: input.capability,
        operation: input.correlationId === null ? null : "support.ticket.summary.list",
        correlationId: input.correlationId,
        decision: input.decision,
        reason: input.reason,
        ...(input.requestCount === undefined ? {} : { requestCount: input.requestCount }),
        ...(input.authorizedCount === undefined ? {} : { authorizedCount: input.authorizedCount }),
        ...(input.resultCount === undefined ? {} : { resultCount: input.resultCount }),
        ...(input.resultSize === undefined ? {} : { resultSize: input.resultSize }),
      },
    });
  }

  private async appendCreatorAuthorityDecision(
    client: PoolClient,
    input: GrantModuleCreatorCapabilityInput | RevokeModuleCreatorCapabilityInput,
    outcome: { action: string; decision: "allowed" | "denied"; reason: string | null },
  ): Promise<void> {
    await this.audit.appendWithClient(client, {
      occurredAt: new Date(),
      actor: { kind: "installation_owner", userId: input.authority.userId },
      tenantId: await this.existingTenantScope(client, input.tenantId),
      action: outcome.action,
      subject: input.creatorUserId,
      detail: {
        capability: input.capability,
        decision: outcome.decision,
        reason: outcome.reason,
      },
    });
  }

  private async existingTenantScope(
    client: PoolClient,
    tenantId: TenantId | null,
  ): Promise<TenantId | null> {
    if (tenantId === null) return null;
    const { rows } = await client.query<{ tenant_exists: boolean }>(
      "select exists(select 1 from tenants where tenant_id = $1) as tenant_exists",
      [tenantId],
    );
    return rows[0]?.tenant_exists ? tenantId : null;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
