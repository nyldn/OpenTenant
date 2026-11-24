import type { TenantId } from "@opentenant/platform-core";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ModelRoutingStoreIntegrityError, PgModelRoutingStore } from "./model-routing-store";

const tenantId = "ten_alpha" as TenantId;

function poolReturning(...results: readonly { rows: unknown[] }[]): Pool {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { query } as unknown as Pool;
}

describe("PgModelRoutingStore", () => {
  it("loads policy from the tenant row and keeps the read tenant-bound", async () => {
    const pool = poolReturning({ rows: [{ tenant_id: "ten_alpha", data_region: "eu", require_zero_retention: true }] });

    await expect(new PgModelRoutingStore(pool).tenantPolicy(tenantId)).resolves.toEqual({
      tenantId,
      dataRegion: "eu",
      requireZeroRetention: true,
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("where tenant.tenant_id = $1"), [tenantId]);
  });

  it("returns only the newest allowlist version and maps full router pins", async () => {
    const pool = poolReturning({ rows: [{
      allowlist_version: "v2",
      require_zero_retention: false,
      provider: "openrouter",
      model: "anthropic/claude",
      region: "eu",
      retention_posture: "zero_retention",
      upstream_provider: "anthropic",
      upstream_data_policy: "eu-zero-retention",
    }] });

    await expect(new PgModelRoutingStore(pool).allowlist()).resolves.toEqual({
      version: "v2",
      requireZeroRetention: false,
      entries: [{
        provider: "openrouter",
        model: "anthropic/claude",
        region: "eu",
        retentionPosture: "zero_retention",
        pin: { upstreamProvider: "anthropic", dataPolicy: "eu-zero-retention" },
      }],
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("order by published.created_at desc"));
  });

  it("maps tenant selections without admitting rows from another tenant", async () => {
    const pool = poolReturning({ rows: [
      { scope: "tenant_module_use_case", slot: "primary", provider: "anthropic", model: "claude-a" },
      { scope: "tenant_module_default", slot: "secondary", provider: "openai", model: "gpt-a" },
    ] });

    await expect(new PgModelRoutingStore(pool).tenantSelection(tenantId, "support", "triage")).resolves.toEqual({
      moduleUseCase: { primary: { provider: "anthropic", model: "claude-a" } },
      moduleDefault: { secondary: { provider: "openai", model: "gpt-a" } },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/tenant_id = \$1[\s\S]*module_id = \$2/u),
      [tenantId, "support", "triage"],
    );
  });

  it("maps all installation default scopes for the requested use case", async () => {
    const pool = poolReturning({ rows: [
      { scope: "installation_use_case", slot: "primary", provider: "anthropic", model: "claude-a" },
      { scope: "installation_default", slot: "secondary", provider: "openai", model: "gpt-a" },
      { scope: "platform_default", slot: "primary", provider: "synthetic", model: "fallback" },
    ] });

    await expect(new PgModelRoutingStore(pool).installationDefaults("triage")).resolves.toEqual({
      byUseCase: { primary: { provider: "anthropic", model: "claude-a" } },
      default: { secondary: { provider: "openai", model: "gpt-a" } },
      platformDefault: { primary: { provider: "synthetic", model: "fallback" } },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("tenant_id is null"), ["triage"]);
  });

  it("loads only the tenant's active consent and its versioned pairs", async () => {
    const grantedAt = new Date("2026-09-06T12:00:00Z");
    const pool = poolReturning({ rows: [{
      consent_id: "con_alpha",
      actor_id: "usr_alpha",
      granted_at: grantedAt,
      policy_version: "cb-2",
      provider: "openai",
      region: "us",
      retention_posture: "provider_default",
    }] });

    await expect(new PgModelRoutingStore(pool).activeCrossBorderConsent(tenantId)).resolves.toEqual({
      actorId: "usr_alpha",
      grantedAt,
      policyVersion: "cb-2",
      pairs: [{ provider: "openai", region: "us", retentionPosture: "provider_default" }],
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/consent.tenant_id = \$1[\s\S]*withdrawn_at is null/u),
      [tenantId],
    );
  });

  it("reads the newest published consent policy and refuses an absent policy", async () => {
    const current = poolReturning({ rows: [{ policy_version: "cb-2" }] });
    await expect(new PgModelRoutingStore(current).consentPolicyVersion()).resolves.toBe("cb-2");
    expect(current.query).toHaveBeenCalledWith(expect.stringContaining("order by published_at desc"));

    await expect(new PgModelRoutingStore(poolReturning({ rows: [] })).consentPolicyVersion())
      .rejects.toBeInstanceOf(ModelRoutingStoreIntegrityError);
  });

  it("writes attempt and terminal metadata without content, credentials, or usage", async () => {
    const pool = poolReturning({ rows: [] }, { rows: [] });
    const store = new PgModelRoutingStore(pool);
    await store.recordResolution({
      resolutionId: "res_test",
      operationKind: "stream",
      tenantId,
      moduleId: "support",
      useCase: "triage",
      provider: "anthropic",
      model: "claude-a",
      keyOrigin: "tenant",
      regionServed: "eu",
      retentionPosture: "zero_retention",
      allowlistVersion: "v2",
    });
    await store.recordStreamTerminal({ resolutionId: "res_test", state: "failed", failureCode: "ADAPTER_ERROR" });

    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls[0]?.[0]).toContain("insert into model_resolution_events");
    expect(calls[0]?.[1]).toEqual([
      "res_test", tenantId, "support", "triage", "anthropic", "claude-a", "tenant", "eu", "zero_retention", "v2", "stream",
    ]);
    expect(calls[1]?.[0]).toContain("insert into model_stream_terminal_events");
    expect(calls[1]?.[1]).toEqual(["res_test", "failed", "ADAPTER_ERROR"]);
    expect(calls.map(([sql]) => String(sql)).join("\n")).not.toMatch(/\b(prompt|completion|credential|usage)\b/iu);
  });
});
