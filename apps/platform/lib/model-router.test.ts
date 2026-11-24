import type { ModelRouterProviderConfig } from "./model-router-config";
import type { ProviderCredentialBroker, TenantId } from "@opentenant/platform-core";
import type { Pool } from "pg";
import { CredentialCipher } from "@opentenant/database";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ mode: "production" as string | undefined, construct: vi.fn(), providers: {} as ModelRouterProviderConfig, key: "" }));
vi.mock("./server-config", () => ({ serverConfig: () => ({ NODE_ENV: state.mode, TENANT_DB_ENCRYPTION_KEY: state.key }), modelRouterProviderConfig: () => state.providers }));
vi.mock("./control-plane", () => ({ controlPlanePool: vi.fn(() => ({ query: vi.fn() })) }));
vi.mock("@opentenant/platform-core", async original => ({ ...await original<typeof import("@opentenant/platform-core")>(), ModelRouter: state.construct }));
import { modelRouter } from "./model-router";
beforeEach(() => { state.mode = "production"; state.providers = {}; state.key = Buffer.alloc(32, 3).toString("base64"); state.construct.mockClear(); });
afterEach(() => vi.restoreAllMocks());
it("registers no fallback adapter for production or unspecified mode", () => {
  for (const mode of ["production", undefined]) {
    state.mode = mode; modelRouter();
    expect(state.construct.mock.lastCall![2]).toEqual([]);
  }
});
it("registers both hosted adapters only from explicit typed configuration", () => {
  const shared = { baseUrl: "https://models.example.test/v1", model: "chat-snapshot-1", region: "eu", timeoutMs: 100, maxOutputTokens: 32 } as const;
  modelRouter(undefined, { openai: { ...shared, apiVersion: "v1" }, anthropic: { ...shared, apiVersion: "2023-06-01" } });
  expect(state.construct.mock.lastCall![2].map((adapter: { provider: string }) => adapter.provider)).toEqual(["openai", "anthropic"]);
});
it("keeps synthetic responses available only in explicit development/test modes", () => {
  for (const mode of ["development", "test"]) {
    state.mode = mode; modelRouter();
    expect(state.construct.mock.lastCall![2].map((adapter: { provider: string }) => adapter.provider)).toEqual(["synthetic"]);
  }
});

it("uses the typed provider projection by default", () => {
  state.providers = { openai: { baseUrl: "https://models.example.test/v1", model: "chat-snapshot", region: "eu", timeoutMs: 100, maxOutputTokens: 32, apiVersion: "v1" } };
  modelRouter();
  expect(state.construct.mock.lastCall![2].map((adapter: { provider: string }) => adapter.provider)).toEqual(["openai"]);
});
it("keeps chat credentials encrypted, tenant-first and bound by AAD without logging", async () => {
  const cipher = new CredentialCipher(state.key);
  const ciphertext = Buffer.from(cipher.encrypt("secret-canary", "model:tenant_a:openai"));
  const query = vi.fn(async () => ({ rows: [{ encrypted_credential: ciphertext }] }));
  modelRouter({ query } as unknown as Pool);
  const broker = state.construct.mock.lastCall![1] as ProviderCredentialBroker;
  const log = vi.spyOn(console, "error");
  await expect(broker.resolve("tenant_a" as TenantId, "openai")).resolves.toEqual({ origin: "tenant", secret: "secret-canary" });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("tenant_id is not distinct from $1"), ["tenant_a", "openai"]);
  await expect(broker.resolve("tenant_b" as TenantId, "openai")).rejects.toThrow(/^encrypted credential record failed authentication$/);
  expect(log).not.toHaveBeenCalled();
});
