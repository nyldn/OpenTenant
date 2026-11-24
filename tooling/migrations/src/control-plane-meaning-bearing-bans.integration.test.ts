import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../../packages/security/src/canonical-json";
import {
  VOICE_PROFILE_MEANING_BEARING_WORDS,
  type TenantVoiceProfileInput,
} from "../../../packages/platform-core/src/voice-profile";
import { applyMigrations, type MigrationFile } from "./runner";
import { integrationDatabaseUrl } from "./integration-guard";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;

async function migrations(): Promise<MigrationFile[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane");
  return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()
    .map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(join(directory, name), "utf8") })));
}

function profileWithBans(bannedWords: readonly string[]): TenantVoiceProfileInput {
  return {
    readingLevel: "professional",
    formality: "neutral",
    person: "second",
    tense: "present",
    sentenceLength: "medium",
    bannedWords,
    preferredWords: ["clear"],
    exampleRewrites: [{ before: "We utilise clear words.", after: "We use clear words." }],
  };
}

/**
 * Writes straight to the table rather than through the store, because the store
 * validates in TypeScript first. The point of these cases is that the database
 * refuses them on its own, so a write path that skipped or drifted from the
 * application check still could not store a meaning-bearing ban.
 */
async function insertProfile(pool: Pool, version: number, profile: TenantVoiceProfileInput): Promise<void> {
  const canonical = canonicalJsonStringify(profile);
  const digest = createHash("sha256").update(canonical ?? "").digest("hex");
  await pool.query(
    `insert into tenant_voice_profile_versions
       (tenant_id, version, profile, digest, published_by_user_id, reason)
     values ('ten_ban_a', $1, $2::jsonb, $3, 'usr_ban_admin', 'test')`,
    [version, JSON.stringify(profile), digest],
  );
}

describeIntegration("meaning-bearing ban refusal against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 4 });

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, await migrations());
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_ban_a', 'ban-a', 'Ban A', 'active', 'eu')`,
    );
  });

  afterAll(async () => pool.end());

  it("stores an ordinary style ban", async () => {
    await insertProfile(pool, 1, profileWithBans(["utilise", "synergy", "leverage"]));
    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from tenant_voice_profile_versions",
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses a banned negation by the named constraint", async () => {
    await expect(insertProfile(pool, 1, profileWithBans(["not"]))).rejects.toThrow(
      /tenant_voice_profile_bans_exclude_meaning_bearing_words/,
    );
  });

  it("refuses a meaning-bearing word hidden among ordinary ones", async () => {
    await expect(
      insertProfile(pool, 1, profileWithBans(["utilise", "never", "synergy"])),
    ).rejects.toThrow(/tenant_voice_profile_bans_exclude_meaning_bearing_words/);
  });

  it("refuses apostrophe spellings that canonicalise onto a listed key", async () => {
    for (const spelling of ["can't", "can’t", "cant"]) {
      await expect(insertProfile(pool, 1, profileWithBans([spelling]))).rejects.toThrow(
        /tenant_voice_profile_bans_exclude_meaning_bearing_words/,
      );
    }
  });

  /**
   * Parity by execution, not by reading the SQL. The application list and the
   * database list are written twice and would otherwise drift silently; every
   * entry in the TypeScript set is put to the live function and must come back
   * refused.
   */
  it("refuses every word in the application's published set", async () => {
    const words = [...VOICE_PROFILE_MEANING_BEARING_WORDS];
    const { rows } = await pool.query<{ word: string; refused: boolean }>(
      `select word, tenant_voice_profile_word_is_meaning_bearing(word) as refused
         from unnest($1::text[]) as word`,
      [words],
    );
    expect(rows).toHaveLength(words.length);
    expect(rows.filter((row) => !row.refused).map((row) => row.word)).toEqual([]);
  });

  it("leaves words outside the set alone", async () => {
    const { rows } = await pool.query<{ word: string; refused: boolean }>(
      `select word, tenant_voice_profile_word_is_meaning_bearing(word) as refused
         from unnest($1::text[]) as word`,
      [["utilise", "synergy", "leverage", "just", "very", "really", "notable", "cannonball"]],
    );
    expect(rows.filter((row) => row.refused).map((row) => row.word)).toEqual([]);
  });
});
