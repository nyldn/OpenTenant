import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { InstallationAuthority, TenantId, UserId } from "@opentenant/auth";
import { PgModuleOwnershipStore } from "./module-ownership-store";
import { PgAuditStore } from "./audit-store";

const integrationUrl = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
const describeIntegration = integrationUrl ? describe : describe.skip;

describeIntegration("PgModuleOwnershipStore against PostgreSQL", () => {
  if (!integrationUrl) return;
  const parsed = new URL(integrationUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || !parsed.pathname.slice(1).startsWith("opentenant_ops04_")
  ) {
    throw new Error("module ownership store tests require an opentenant_ops04_ loopback database");
  }
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });
  const store = new PgModuleOwnershipStore(pool);
  const ownerAuthority: InstallationAuthority = {
    kind: "installation_owner",
    userId: "user_reviewer" as UserId,
    permissions: ["owner.module.publish_installation"],
    source: "legacy_platform_admin",
  };

  afterAll(async () => {
    await pool.end();
  });

  it("creates, scopes, assigns, and promotes through the public store", async () => {
    const sourceDigest = "d".repeat(64);
    const promotedDigest = "e".repeat(64);
    const source = await store.createTenantPrivate({
      moduleKey: "tenant-store-proof",
      version: "1.0.0",
      runtime: "native",
      tenantId: "ten_alpha" as TenantId,
      artifactDigest: sourceDigest,
      remoteUrl: null,
      createdByUserId: "user_reviewer",
    });
    expect(source.ownership).toMatchObject({ scope: "tenant", tenantId: "ten_alpha" });
    await expect(store.assignToTenant({
      moduleKey: source.moduleKey,
      version: source.version,
      tenantId: "ten_alpha" as TenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: "user_reviewer" },
    })).resolves.toBe(true);
    await expect(store.assignToTenant({
      moduleKey: source.moduleKey,
      version: source.version,
      tenantId: "ten_beta" as TenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: "user_reviewer" },
    })).resolves.toBe(false);

    const promoted = await store.promoteTenantModule({
      sourceModuleKey: source.moduleKey,
      sourceVersion: source.version,
      sourceArtifactDigest: sourceDigest,
      targetModuleKey: "shared-store-proof",
      targetVersion: "1.1.0",
      targetArtifactDigest: promotedDigest,
      targetRemoteUrl: null,
      reviewedByUserId: "user_reviewer",
      reviewedAt: new Date(),
      authority: ownerAuthority,
    });
    expect(promoted.ownership).toMatchObject({ scope: "installation" });
    await expect(store.assignToTenant({
      moduleKey: promoted.moduleKey,
      version: promoted.version,
      tenantId: "ten_beta" as TenantId,
      enabled: true,
      settings: {},
      actor: { kind: "installation_owner", userId: "user_reviewer" },
    })).resolves.toBe(true);

    const { rows } = await pool.query(
      `select catalog.module_key, catalog.ownership_scope, catalog.owner_tenant_id,
              version.artifact_digest, version.digest_kind, version.source_artifact_digest
         from module_catalog catalog
         join module_versions version on version.module_key = catalog.module_key
        where catalog.module_key in ('tenant-store-proof', 'shared-store-proof')
        order by catalog.module_key`,
    );
    expect(rows).toEqual([
      {
        module_key: "shared-store-proof",
        ownership_scope: "installation",
        owner_tenant_id: null,
        artifact_digest: promotedDigest,
        digest_kind: "sha256_artifact",
        source_artifact_digest: sourceDigest,
      },
      {
        module_key: "tenant-store-proof",
        ownership_scope: "tenant",
        owner_tenant_id: "ten_alpha",
        artifact_digest: sourceDigest,
        digest_kind: "sha256_artifact",
        source_artifact_digest: null,
      },
    ]);

    const audit = new PgAuditStore(pool);
    await expect(audit.verifyChain("ten_alpha")).resolves.toMatchObject({
      intact: true,
      assurance: "canonical",
    });
    await expect(audit.verifyChain("ten_beta")).resolves.toMatchObject({
      intact: true,
      assurance: "canonical",
    });
    await expect(audit.verifyChain(null)).resolves.toMatchObject({
      intact: true,
      assurance: "canonical",
    });
    const events = await pool.query<{ tenant_id: string | null; action: string }>(
      `select tenant_id, action from audit_events
        where action like 'module.%'
        order by tenant_id nulls first, sequence`,
    );
    expect(events.rows).toEqual([
      { tenant_id: null, action: "module.promoted_installation" },
      { tenant_id: "ten_alpha", action: "module.created_private" },
      { tenant_id: "ten_alpha", action: "module.assigned" },
      { tenant_id: "ten_beta", action: "module.assigned" },
    ]);
  });
});
