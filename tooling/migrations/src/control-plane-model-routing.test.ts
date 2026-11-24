import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../sql/control-plane/0018_model_routing.sql", import.meta.url), "utf8");

describe("control-plane model routing migration", () => {
  it("persists the complete allowlist, consent, credential, and attribution contracts", () => {
    expect(sql).toContain("create table model_allowlist_versions");
    expect(sql).toContain("create table model_allowlist_entries");
    expect(sql).toContain("region in ('us', 'eu', 'ap')");
    expect(sql).toContain(
      "retention_posture in ('zero_retention', 'provider_default', 'unverified')",
    );
    expect(sql).toContain("provider <> 'openrouter' or pinned_upstream");
    expect(sql).toContain("create table model_cross_border_consents");
    expect(sql).toContain("actor_id text not null");
    expect(sql).toContain("granted_at timestamptz not null");
    expect(sql).toContain("policy_version text not null");
    expect(sql).toContain("create table model_cross_border_consent_pairs");
    expect(sql).toContain("where withdrawn_at is null");
    expect(sql).toContain("create table model_provider_credentials");
    expect(sql).toContain("encrypted_credential bytea not null");
    expect(sql).toContain("create table model_resolution_events");
    expect(sql).toContain("key_origin text not null");
    expect(sql).toContain("allowlist_version text not null");
  });

  it("does not persist prompt, completion, or plaintext credential fields", () => {
    expect(sql).not.toMatch(/\bprompt\s+text\b/);
    expect(sql).not.toMatch(/\bcompletion\s+text\b/);
    expect(sql).not.toMatch(/\bcredential\s+text\b/);
  });
});
