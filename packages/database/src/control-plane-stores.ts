/**
 * Control-plane implementations of the identity adapter's store contracts
 * (spec 8.1). These are the only readers of the provider identifier tables
 * created in migration 0002.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AccountLinkStore,
  ExternalMembershipRef,
  IdentityProvider,
  MembershipId,
  OwnedExternalMembershipRef,
  TenantId,
  TenantOrgResolver,
  UserId,
} from "@opentenant/auth";

export class PgTenantOrgResolver implements TenantOrgResolver {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly provider: IdentityProvider,
  ) {}

  async tenantForExternalOrganization(externalOrganizationId: string): Promise<TenantId | null> {
    const { rows } = await this.pool.query<{ tenant_id: string }>(
      "select tenant_id from identity_org_mappings where provider = $1 and external_organization_id = $2",
      [this.provider, externalOrganizationId],
    );
    return (rows[0]?.tenant_id as TenantId | undefined) ?? null;
  }

  async externalOrganizationForTenant(tenantId: TenantId): Promise<string | null> {
    const { rows } = await this.pool.query<{ external_organization_id: string }>(
      "select external_organization_id from identity_org_mappings where provider = $1 and tenant_id = $2",
      [this.provider, tenantId],
    );
    return rows[0]?.external_organization_id ?? null;
  }
}

export class PgAccountLinkStore implements AccountLinkStore {
  constructor(
    private readonly pool: Pool | PoolClient,
    private readonly provider: IdentityProvider,
  ) {}

  async userIdForExternalSubject(
    externalSubject: string,
    email: string,
    displayName: string | null,
  ): Promise<UserId> {
    const existing = await this.pool.query<{ user_id: string }>(
      "select user_id from identity_account_links where provider = $1 and external_subject = $2",
      [this.provider, externalSubject],
    );
    if (existing.rows[0]) {
      // Keep the profile minimally fresh for audit display.
      await this.pool.query(
        "update platform_users set email = $2, display_name = $3, updated_at = now() where user_id = $1",
        [existing.rows[0].user_id, email, displayName],
      );
      return existing.rows[0].user_id as UserId;
    }

    const userId = `user_${randomUUID()}`;
    // A checked-out client belongs to the caller's transaction. Nested BEGIN /
    // COMMIT would release its advisory lock; a new checkout can exhaust its pool.
    const callerOwnsTransaction = "release" in this.pool;
    const client = "release" in this.pool ? this.pool : await this.pool.connect();
    try {
      if (!callerOwnsTransaction) await client.query("begin");
      await client.query(
        "insert into platform_users (user_id, email, display_name) values ($1, $2, $3)",
        [userId, email, displayName],
      );
      await client.query(
        "insert into identity_account_links (user_id, provider, external_subject) values ($1, $2, $3) on conflict (provider, external_subject) do nothing",
        [userId, this.provider, externalSubject],
      );
      // A concurrent request may have linked first; the link row wins.
      const winner = await client.query<{ user_id: string }>(
        "select user_id from identity_account_links where provider = $1 and external_subject = $2",
        [this.provider, externalSubject],
      );
      const winnerUserId = winner.rows[0]?.user_id ?? userId;
      if (winnerUserId !== userId) {
        // A concurrent request linked first: remove our now-orphaned user row.
        await client.query("delete from platform_users where user_id = $1", [userId]);
      }
      if (!callerOwnsTransaction) await client.query("commit");
      return winnerUserId as UserId;
    } catch (error) {
      if (!callerOwnsTransaction) await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      if (!callerOwnsTransaction) client.release();
    }
  }

  async externalSubjectForUserId(userId: UserId): Promise<string | null> {
    const { rows } = await this.pool.query<{ external_subject: string }>(
      "select external_subject from identity_account_links where provider = $1 and user_id = $2",
      [this.provider, userId],
    );
    return rows[0]?.external_subject ?? null;
  }

  async membershipIdForExternalRef(
    ref: ExternalMembershipRef,
    context: { tenantId: TenantId; userId: UserId | null },
  ): Promise<MembershipId> {
    if (ref.kind === "membership" && context.userId === null) {
      throw new Error("membership ownership conflict");
    }
    const membershipId = `mem_${randomUUID()}`;
    const { rows } = await this.pool.query<{
      membership_id: string;
      tenant_id: string | null;
      user_id: string | null;
    }>(
      `insert into membership_links (membership_id, provider, external_kind, external_id, tenant_id, user_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (provider, external_kind, external_id) do update
       set tenant_id = coalesce(membership_links.tenant_id, excluded.tenant_id),
           user_id = coalesce(membership_links.user_id, excluded.user_id)
       where (membership_links.tenant_id is null or membership_links.tenant_id = excluded.tenant_id)
         and (excluded.user_id is null or membership_links.user_id is null or membership_links.user_id = excluded.user_id)
       returning membership_id, tenant_id, user_id`,
      [membershipId, this.provider, ref.kind, ref.externalId, context.tenantId, context.userId],
    );
    const winner = rows[0];
    if (
      winner === undefined ||
      winner.tenant_id !== context.tenantId ||
      (context.userId !== null && winner.user_id !== context.userId)
    ) {
      throw new Error("membership ownership conflict");
    }
    return winner.membership_id as MembershipId;
  }

  async externalRefForMembershipId(membershipId: MembershipId): Promise<OwnedExternalMembershipRef | null> {
    const { rows } = await this.pool.query<{
      external_kind: "membership" | "invitation";
      external_id: string;
      tenant_id: string | null;
      user_id: string | null;
    }>(
      "select external_kind, external_id, tenant_id, user_id from membership_links where provider = $1 and membership_id = $2",
      [this.provider, membershipId],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.tenant_id === null) throw new Error("membership ownership conflict");
    if (row.external_kind === "membership") {
      if (row.user_id === null) throw new Error("membership ownership conflict");
      return {
        kind: "membership",
        externalId: row.external_id,
        tenantId: row.tenant_id as TenantId,
        userId: row.user_id as UserId,
      };
    }
    if (row.user_id !== null) throw new Error("membership ownership conflict");
    return {
      kind: "invitation",
      externalId: row.external_id,
      tenantId: row.tenant_id as TenantId,
      userId: null,
    };
  }

  async replaceExternalRefForMembershipId(
    membershipId: MembershipId,
    current: ExternalMembershipRef,
    replacement: ExternalMembershipRef,
  ): Promise<void> {
    if (current.kind !== replacement.kind) throw new Error("membership reference kind mismatch");
    const result = await this.pool.query(
      `update membership_links
          set external_id = $1
        where provider = $2 and external_kind = $3 and external_id = $4
          and membership_id = $5`,
      [replacement.externalId, this.provider, current.kind, current.externalId, membershipId],
    );
    if (result.rowCount !== 1) throw new Error("membership reference changed concurrently");
  }

  async isPlatformAdmin(userId: UserId): Promise<boolean> {
    const { rows } = await this.pool.query<{ is_platform_admin: boolean }>(
      "select is_platform_admin from platform_users where user_id = $1",
      [userId],
    );
    return rows[0]?.is_platform_admin ?? false;
  }
}
