import { createHash } from "node:crypto";
import type { TenantId } from "@opentenant/auth";
import {
  validateVoiceProfile,
  type TenantVoiceProfileInput,
} from "@opentenant/platform-core";
import { canonicalJsonStringify } from "@opentenant/security";
import type { Pool, PoolClient } from "pg";
import { PgAuditStore } from "./audit-store";

export interface VoiceProfileUserActor {
  readonly kind: "user";
  readonly userId: string;
}

export interface PublishTenantVoiceProfileInput {
  readonly tenantId: TenantId;
  readonly profile: TenantVoiceProfileInput;
  readonly expectedRevision: number;
  readonly actor: VoiceProfileUserActor;
  readonly reason: string;
}

export interface RevokeTenantVoiceProfileInput {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly expectedRevision: number;
  readonly actor: VoiceProfileUserActor;
  readonly reason: string;
}

export interface TenantVoiceProfileHistoryEntry {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly profile: TenantVoiceProfileInput;
  readonly digest: string;
  readonly publishedByUserId: string;
  readonly publishedAt: Date;
  readonly publishReason: string;
  readonly revocation: null | {
    readonly revokedByUserId: string;
    readonly revokedAt: Date;
    readonly reason: string;
  };
}

export interface TenantVoiceProfileSnapshot {
  readonly tenantId: TenantId;
  readonly revision: number;
  readonly currentVersion: number | null;
  readonly nextVersion: number;
  readonly current: TenantVoiceProfileHistoryEntry | null;
}

export class TenantVoiceProfileConflictError extends Error {}
export class TenantVoiceProfileValidationError extends Error {}
export class TenantVoiceProfileIntegrityError extends Error {}

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function boundedReason(reason: string): string {
  if (
    typeof reason !== "string"
    || reason !== reason.trim()
    || [...reason].length < 1
    || [...reason].length > 1_000
    || CONTROL_OR_FORMAT.test(reason)
  ) {
    throw new TenantVoiceProfileValidationError("reason must be trimmed text between 1 and 1000 characters");
  }
  return reason;
}

function validatedActor(actor: VoiceProfileUserActor): VoiceProfileUserActor {
  if (
    !actor
    || actor.kind !== "user"
    || typeof actor.userId !== "string"
    || actor.userId !== actor.userId.trim()
    || [...actor.userId].length < 1
    || [...actor.userId].length > 200
    || CONTROL_OR_FORMAT.test(actor.userId)
  ) {
    throw new TenantVoiceProfileValidationError("actor must be a user with a bounded, trimmed userId");
  }
  return actor;
}

function expectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > POSTGRES_INTEGER_MAX) {
    throw new TenantVoiceProfileValidationError("expectedRevision must be a PostgreSQL non-negative integer");
  }
  return value;
}

function digestProfile(profile: TenantVoiceProfileInput): string {
  const canonical = canonicalJsonStringify(profile);
  if (canonical === undefined) {
    throw new TenantVoiceProfileValidationError("voice profile could not be canonicalized");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

function verifiedStoredProfile(profile: unknown, digest: string): TenantVoiceProfileInput {
  try {
    const normalized = validateVoiceProfile(profile as TenantVoiceProfileInput);
    if (digestProfile(normalized) !== digest) {
      throw new TenantVoiceProfileIntegrityError("stored voice profile digest does not match its content");
    }
    return normalized;
  } catch (error) {
    if (error instanceof TenantVoiceProfileIntegrityError) throw error;
    throw new TenantVoiceProfileIntegrityError(
      error instanceof Error ? `stored voice profile is invalid: ${error.message}` : "stored voice profile is invalid",
    );
  }
}

function mapVoiceProfileDatabaseError(error: unknown): never {
  if (
    error instanceof TenantVoiceProfileConflictError
    || error instanceof TenantVoiceProfileValidationError
    || error instanceof TenantVoiceProfileIntegrityError
  ) {
    throw error;
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "23514" || code === "22021" || code === "23502") {
    throw new TenantVoiceProfileValidationError("tenant voice profile evidence failed database validation", {
      cause: error,
    });
  }
  if (code === "P0001" || code === "23503" || code === "23505") {
    throw new TenantVoiceProfileConflictError("tenant voice profile evidence conflicted with current state", {
      cause: error,
    });
  }
  throw error;
}

export class PgTenantVoiceProfileStore {
  private readonly audit: PgAuditStore;

  constructor(private readonly pool: Pool) {
    this.audit = new PgAuditStore(pool);
  }

  async publish(input: PublishTenantVoiceProfileInput): Promise<TenantVoiceProfileHistoryEntry> {
    const reason = boundedReason(input.reason);
    const actor = validatedActor(input.actor);
    const revision = expectedRevision(input.expectedRevision);
    let profile: TenantVoiceProfileInput;
    try {
      profile = validateVoiceProfile(input.profile);
    } catch (error) {
      throw new TenantVoiceProfileValidationError(
        error instanceof Error ? error.message : "voice profile is invalid",
      );
    }
    const digest = digestProfile(profile);

    try {
      return await this.transaction(async (client) => {
        await client.query(
          `insert into tenant_voice_profiles (tenant_id)
           select tenant_id from tenants where tenant_id = $1
           on conflict (tenant_id) do nothing`,
          [input.tenantId],
        );
        const head = await client.query<{
          current_version: number | null; next_version: number; revision: number; current_digest: string | null;
        }>(
          `select h.current_version, h.next_version, h.revision, v.digest as current_digest
             from tenant_voice_profiles h
             left join tenant_voice_profile_versions v
               on v.tenant_id = h.tenant_id and v.version = h.current_version
            where h.tenant_id = $1 for update of h`,
          [input.tenantId],
        );
        const current = head.rows[0];
        if (!current) throw new TenantVoiceProfileConflictError("tenant voice profile scope does not exist");
        if (current.revision !== revision) {
          throw new TenantVoiceProfileConflictError("tenant voice profile revision changed");
        }
        if (current.current_digest === digest) {
          throw new TenantVoiceProfileConflictError("tenant voice profile is unchanged");
        }
        const inserted = await client.query<TenantVoiceProfileHistoryEntry & {
          published_by_user_id: string; published_at: Date; publish_reason: string;
        }>(
          `insert into tenant_voice_profile_versions
            (tenant_id, version, profile, digest, published_by_user_id, reason)
           values ($1, $2, $3::jsonb, $4, $5, $6)
           returning tenant_id as "tenantId", version, profile, digest,
                     published_by_user_id, published_at, reason as publish_reason`,
          [input.tenantId, current.next_version, JSON.stringify(profile), digest, actor.userId, reason],
        );
        const row = inserted.rows[0]!;
        await client.query(
          `update tenant_voice_profiles
              set current_version = $2, next_version = $2 + 1, revision = revision + 1
            where tenant_id = $1`,
          [input.tenantId, current.next_version],
        );
        await this.audit.appendWithClient(client, {
          tenantId: input.tenantId,
          occurredAt: new Date(row.published_at),
          actor,
          action: "brand.voice_profile.published",
          subject: `${input.tenantId}:${current.next_version}`,
          detail: { version: current.next_version, digest, reason },
        });
        return {
          tenantId: input.tenantId,
          version: row.version,
          profile: row.profile,
          digest: row.digest,
          publishedByUserId: row.published_by_user_id,
          publishedAt: new Date(row.published_at),
          publishReason: row.publish_reason,
          revocation: null,
        };
      });
    } catch (error) {
      mapVoiceProfileDatabaseError(error);
    }
  }

  async revoke(input: RevokeTenantVoiceProfileInput): Promise<void> {
    const reason = boundedReason(input.reason);
    const actor = validatedActor(input.actor);
    const revision = expectedRevision(input.expectedRevision);
    if (
      !Number.isSafeInteger(input.version)
      || input.version < 1
      || input.version > POSTGRES_INTEGER_MAX
    ) {
      throw new TenantVoiceProfileValidationError("version must be a positive PostgreSQL integer");
    }
    try {
      await this.transaction(async (client) => {
        const head = await client.query<{ current_version: number | null; revision: number }>(
          `select current_version, revision from tenant_voice_profiles
            where tenant_id = $1 for update`,
          [input.tenantId],
        );
        const current = head.rows[0];
        if (!current || current.revision !== revision || current.current_version !== input.version) {
          throw new TenantVoiceProfileConflictError("current tenant voice profile or revision changed");
        }
        const revoked = await client.query<{ revoked_at: Date }>(
          `insert into tenant_voice_profile_revocations
            (tenant_id, version, revoked_by_user_id, reason)
           values ($1, $2, $3, $4)
           returning revoked_at`,
          [input.tenantId, input.version, actor.userId, reason],
        );
        await client.query(
          `update tenant_voice_profiles set current_version = null, revision = revision + 1
            where tenant_id = $1`,
          [input.tenantId],
        );
        await this.audit.appendWithClient(client, {
          tenantId: input.tenantId,
          occurredAt: new Date(revoked.rows[0]!.revoked_at),
          actor,
          action: "brand.voice_profile.revoked",
          subject: `${input.tenantId}:${input.version}`,
          detail: { version: input.version, reason },
        });
      });
    } catch (error) {
      mapVoiceProfileDatabaseError(error);
    }
  }

  async getCurrent(tenantId: TenantId): Promise<TenantVoiceProfileSnapshot | null> {
    const result = await this.pool.query(
      `select h.tenant_id, h.revision, h.current_version, h.next_version,
              v.profile, v.digest, v.published_by_user_id, v.published_at, v.reason
         from tenant_voice_profiles h
         left join tenant_voice_profile_versions v
           on v.tenant_id = h.tenant_id and v.version = h.current_version
        where h.tenant_id = $1`,
      [tenantId],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const currentProfile = row.current_version === null
      ? null
      : verifiedStoredProfile(row.profile, row.digest);
    return {
      tenantId,
      revision: row.revision,
      currentVersion: row.current_version,
      nextVersion: row.next_version,
      current: row.current_version === null ? null : {
        tenantId,
        version: row.current_version,
        profile: currentProfile!,
        digest: row.digest,
        publishedByUserId: row.published_by_user_id,
        publishedAt: new Date(row.published_at),
        publishReason: row.reason,
        revocation: null,
      },
    };
  }

  async listHistory(tenantId: TenantId): Promise<TenantVoiceProfileHistoryEntry[]> {
    const result = await this.pool.query(
      `select v.*, r.revoked_by_user_id, r.revoked_at, r.reason as revoke_reason
         from tenant_voice_profile_versions v
         left join tenant_voice_profile_revocations r
           on r.tenant_id = v.tenant_id and r.version = v.version
        where v.tenant_id = $1 order by v.version desc`,
      [tenantId],
    );
    return result.rows.map((row) => {
      const profile = verifiedStoredProfile(row.profile, row.digest);
      return {
        tenantId,
        version: row.version,
        profile,
        digest: row.digest,
        publishedByUserId: row.published_by_user_id,
        publishedAt: new Date(row.published_at),
        publishReason: row.reason,
        revocation: row.revoked_at === null ? null : {
          revokedByUserId: row.revoked_by_user_id,
          revokedAt: new Date(row.revoked_at),
          reason: row.revoke_reason,
        },
      };
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
