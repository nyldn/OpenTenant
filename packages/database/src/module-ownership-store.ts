import type { Pool, PoolClient } from "pg";
import type { InstallationAuthority, TenantId } from "@opentenant/auth";
import type { AuditActor } from "@opentenant/security";
import {
  normalizeModuleCapabilityRequests,
  type ModuleCapabilityRequest,
  type ModuleManifest,
} from "@opentenant/module-sdk";
import {
  copyReviewedModuleForInstallation,
  createTenantPrivateModule,
  isAllowedRemoteModuleUrl,
  type ModuleCatalogEntry,
} from "@opentenant/platform-core";
import { PgAuditStore } from "./audit-store";

export interface CreateTenantPrivateModuleRecord {
  readonly moduleKey: string;
  readonly version: string;
  readonly runtime: "native" | "remote";
  readonly tenantId: TenantId;
  readonly artifactDigest: string;
  readonly remoteUrl: string | null;
  readonly createdByUserId: string;
  readonly capabilityRequests?: readonly ModuleCapabilityRequest[];
  /** Reviewed permission snapshot, bound to this exact artifact identity. */
  readonly authorizationManifest?: ModuleManifest;
}

export interface AssignModuleToTenant {
  readonly moduleKey: string;
  readonly version: string;
  readonly tenantId: TenantId;
  readonly enabled: boolean;
  readonly settings: Record<string, unknown>;
  readonly actor: AuditActor;
}

export interface PromoteTenantModuleRecord {
  readonly sourceModuleKey: string;
  readonly sourceVersion: string;
  readonly sourceArtifactDigest: string;
  readonly targetModuleKey: string;
  readonly targetVersion: string;
  readonly targetArtifactDigest: string;
  readonly targetRemoteUrl: string | null;
  readonly reviewedByUserId: string;
  readonly reviewedAt: Date;
  readonly authority: InstallationAuthority;
  readonly authorizationManifest?: ModuleManifest;
}

interface SourceModuleRow {
  module_key: string;
  version: string;
  runtime: "native" | "remote";
  artifact_digest: string;
  digest_kind: "sha256_artifact" | "legacy_identity";
  installation_id: string;
  owner_tenant_id: TenantId;
  created_by_user_id: string | null;
}

export interface ModuleOwnershipStoreOptions {
  /** Exact provider-managed deployment hostnames; empty means remote modules are denied. */
  readonly allowedRemoteHosts?: readonly string[];
  /** Host composition owns provider selection. Hooks share the mutation client. */
  readonly queueEntitlementSync?: (client: PoolClient, input: { tenantId: string; moduleKey: string }) => Promise<void>;
  readonly queueManifestPublication?: (client: PoolClient, manifest: ModuleManifest | null) => Promise<void>;
}

function reviewedManifest(input: { moduleKey: string; version: string; runtime: string; authorizationManifest?: ModuleManifest | undefined }): ModuleManifest | null {
  const manifest = input.authorizationManifest;
  if (!manifest) return null;
  if (manifest.key !== input.moduleKey || manifest.version !== input.version || manifest.runtime !== input.runtime
    || manifest.rolePermissions === undefined) throw new Error("Reviewed authorization manifest identity mismatch");
  return manifest;
}

function validateRemoteUrl(
  runtime: "native" | "remote",
  remoteUrl: string | null,
  allowedRemoteHosts: readonly string[],
): void {
  if (runtime === "native") {
    if (remoteUrl !== null) throw new Error("Native module artifacts cannot declare a remote URL");
    return;
  }
  if (remoteUrl === null) throw new Error("Remote module artifacts require an HTTPS URL");
  if (!isAllowedRemoteModuleUrl(remoteUrl, allowedRemoteHosts)) {
    throw new Error("Remote module destination is not an allowlisted HTTPS deployment host");
  }
}

/** PostgreSQL composition boundary for immutable module ownership and versions. */
export class PgModuleOwnershipStore {
  private readonly audit: PgAuditStore;
  private readonly allowedRemoteHosts: readonly string[];

  constructor(private readonly pool: Pool, private readonly options: ModuleOwnershipStoreOptions = {}) {
    this.audit = new PgAuditStore(pool);
    this.allowedRemoteHosts = Object.freeze([...(options.allowedRemoteHosts ?? [])]);
  }

  async createTenantPrivate(input: CreateTenantPrivateModuleRecord): Promise<ModuleCatalogEntry> {
    validateRemoteUrl(input.runtime, input.remoteUrl, this.allowedRemoteHosts);
    const manifest = reviewedManifest(input);
    const capabilityRequests = normalizeModuleCapabilityRequests(
      input.moduleKey,
      input.capabilityRequests ?? [],
    );
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ installation_id: string }>(
        `select installation_id
           from installation_metadata
          where singleton = true
            and exists (select 1 from tenants where tenant_id = $1)`,
        [input.tenantId],
      );
      const installationId = rows[0]?.installation_id;
      if (!installationId) throw new Error("Tenant is not bound to this installation");
      const creatorAuthorities = new Map<string, string>();
      if (capabilityRequests.length > 0) {
        const { rows: authorities } = await client.query<{
          authority_id: string;
          capability: string;
        }>(
          `select authority_id, capability
             from module_creator_capability_authorities
            where tenant_id = $1 and creator_user_id = $2
              and capability = any($3::text[])
              and revoked_at is null
              and (expires_at is null or expires_at > clock_timestamp())
            for share`,
          [input.tenantId, input.createdByUserId,
            capabilityRequests.map((request) => request.capability)],
        );
        for (const authority of authorities) {
          creatorAuthorities.set(authority.capability, authority.authority_id);
        }
        if (capabilityRequests.some((request) => !creatorAuthorities.has(request.capability))) {
          throw new Error("Persisted module creator authority does not allow a requested capability");
        }
      }
      const module = createTenantPrivateModule({ ...input, installationId });

      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, remote_url,
           ownership_scope, installation_id, owner_tenant_id, authorization_manifest)
         values ($1, $2, $3, false, $4, 'tenant', $5, $6, $7::jsonb)`,
        [module.moduleKey, module.version, module.runtime, input.remoteUrl, installationId, input.tenantId,
          manifest ? JSON.stringify(manifest) : null],
      );
      for (const request of capabilityRequests) {
        await client.query(
          `insert into module_version_capabilities
            (module_key, module_version, capability, runtime_permission,
             creator_user_id, creator_authority_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [module.moduleKey, module.version, request.capability, request.runtimePermission,
            input.createdByUserId, creatorAuthorities.get(request.capability)],
        );
      }
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, remote_url, created_by_user_id)
         values ($1, $2, $3, $4, $5)`,
        [module.moduleKey, module.version, module.artifactDigest, input.remoteUrl, input.createdByUserId],
      );
      await this.options.queueManifestPublication?.(client, manifest);
      await this.audit.appendWithClient(client, {
        occurredAt: new Date(),
        actor: { kind: "user", userId: input.createdByUserId },
        tenantId: input.tenantId,
        action: "module.created_private",
        subject: module.moduleKey,
        detail: {
          version: module.version,
          artifactDigest: module.artifactDigest,
          ownershipScope: "tenant",
          capabilityRequestCount: capabilityRequests.length,
        },
      });
      return module;
    });
  }

  async assignToTenant(input: AssignModuleToTenant): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ assigned: boolean; ownership_scope: string }>(
      `insert into tenant_modules
        (tenant_id, module_key, module_version, enabled, settings)
       select $3, catalog.module_key, version.version, $4, $5::jsonb
         from module_catalog catalog
         join module_versions version
           on version.module_key = catalog.module_key and version.version = $2
         cross join installation_metadata installation
        where catalog.module_key = $1
          and installation.singleton = true
          and (
            catalog.ownership_scope = 'platform'
            or (catalog.ownership_scope = 'installation'
                and catalog.installation_id = installation.installation_id)
            or (catalog.ownership_scope = 'tenant'
                and catalog.installation_id = installation.installation_id
                and catalog.owner_tenant_id = $3)
          )
       on conflict (tenant_id, module_key) do update
         set module_version = excluded.module_version,
             enabled = excluded.enabled,
             settings = excluded.settings
       returning true as assigned,
         (select ownership_scope from module_catalog where module_key = tenant_modules.module_key)`,
      [input.moduleKey, input.version, input.tenantId, input.enabled, JSON.stringify(input.settings)],
      );
      const assigned = rows[0];
      if (assigned?.assigned !== true) return false;
      await this.options.queueEntitlementSync?.(client, { tenantId: input.tenantId, moduleKey: input.moduleKey });
      await this.audit.appendWithClient(client, {
        occurredAt: new Date(),
        actor: input.actor,
        tenantId: input.tenantId,
        action: "module.assigned",
        subject: input.moduleKey,
        detail: {
          version: input.version,
          enabled: input.enabled,
          ownershipScope: assigned.ownership_scope,
        },
      });
      return true;
    });
  }

  async promoteTenantModule(input: PromoteTenantModuleRecord): Promise<ModuleCatalogEntry> {
    if (
      input.authority.kind !== "installation_owner"
      || !input.authority.permissions.includes("owner.module.publish_installation")
    ) {
      throw new Error("Module promotion requires installation publication authority");
    }
    return this.transaction(async (client) => {
      const { rows } = await client.query<SourceModuleRow>(
        `select catalog.module_key, version.version, catalog.runtime,
                version.artifact_digest, version.digest_kind, catalog.installation_id,
                catalog.owner_tenant_id, version.created_by_user_id
           from module_catalog catalog
           join module_versions version on version.module_key = catalog.module_key
          where catalog.module_key = $1 and version.version = $2
            and catalog.ownership_scope = 'tenant'
          for share of catalog, version`,
        [input.sourceModuleKey, input.sourceVersion],
      );
      const source = rows[0];
      if (!source?.installation_id || !source.owner_tenant_id) {
        throw new Error("Module promotion requires a tenant-private source");
      }
      const sourceModule: ModuleCatalogEntry = Object.freeze({
        moduleKey: source.module_key,
        version: source.version,
        runtime: source.runtime,
        enabledByDefault: false,
        artifactDigest: source.artifact_digest,
        digestKind: source.digest_kind,
        createdByUserId: source.created_by_user_id,
        ownership: Object.freeze({
          scope: "tenant" as const,
          installationId: source.installation_id,
          tenantId: source.owner_tenant_id,
        }),
        promotion: null,
      });
      const promoted = copyReviewedModuleForInstallation({
        source: sourceModule,
        review: {
          sourceArtifactDigest: input.sourceArtifactDigest,
          reviewedByUserId: input.reviewedByUserId,
          publishedByUserId: input.authority.userId,
          reviewedAt: input.reviewedAt,
        },
        target: {
          moduleKey: input.targetModuleKey,
          version: input.targetVersion,
          artifactDigest: input.targetArtifactDigest,
        },
      });
      validateRemoteUrl(promoted.runtime, input.targetRemoteUrl, this.allowedRemoteHosts);
      const manifest = reviewedManifest({ ...promoted, authorizationManifest: input.authorizationManifest });

      await client.query(
        `insert into module_catalog
          (module_key, version, runtime, enabled_by_default, remote_url,
           ownership_scope, installation_id, owner_tenant_id, authorization_manifest)
         values ($1, $2, $3, false, $4, 'installation', $5, null, $6::jsonb)`,
        [promoted.moduleKey, promoted.version, promoted.runtime, input.targetRemoteUrl,
          promoted.ownership.scope === "installation" ? promoted.ownership.installationId : null,
          manifest ? JSON.stringify(manifest) : null],
      );
      await client.query(
        `insert into module_versions
          (module_key, version, artifact_digest, remote_url,
           source_module_key, source_version, source_artifact_digest,
           reviewed_by_user_id, reviewed_at, created_by_user_id, published_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [promoted.moduleKey, promoted.version, promoted.artifactDigest, input.targetRemoteUrl,
          input.sourceModuleKey, input.sourceVersion, input.sourceArtifactDigest,
          input.reviewedByUserId, input.reviewedAt, input.authority.userId],
      );
      await this.options.queueManifestPublication?.(client, manifest);
      await this.audit.appendWithClient(client, {
        occurredAt: new Date(),
        actor: { kind: "installation_owner", userId: input.authority.userId },
        tenantId: null,
        action: "module.promoted_installation",
        subject: promoted.moduleKey,
        detail: {
          version: promoted.version,
          artifactDigest: promoted.artifactDigest,
          sourceModuleKey: input.sourceModuleKey,
          sourceVersion: input.sourceVersion,
          sourceTenantId: source.owner_tenant_id,
          reviewedByUserId: input.reviewedByUserId,
        },
      });
      return promoted;
    });
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
