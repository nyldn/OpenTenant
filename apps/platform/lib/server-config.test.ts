import { describe, expect, it } from "vitest";
import { serverConfig, tenantHostname, tenantPublicOrigin } from "./server-config";

import { productionConfig as production } from "../test/production-config";

describe("server configuration", () => {
  it("validates Developer MCP at startup and preserves the exact production owner gate", () => {
    expect(serverConfig({}).DEVELOPER_MCP_ENABLED).toBeUndefined();
    expect(() => serverConfig({ DEVELOPER_MCP_ENABLED: "invalid" })).toThrow("DEVELOPER_MCP_ENABLED");
    expect(() => serverConfig({ ...production, DEVELOPER_MCP_ENABLED: "true" })).toThrow("OWNER-DEVELOPER-MCP-02");
  });
  it.each(["1", "0", "", "true"])("rejects the e2e composition flag in production: %s", (flag) => {
    expect(() => serverConfig({ ...production, OPENTENANT_E2E: flag })).toThrow("OPENTENANT_E2E");
  });
  it("defaults the tenant domain only outside production", () => {
    expect(tenantHostname("alpha", {})).toBe("alpha.example.test");
    expect(tenantHostname("alpha", { OPENTENANT_TENANT_BASE_DOMAIN: "Tenants.Example.Test" }))
      .toBe("alpha.tenants.example.test");
    expect(() => serverConfig({ ...production, OPENTENANT_TENANT_BASE_DOMAIN: undefined }))
      .toThrow("OPENTENANT_TENANT_BASE_DOMAIN");
  });
  it.each(["https://example.test", "example.test:443", "*.example.test", "127.0.0.1", "bad_host.test", "local", "example..test", "example.test/path", "a".repeat(64) + ".test"])("rejects invalid base hostname %s", (value) => {
    expect(() => serverConfig({ OPENTENANT_TENANT_BASE_DOMAIN: value })).toThrow("OPENTENANT_TENANT_BASE_DOMAIN");
  });
  it("accepts the explicit loopback tenant suffix without enabling local production identity", () => {
    expect(tenantHostname("alpha", { OPENTENANT_TENANT_BASE_DOMAIN: "localhost" })).toBe("alpha.localhost");
    expect(serverConfig({ ...production, OPENTENANT_TENANT_BASE_DOMAIN: "localhost" }).OPENTENANT_TENANT_BASE_DOMAIN).toBe("localhost");
    expect(() => serverConfig({ ...production, OPENTENANT_TENANT_BASE_DOMAIN: "localhost", LOCAL_USERS: "[]" })).toThrow("LOCAL_USERS");
  });
  it.each(["-alpha", "alpha-", "a.b", "alpha/other", "a".repeat(41)])("rejects a slug that cannot form a tenant hostname: %s", (slug) => {
    expect(() => tenantHostname(slug, {})).toThrow("tenant hostname");
  });
  it("requires selected provider secrets only and forbids production local identity", () => {
    expect(serverConfig(production).IDENTITY_PROVIDER).toBe("workos");
    expect(() => serverConfig({ ...production, IDENTITY_PROVIDER: "local" })).toThrow("IDENTITY_PROVIDER");
    expect(() => serverConfig({ ...production, IDENTITY_PROVIDER: "clerk" })).toThrow("CLERK_SECRET_KEY");
    expect(serverConfig({ ...production, IDENTITY_PROVIDER: "clerk", WORKOS_API_KEY: undefined,
      CLERK_SECRET_KEY: "synthetic", CLERK_PUBLISHABLE_KEY: "synthetic", CLERK_JWT_ISSUER: "https://id.example.test",
      CLERK_AUTHORIZED_PARTIES: "https://app.example.test", CLERK_JWT_AUDIENCE: "opentenant",
    }).IDENTITY_PROVIDER).toBe("clerk");
  });
  it("reports field names without rejected values", () => {
    for (const key of ["CONTROL_PLANE_DATABASE_URL", "TENANT_DB_ENCRYPTION_KEY", "NEON_API_KEY", "MODULE_ACCESS_SECRET"]) {
      expect(() => serverConfig({ ...production, [key]: undefined })).toThrow(key);
    }
    try { serverConfig({ CONTROL_PLANE_DATABASE_URL: "secret-value" }); }
    catch (error) { expect(String(error)).not.toContain("secret-value"); }
    expect(() => serverConfig({ TENANT_DB_ENCRYPTION_KEY: "invalid" })).toThrow("TENANT_DB_ENCRYPTION_KEY");
  });
  it.each([undefined, "", "s".repeat(31)])("rejects a missing or short production connection state secret: %s", (secret) => {
    expect(() => serverConfig({ ...production, CONNECTIONS_STATE_SECRET: secret }))
      .toThrow("CONNECTIONS_STATE_SECRET");
  });
});

it("accepts a production keyring without the legacy variable", () => {
  expect(serverConfig({ ...production, TENANT_DB_ENCRYPTION_KEY: undefined,
    TENANT_DB_ENCRYPTION_KEYS: `next:${Buffer.alloc(32, 3).toString('base64')}`,
    TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: 'next',
  }).TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID).toBe('next');
  expect(() => serverConfig({ TENANT_DB_ENCRYPTION_KEYS: 'next:invalid', TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: 'next' }))
    .toThrow('TENANT_DB_ENCRYPTION_KEYS');
});

it("requires only the selected production provisioning provider", () => {
  const postgres = { ...production, PROVISIONING_PROVIDER: "postgres", POSTGRES_ADMIN_DATABASE_URL: "postgresql://operator:synthetic@db.example.test/postgres", NEON_API_KEY: undefined, NEON_ORG_ID: undefined };
  expect(serverConfig(postgres).PROVISIONING_PROVIDER).toBe("postgres");
  expect(() => serverConfig({ ...postgres, POSTGRES_ADMIN_DATABASE_URL: undefined })).toThrow("POSTGRES_ADMIN_DATABASE_URL");
  expect(() => serverConfig({ ...production, PROVISIONING_PROVIDER: "other" })).toThrow("PROVISIONING_PROVIDER");
  expect(() => serverConfig({ ...production, LOCAL_USERS: "[]" })).toThrow("LOCAL_USERS");
});

it("projects only build and routing values for framework entrypoints", async () => {
  const { buildConfig, routingConfig } = await import("./server-config");
  const env = { NODE_ENV: "test", IDENTITY_PROVIDER: "local", OPENTENANT_E2E: "1", POSTGRES_ADMIN_DATABASE_URL: "secret-canary" };
  expect(JSON.stringify(buildConfig(env)) + JSON.stringify(routingConfig(env))).not.toContain("secret-canary");
  expect(buildConfig(env).OPENTENANT_E2E).toBe("1");
  expect(routingConfig(env).IDENTITY_PROVIDER).toBe("local");
});

it("keeps loopback links on the configured tunnel port without changing ordinary tenant links", () => {
  const env = { OPENTENANT_TENANT_BASE_DOMAIN: "localhost", PLATFORM_PUBLIC_ORIGIN: "http://localhost:31001" };
  expect(tenantPublicOrigin("alpha.localhost", env)).toBe("http://alpha.localhost:31001");
  expect(tenantPublicOrigin("alpha.example.test", env)).toBe("https://alpha.example.test");
  expect(tenantPublicOrigin("alpha.localhost", {})).toBe("https://alpha.localhost");
  expect(() => tenantPublicOrigin("foreign.localhost/evil", env)).toThrow("tenant hostname");
  expect(() => tenantPublicOrigin("alpha.localhost", { ...env, PLATFORM_PUBLIC_ORIGIN: "http://remote.example.test:31001" })).toThrow("PLATFORM_PUBLIC_ORIGIN");
});

const chatSettings = (provider: string) => ({
  [`MODEL_${provider}_BASE_URL`]: "https://models.example.test/v1",
  [`MODEL_${provider}_MODEL`]: "chat-snapshot-1", [`MODEL_${provider}_REGION`]: "eu",
  [`MODEL_${provider}_TIMEOUT_MS`]: "1000", [`MODEL_${provider}_MAX_OUTPUT_TOKENS`]: "256",
  [`MODEL_${provider}_API_VERSION`]: provider === "OPENAI" ? "v1" : "2023-06-01",
});
it("projects optional provider groups without enabling unconfigured production adapters", async () => {
  const { modelRouterProviderConfig, brainEmbeddingConfig } = await import("./server-config");
  expect(modelRouterProviderConfig(serverConfig(production))).toEqual({});
  expect(brainEmbeddingConfig(serverConfig(production))).toBeUndefined();
  const config = serverConfig({ ...production, ...chatSettings("OPENAI"), ...chatSettings("ANTHROPIC") });
  expect(modelRouterProviderConfig(config)).toMatchObject({ openai: { region: "eu", timeoutMs: 1000, maxOutputTokens: 256, apiVersion: "v1" }, anthropic: { apiVersion: "2023-06-01" } });
});
it("rejects partial or malformed provider groups using key names only", () => {
  for (const provider of ["OPENAI", "ANTHROPIC"]) {
    for (const key of ["BASE_URL", "MODEL", "REGION", "TIMEOUT_MS", "MAX_OUTPUT_TOKENS", "API_VERSION"]) {
      const name = `MODEL_${provider}_${key}`;
      expect(() => serverConfig({ ...chatSettings(provider), [name]: "secret-canary\n" })).toThrow(name);
      expect(() => serverConfig({ ...chatSettings(provider), [name]: undefined })).toThrow(name);
      try { serverConfig({ ...chatSettings(provider), [name]: "secret-canary\n" }); }
      catch (error) { expect(String(error)).not.toContain("secret-canary"); }
    }
  }
});
it("keeps embedding secrets out of projections and validation errors", async () => {
  const { brainEmbeddingConfig, buildConfig, routingConfig, supportAiRetentionConfig } = await import("./server-config");
  const env = { BRAIN_EMBEDDING_BASE_URL: "https://models.example.test/v1", BRAIN_EMBEDDING_MODEL: "embedding-snapshot", BRAIN_EMBEDDING_REGION: "eu", BRAIN_EMBEDDING_TIMEOUT_MS: "1000", BRAIN_EMBEDDING_API_VERSION: "v1", BRAIN_EMBEDDING_API_KEY: "secret-canary" };
  const embedding = brainEmbeddingConfig(serverConfig(env));
  expect(embedding).toMatchObject({ dimensions: 1536, region: "eu", timeoutMs: 1000 });
  expect(embedding?.apiKey).toBe("secret-canary");
  expect(JSON.stringify([embedding, buildConfig(env), routingConfig(env)])).not.toContain("secret-canary");
  for (const key of Object.keys(env)) expect(() => serverConfig({ ...env, [key]: undefined })).toThrow(key);
  expect(() => serverConfig({ ...env, BRAIN_EMBEDDING_API_KEY: "secret-canary\n" })).toThrow("BRAIN_EMBEDDING_API_KEY");
  expect(supportAiRetentionConfig(serverConfig({})).size).toBe(0);
  expect(supportAiRetentionConfig(serverConfig({ SUPPORT_AI_RETENTION_DATABASE_URLS: '{"tenant_a":"postgresql://operator:synthetic@db.example.test/tenant_a"}' })).has("tenant_a")).toBe(true);
  for (const value of ["secret-canary", '{"tenant_a":"secret-canary"}', '[]', '{"../other":"postgresql://db.example.test/tenant"}']) {
    expect(() => serverConfig({ SUPPORT_AI_RETENTION_DATABASE_URLS: value })).toThrow("SUPPORT_AI_RETENTION_DATABASE_URLS");
  }
});
