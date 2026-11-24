import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  PgTenantVoiceProfileStore,
  TenantVoiceProfileConflictError,
  TenantVoiceProfileIntegrityError,
  TenantVoiceProfileValidationError,
} from "../../../packages/database/src/tenant-voice-profile-store";
import type { TenantVoiceProfileInput } from "../../../packages/platform-core/src/voice-profile";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;
type TenantId = Parameters<PgTenantVoiceProfileStore["getCurrent"]>[0];
const TENANT_A = "ten_voice_a" as TenantId;
const TENANT_B = "ten_voice_b" as TenantId;

async function migrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()
    .map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(join(directory, name), "utf8") })));
}

const profile = (preferredWords = ["clear"]): TenantVoiceProfileInput => ({
  readingLevel: "professional",
  formality: "neutral",
  person: "second",
  tense: "present",
  sentenceLength: "medium",
  bannedWords: ["utilise"],
  preferredWords,
  exampleRewrites: [{ before: "We utilise clear words.", after: "We use clear words." }],
});

describeIntegration("tenant voice-profile storage against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 6 });
  const store = new PgTenantVoiceProfileStore(pool);

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await migrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_voice_a', 'voice-a', 'Voice A', 'active', 'eu'),
              ('ten_voice_b', 'voice-b', 'Voice B', 'active', 'eu')`,
    );
  });

  afterAll(async () => pool.end());

  const actor = { kind: "user" as const, userId: "usr_voice_admin" };

  it("publishes tenant-scoped versions optimistically and retains revocation evidence", async () => {
    const first = await store.publish({
      tenantId: TENANT_A,
      profile: profile(["हिन्दी", "\u{13441}", "token-übernahme"]),
      expectedRevision: 0,
      actor,
      reason: "Initial profile",
    });
    expect(first.version).toBe(1);
    expect(await store.getCurrent(TENANT_B)).toBeNull();
    expect(await store.listHistory(TENANT_B)).toEqual([]);
    await expect(store.revoke({
      tenantId: TENANT_B, version: 1, expectedRevision: 1, actor, reason: "Wrong tenant",
    })).rejects.toBeInstanceOf(TenantVoiceProfileConflictError);

    await store.revoke({
      tenantId: TENANT_A, version: 1, expectedRevision: 1, actor, reason: "Retire v1",
    });
    expect((await store.getCurrent(TENANT_A))).toMatchObject({
      revision: 2, currentVersion: null, nextVersion: 2,
    });
    expect((await store.listHistory(TENANT_A))[0]).toMatchObject({
      version: 1, revocation: { revokedByUserId: actor.userId, reason: "Retire v1" },
    });
    const second = await store.publish({
      tenantId: TENANT_A, profile: profile(["plain"]), expectedRevision: 2, actor, reason: "Replacement",
    });
    expect(second.version).toBe(2);
  });

  it("serializes two real concurrent publishers with one version and one audit event", async () => {
    const onePool = new Pool({ connectionString: integrationUrl, max: 1 });
    const twoPool = new Pool({ connectionString: integrationUrl, max: 1 });
    const one = new PgTenantVoiceProfileStore(onePool);
    const two = new PgTenantVoiceProfileStore(twoPool);
    try {
      const outcomes = await Promise.allSettled([
        one.publish({ tenantId: TENANT_A, profile: profile(["plain"]), expectedRevision: 0, actor, reason: "A" }),
        two.publish({ tenantId: TENANT_A, profile: profile(["direct"]), expectedRevision: 0, actor, reason: "B" }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
        reason: expect.any(TenantVoiceProfileConflictError),
      });
      expect(await pool.query("select 1 from tenant_voice_profile_versions where tenant_id = 'ten_voice_a'"))
        .toMatchObject({ rowCount: 1 });
      expect(await pool.query(
        "select 1 from audit_events where tenant_id = 'ten_voice_a' and action = 'brand.voice_profile.published'",
      )).toMatchObject({ rowCount: 1 });
    } finally {
      await onePool.end();
      await twoPool.end();
    }
  });

  it("rejects stale revisions, out-of-range inputs, and illegal head transitions", async () => {
    await store.publish({
      tenantId: TENANT_A, profile: profile(), expectedRevision: 0, actor, reason: "Initial",
    });
    await expect(store.publish({
      tenantId: TENANT_A,
      profile: profile(["plain"]),
      expectedRevision: 0,
      actor,
      reason: "Stale",
    })).rejects.toBeInstanceOf(TenantVoiceProfileConflictError);
    await expect(store.revoke({
      tenantId: TENANT_A,
      version: 1,
      expectedRevision: 0,
      actor,
      reason: "Stale",
    })).rejects.toBeInstanceOf(TenantVoiceProfileConflictError);
    await expect(store.revoke({
      tenantId: TENANT_A,
      version: 2_147_483_648,
      expectedRevision: 1,
      actor,
      reason: "Out of range",
    })).rejects.toBeInstanceOf(TenantVoiceProfileValidationError);
    await expect(store.publish({
      tenantId: TENANT_A,
      profile: profile(["plain"]),
      expectedRevision: 1,
      actor,
      reason: "Invalid\uD800reason",
    })).rejects.toBeInstanceOf(TenantVoiceProfileValidationError);
    await expect(store.publish({
      tenantId: TENANT_A,
      profile: profile(["plain"]),
      expectedRevision: 1,
      actor,
      reason: "Retire\u202Ev1",
    })).rejects.toBeInstanceOf(TenantVoiceProfileValidationError);
    await expect(store.publish({
      tenantId: TENANT_A,
      profile: profile(["plain"]),
      expectedRevision: 1,
      actor: { kind: "user", userId: "usr\u2028admin" },
      reason: "Invalid actor",
    })).rejects.toBeInstanceOf(TenantVoiceProfileValidationError);
    await expect(pool.query(
      `insert into tenant_voice_profiles
        (tenant_id, current_version, next_version, revision)
       values ('ten_voice_b', null, 2, 0)`,
    )).rejects.toMatchObject({ code: "P0001" });
    for (const sql of [
      `update tenant_voice_profiles
          set revision = revision + 2
        where tenant_id = 'ten_voice_a'`,
      `update tenant_voice_profiles
          set revision = revision + 1
        where tenant_id = 'ten_voice_a'`,
    ]) await expect(pool.query(sql)).rejects.toMatchObject({ code: "P0001" });
  });

  it("canonicalizes rewrites before unchanged-profile comparison", async () => {
    const decomposed = {
      ...profile(),
      exampleRewrites: [{ before: "Cafe\u0301", after: "Café." }],
    };
    const composed = {
      ...profile(),
      exampleRewrites: [{ before: "Café", after: "Café." }],
    };
    await store.publish({
      tenantId: TENANT_A, profile: decomposed, expectedRevision: 0, actor, reason: "Canonical identity",
    });
    await expect(store.publish({
      tenantId: TENANT_A, profile: composed, expectedRevision: 1, actor, reason: "Same identity",
    })).rejects.toBeInstanceOf(TenantVoiceProfileConflictError);
  });

  it("rejects revocation evidence for a non-current historical version", async () => {
    await store.publish({
      tenantId: TENANT_A, profile: profile(), expectedRevision: 0, actor, reason: "Version one",
    });
    await store.publish({
      tenantId: TENANT_A, profile: profile(["plain"]), expectedRevision: 1, actor, reason: "Version two",
    });
    await expect(pool.query(
      `insert into tenant_voice_profile_revocations
       (tenant_id, version, revoked_by_user_id, reason)
       values ('ten_voice_a', 1, 'usr', 'not current')`,
    )).rejects.toMatchObject({ code: "P0001" });
  });

  it("uses server evidence timestamps and binds matching audit times", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const head = await client.query<{ updated_at: Date }>(
        `insert into tenant_voice_profiles (tenant_id, updated_at)
         values ('ten_voice_b', '2000-01-01')
         returning updated_at`,
      );
      const inserted = await client.query<{ published_at: Date }>(
        `insert into tenant_voice_profile_versions
          (tenant_id, version, profile, digest, published_by_user_id, reason, published_at)
         values ('ten_voice_b', 1, $1::jsonb, $2, 'usr', 'direct transaction', '2000-01-01')
         returning published_at`,
        [JSON.stringify(profile()), "a".repeat(64)],
      );
      await client.query(
        `update tenant_voice_profiles
            set current_version = 1, next_version = 2, revision = 1
          where tenant_id = 'ten_voice_b'`,
      );
      await client.query("commit");
      expect(head.rows[0]!.updated_at.getUTCFullYear()).toBeGreaterThan(2025);
      expect(inserted.rows[0]!.published_at.getUTCFullYear()).toBeGreaterThan(2025);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await expect(store.getCurrent(TENANT_B)).rejects.toBeInstanceOf(TenantVoiceProfileIntegrityError);

    const published = await store.publish({
      tenantId: TENANT_A, profile: profile(), expectedRevision: 0, actor, reason: "Timestamp proof",
    });
    const publishAudit = await pool.query<{ occurred_at: Date }>(
      `select occurred_at from audit_events
        where tenant_id = 'ten_voice_a' and action = 'brand.voice_profile.published'`,
    );
    expect(publishAudit.rows[0]!.occurred_at.getTime()).toBe(published.publishedAt.getTime());

    await store.revoke({
      tenantId: TENANT_A, version: 1, expectedRevision: 1, actor, reason: "Timestamp proof",
    });
    const revoked = await pool.query<{ revoked_at: Date; occurred_at: Date }>(
      `select r.revoked_at, a.occurred_at
         from tenant_voice_profile_revocations r
         join audit_events a
           on a.tenant_id = r.tenant_id and a.action = 'brand.voice_profile.revoked'
        where r.tenant_id = 'ten_voice_a' and r.version = 1`,
    );
    expect(revoked.rows[0]!.occurred_at.getTime()).toBe(revoked.rows[0]!.revoked_at.getTime());
  });

  it("rejects invalid direct writes, cross-tenant references, and evidence mutation", async () => {
    await store.publish({
      tenantId: TENANT_A, profile: profile(), expectedRevision: 0, actor, reason: "Initial",
    });
    const invalid = { ...profile(), bannedWords: ["Clear"], preferredWords: ["clear"] };
    await expect(pool.query(
      `insert into tenant_voice_profile_versions
       (tenant_id, version, profile, digest, published_by_user_id, reason)
       values ('ten_voice_b', 1, $1::jsonb, $2, 'usr', 'bad')`,
      [JSON.stringify(invalid), "a".repeat(64)],
    )).rejects.toMatchObject({ code: "23514" });
    for (const after of ["Hidden\u202edirection", "Line\u2028separator", "Paragraph\u2029separator"]) {
      const controlCharacterProfile = {
        ...profile(),
        exampleRewrites: [{ before: "Visible", after }],
      };
      await expect(pool.query(
        `insert into tenant_voice_profile_versions
         (tenant_id, version, profile, digest, published_by_user_id, reason)
         values ('ten_voice_b', 1, $1::jsonb, $2, 'usr', 'bad')`,
        [JSON.stringify(controlCharacterProfile), "a".repeat(64)],
      )).rejects.toMatchObject({ code: "23514" });
    }
    const nonCanonicalRewriteProfile = {
      ...profile(),
      exampleRewrites: [{ before: "Cafe\u0301", after: "Café." }],
    };
    await expect(pool.query(
      `insert into tenant_voice_profile_versions
       (tenant_id, version, profile, digest, published_by_user_id, reason)
       values ('ten_voice_b', 1, $1::jsonb, $2, 'usr', 'bad')`,
      [JSON.stringify(nonCanonicalRewriteProfile), "a".repeat(64)],
    )).rejects.toMatchObject({ code: "23514" });
    const paddedRewriteProfile = {
      ...profile(),
      exampleRewrites: [{ before: "\u00A0Visible", after: "Clear." }],
    };
    await expect(pool.query(
      `insert into tenant_voice_profile_versions
       (tenant_id, version, profile, digest, published_by_user_id, reason)
       values ('ten_voice_b', 1, $1::jsonb, $2, 'usr', 'bad')`,
      [JSON.stringify(paddedRewriteProfile), "a".repeat(64)],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `insert into tenant_voice_profile_versions
       (tenant_id, version, profile, digest, published_by_user_id, reason)
       values ('ten_voice_b', 1, '{}'::jsonb, $1, 'usr', 'bad')`,
      ["a".repeat(64)],
    )).rejects.toMatchObject({ code: "23514" });
    for (const [userId, reason] of [
      ["usr\u202Eadmin", "bad"],
      ["usr", "Retire\u202Ev1"],
      ["\u00A0usr", "bad"],
      ["usr", "Retire\u00A0"],
    ]) {
      await expect(pool.query(
        `insert into tenant_voice_profile_versions
         (tenant_id, version, profile, digest, published_by_user_id, reason)
         values ('ten_voice_b', 1, $1::jsonb, $2, $3, $4)`,
        [JSON.stringify(profile()), "a".repeat(64), userId, reason],
      )).rejects.toMatchObject({ code: "23514" });
    }
    await pool.query("insert into tenant_voice_profiles (tenant_id) values ('ten_voice_b')");
    await expect(pool.query(
      "update tenant_voice_profiles set current_version = 1, revision = 1, next_version = 2 where tenant_id = 'ten_voice_b'",
    )).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(
      "update tenant_voice_profiles set current_version = null, revision = 2 where tenant_id = 'ten_voice_a'",
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      `insert into tenant_voice_profile_revocations
       (tenant_id, version, revoked_by_user_id, reason)
       values ('ten_voice_a', 1, 'usr', 'evidence without transition')`,
    )).rejects.toMatchObject({ code: "P0001" });
    for (const [userId, reason] of [
      ["usr\u202Eadmin", "bad"],
      ["usr", "Retire\u202Ev1"],
      ["\u00A0usr", "bad"],
      ["usr", "Retire\u00A0"],
    ]) {
      await expect(pool.query(
        `insert into tenant_voice_profile_revocations
         (tenant_id, version, revoked_by_user_id, reason)
         values ('ten_voice_a', 1, $1, $2)`,
        [userId, reason],
      )).rejects.toMatchObject({ code: "23514" });
    }
    await store.revoke({
      tenantId: TENANT_A, version: 1, expectedRevision: 1, actor, reason: "Retire immutable evidence",
    });
    for (const sql of [
      "update tenant_voice_profile_versions set reason = 'changed' where tenant_id = 'ten_voice_a'",
      "delete from tenant_voice_profile_versions where tenant_id = 'ten_voice_a'",
      "truncate tenant_voice_profile_versions cascade",
      "update tenant_voice_profile_revocations set reason = 'changed' where tenant_id = 'ten_voice_a'",
      "delete from tenant_voice_profile_revocations where tenant_id = 'ten_voice_a'",
      "truncate tenant_voice_profile_revocations",
      "delete from tenant_voice_profiles where tenant_id = 'ten_voice_a'",
      "truncate tenant_voice_profiles",
    ]) await expect(pool.query(sql)).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query(
      `insert into tenant_voice_profile_revocations
       (tenant_id, version, revoked_by_user_id, reason)
       values ('ten_voice_b', 1, 'usr', 'wrong tenant')`,
    )).rejects.toMatchObject({ code: "P0001" });
  });
});
