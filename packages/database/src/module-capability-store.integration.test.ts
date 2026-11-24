import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { InstallationAuthority, TenantId, UserId } from "@opentenant/auth";
import { PgAuditStore } from "./audit-store";
import { PgModuleCapabilityStore } from "./module-capability-store";
import { PgModuleOwnershipStore } from "./module-ownership-store";

const integrationUrl = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
const describeIntegration = integrationUrl ? describe : describe.skip;

describeIntegration("PgModuleCapabilityStore against PostgreSQL", () => {
  if (!integrationUrl) return;
  const parsed = new URL(integrationUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || !parsed.pathname.slice(1).startsWith("opentenant_ops05_")
  ) {
    throw new Error("module capability store tests require an opentenant_ops05_ loopback database");
  }
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });
  const tenantId = "ten_alpha" as TenantId;
  const moduleKey = `ops05-store-${process.pid}`;
  const creatorUserId = `user_store_${process.pid}`;
  const ownerAuthority: InstallationAuthority = {
    kind: "installation_owner",
    userId: "user_owner" as UserId,
    permissions: ["owner.support.module_grant.manage"],
    source: "legacy_platform_admin",
  };

  afterAll(async () => {
    await pool.end();
  });

  it("publishes, grants, authorizes, audits, and revokes through public stores", async () => {
    const ownership = new PgModuleOwnershipStore(pool);
    const capabilities = new PgModuleCapabilityStore(pool);
    await expect(capabilities.grantModuleCreatorCapability({
      tenantId: "ten_missing" as TenantId,
      creatorUserId: "user_missing",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: false, reason: "creator_authority_denied" });
    await pool.query(
      `insert into platform_users (user_id, email, display_name)
       values ($1, $2, 'Store Creator')`,
      [creatorUserId, `${creatorUserId}@example.test`],
    );
    await expect(capabilities.grantModuleCreatorCapability({
      tenantId,
      creatorUserId,
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    await ownership.createTenantPrivate({
      moduleKey,
      version: "1.0.0",
      runtime: "native",
      tenantId,
      artifactDigest: "f".repeat(64),
      remoteUrl: null,
      createdByUserId: creatorUserId,
      capabilityRequests: [{
        capability: "support.ticket.read",
        runtimePermission: `${moduleKey}.support-ticket-read`,
      }],
    });
    await expect(ownership.assignToTenant({
      moduleKey,
      version: "1.0.0",
      tenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: creatorUserId },
    })).resolves.toBe(true);
    await expect(capabilities.grantTenantCapability({
      tenantId,
      moduleKey,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });

    const operation = vi.fn(async () => ({
      value: [{
        ticketNumber: "SUP-000001",
        category: "technical",
        status: "open",
        priority: "medium",
        updatedAt: "2026-07-22T00:00:00.000Z",
      }],
      resultCount: 1,
      resultSize: "small" as const,
    }));
    await expect(capabilities.withAuthorizedCapability({
      tenantId,
      moduleKey,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: [`${moduleKey}.support-ticket-read`],
      identityBacked: true,
      actor: { kind: "user", userId: creatorUserId },
      correlationId: "00000000-0000-4000-8000-000000000011",
    }, operation)).resolves.toMatchObject({ allowed: true });
    expect(operation).toHaveBeenCalledOnce();

    const wrongVersionOperation = vi.fn();
    await expect(capabilities.withAuthorizedCapability({
      tenantId,
      moduleKey,
      moduleVersion: "2.0.0",
      capability: "support.ticket.read",
      runtimePermissions: [`${moduleKey}.support-ticket-read`],
      identityBacked: true,
      actor: { kind: "user", userId: creatorUserId },
      correlationId: "00000000-0000-4000-8000-000000000012",
    }, wrongVersionOperation)).resolves.toMatchObject({ allowed: false });
    expect(wrongVersionOperation).not.toHaveBeenCalled();

    await expect(capabilities.revokeTenantCapability({
      tenantId,
      moduleKey,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    const revokedOperation = vi.fn();
    await expect(capabilities.withAuthorizedCapability({
      tenantId,
      moduleKey,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: [`${moduleKey}.support-ticket-read`],
      identityBacked: true,
      actor: { kind: "user", userId: creatorUserId },
      correlationId: "00000000-0000-4000-8000-000000000013",
    }, revokedOperation)).resolves.toEqual({ allowed: false, reason: "grant_inactive" });
    expect(revokedOperation).not.toHaveBeenCalled();

    await expect(capabilities.revokeModuleCreatorCapability({
      tenantId,
      creatorUserId,
      capability: "support.ticket.read",
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    const creatorRevokedOperation = vi.fn();
    await expect(capabilities.withAuthorizedCapability({
      tenantId,
      moduleKey,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      runtimePermissions: [`${moduleKey}.support-ticket-read`],
      identityBacked: true,
      actor: { kind: "user", userId: creatorUserId },
      correlationId: "00000000-0000-4000-8000-000000000014",
    }, creatorRevokedOperation)).resolves.toEqual({
      allowed: false,
      reason: "creator_authority_denied",
    });
    expect(creatorRevokedOperation).not.toHaveBeenCalled();

    const audit = new PgAuditStore(pool);
    await expect(audit.verifyChain(tenantId)).resolves.toMatchObject({
      intact: true,
      assurance: "canonical",
    });
    const { rows } = await pool.query<{ action: string; detail: Record<string, unknown> }>(
      `select action, detail from audit_events
        where tenant_id = $1 and subject = $2
        order by sequence`,
      [tenantId, `${moduleKey}@1.0.0`],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "module.capability.granted",
      "module.capability.used",
      "module.capability.revoked",
      "module.capability.denied",
      "module.capability.denied",
    ]);
    expect(JSON.stringify(rows)).not.toContain("SUP-000001");
    await expect(audit.verifyChain(null)).resolves.toMatchObject({
      intact: true,
      assurance: "canonical",
    });
  });

  it("appends replacements after expired creator and tenant grants", async () => {
    const ownership = new PgModuleOwnershipStore(pool);
    const capabilities = new PgModuleCapabilityStore(pool);
    const expiringCreator = `user_expiring_${process.pid}`;
    const creatorModule = `${moduleKey}-creator-expiry`;
    await pool.query(
      `insert into platform_users (user_id, email, display_name)
       values ($1, $2, 'Expiring Creator')`,
      [expiringCreator, `${expiringCreator}@example.test`],
    );
    await expect(capabilities.grantModuleCreatorCapability({
      tenantId,
      creatorUserId: expiringCreator,
      capability: "support.ticket.read",
      expiresAt: new Date(Date.now() + 500),
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    await pool.query("select pg_sleep(0.6)");
    await expect(capabilities.grantModuleCreatorCapability({
      tenantId,
      creatorUserId: expiringCreator,
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    await expect(ownership.createTenantPrivate({
      moduleKey: creatorModule,
      version: "1.0.0",
      runtime: "native",
      tenantId,
      artifactDigest: "e".repeat(64),
      remoteUrl: null,
      createdByUserId: expiringCreator,
      capabilityRequests: [{
        capability: "support.ticket.read",
        runtimePermission: `${creatorModule}.support-ticket-read`,
      }],
    })).resolves.toMatchObject({ moduleKey: creatorModule, version: "1.0.0" });

    const tenantCreator = `user_tenant_expiry_${process.pid}`;
    const tenantModule = `${moduleKey}-tenant-expiry`;
    await pool.query(
      `insert into platform_users (user_id, email, display_name)
       values ($1, $2, 'Tenant Grant Creator')`,
      [tenantCreator, `${tenantCreator}@example.test`],
    );
    await expect(capabilities.grantModuleCreatorCapability({
      tenantId,
      creatorUserId: tenantCreator,
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    await ownership.createTenantPrivate({
      moduleKey: tenantModule,
      version: "1.0.0",
      runtime: "native",
      tenantId,
      artifactDigest: "d".repeat(64),
      remoteUrl: null,
      createdByUserId: tenantCreator,
      capabilityRequests: [{
        capability: "support.ticket.read",
        runtimePermission: `${tenantModule}.support-ticket-read`,
      }],
    });
    await ownership.assignToTenant({
      moduleKey: tenantModule,
      version: "1.0.0",
      tenantId,
      enabled: true,
      settings: {},
      actor: { kind: "user", userId: tenantCreator },
    });
    await expect(capabilities.grantTenantCapability({
      tenantId,
      moduleKey: tenantModule,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      expiresAt: new Date(Date.now() + 500),
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });
    await pool.query("select pg_sleep(0.6)");
    await expect(capabilities.grantTenantCapability({
      tenantId,
      moduleKey: tenantModule,
      moduleVersion: "1.0.0",
      capability: "support.ticket.read",
      expiresAt: null,
      authority: ownerAuthority,
    })).resolves.toEqual({ allowed: true });

    const { rows } = await pool.query<{ active: string; total: string }>(
      `select count(*) filter (where revoked_at is null)::text as active,
              count(*)::text as total
         from tenant_module_capability_grants
        where tenant_id = $1 and module_key = $2 and module_version = '1.0.0'
          and capability = 'support.ticket.read'`,
      [tenantId, tenantModule],
    );
    expect(rows[0]).toEqual({ active: "1", total: "2" });
  });
});
