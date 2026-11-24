import type { TenantId } from "@opentenant/auth";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  PgTenantVoiceProfileStore,
  TenantVoiceProfileConflictError,
  TenantVoiceProfileValidationError,
} from "./tenant-voice-profile-store";

const profile = {
  readingLevel: "professional" as const,
  formality: "neutral" as const,
  person: "second" as const,
  tense: "present" as const,
  sentenceLength: "medium" as const,
  bannedWords: ["utilise"],
  preferredWords: ["clear"],
  exampleRewrites: [{ before: "We utilise clear words.", after: "We use clear words." }],
};

function failingPool(code: string): { pool: Pool; failure: Error } {
  const failure = Object.assign(new Error(`database failure ${code}`), { code });
  const client = {
    query: async (sql: string) => {
      if (sql === "begin" || sql === "rollback") return { rows: [] };
      if (sql.startsWith("insert into tenant_voice_profiles")) return { rows: [] };
      if (sql.startsWith("select h.current_version")) {
        return {
          rows: [{ current_version: null, next_version: 1, revision: 0, current_digest: null }],
        };
      }
      if (sql.startsWith("insert into tenant_voice_profile_versions")) throw failure;
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return {
    pool: { connect: async () => client } as unknown as Pool,
    failure,
  };
}

describe("PgTenantVoiceProfileStore database error mapping", () => {
  const input = {
    tenantId: "ten_voice" as TenantId,
    profile,
    expectedRevision: 0,
    actor: { kind: "user" as const, userId: "usr_voice_admin" },
    reason: "Initial profile",
  };

  it.each(["23514", "22021", "23502"])("maps PostgreSQL %s to a validation error", async (code) => {
    const { pool } = failingPool(code);
    await expect(new PgTenantVoiceProfileStore(pool).publish(input))
      .rejects.toBeInstanceOf(TenantVoiceProfileValidationError);
  });

  it.each(["P0001", "23503", "23505"])("maps PostgreSQL %s to a conflict error", async (code) => {
    const { pool } = failingPool(code);
    await expect(new PgTenantVoiceProfileStore(pool).publish(input))
      .rejects.toBeInstanceOf(TenantVoiceProfileConflictError);
  });

  it("preserves unrelated database failures", async () => {
    const { pool, failure } = failingPool("08006");
    await expect(new PgTenantVoiceProfileStore(pool).publish(input)).rejects.toBe(failure);
  });
});
