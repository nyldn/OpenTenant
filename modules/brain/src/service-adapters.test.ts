import { describe, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { brainCall } from "./service";
import type { OpenAIEmbeddingConfig } from "./embeddings-openai";
const config: OpenAIEmbeddingConfig = { baseUrl: "https://models.example.test/v1", apiKey: "synthetic-service-secret", apiVersion: "v1", model: "embedding-snapshot-1", region: "eu", dimensions: 1536, timeoutMs: 100 };
function setup(mode: string | undefined = "production", route = { provider: "openai", model: config.model, region: "eu" }) {
  const resolve = vi.fn(async () => route);
  const query = vi.fn(async () => ({ rows: [{ id: "synthetic-chunk", content: "synthetic" }] }));
  const db = vi.fn(async (_tenant, work) => work({ query }));
  const host = { serverConfig: () => ({ NODE_ENV: mode }), modelRouter: () => ({ resolve }), withTenantDb: db } as unknown as ModuleHostServices;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ model: config.model, data: [{ index: 0, embedding: Array(1536).fill(0.25) }] }));
  const search = (embedding?: OpenAIEmbeddingConfig, signal?: AbortSignal) => brainCall(host, "synthetic-tenant", "synthetic-user", ["brain.use"], "search", { query: "synthetic" },
    { ...(embedding ? { embedding } : {}), ...(signal ? { signal } : {}), fetcher });
  return { resolve, query, db, fetcher, search };
}
describe("Brain hosted composition", () => {
  it("composes hosted search only after tenant routing policy resolves", async () => {
    const { search, resolve, fetcher, query } = setup();
    await expect(search(config)).resolves.toEqual([{ id: "synthetic-chunk", content: "synthetic" }]);
    expect(resolve).toHaveBeenCalledWith({ tenantId: "synthetic-tenant", moduleId: "brain", useCase: "embedding", slot: "primary" });
    expect(resolve.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]!);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("embedding_model"), expect.arrayContaining(["openai", config.model]));
  });
  it("fails closed for unconfigured production and unknown execution mode", async () => {
    for (const mode of ["production", "unknown"]) {
      const { search, fetcher, db } = setup(mode, { provider: "local", model: "token-hash-v1", region: "eu" });
      await expect(search()).rejects.toThrow("Approved embedding adapter unavailable");
      expect(fetcher).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
    }
  });
  it("keeps development token hashing explicitly local", async () => {
    const { search, fetcher, query } = setup("development", { provider: "local", model: "token-hash-v1", region: "eu" });
    await search(); expect(fetcher).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["local", "token-hash-v1"]));
  });
  it("blocks mismatched provider, model and region without HTTP or database search", async () => {
    for (const route of [{ provider: "other", model: config.model, region: "eu" }, { provider: "openai", model: "other", region: "eu" }, { provider: "openai", model: config.model, region: "us" }]) {
      const { search, fetcher, db } = setup("production", route);
      await expect(search(config)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
    }
  });
  it("does not dispatch when consent or residency policy refuses the route", async () => {
    const { search, resolve, fetcher, db } = setup();
    resolve.mockRejectedValue(new Error("Cross-border consent unavailable"));
    await expect(search(config)).rejects.toThrow("Cross-border consent unavailable");
    expect(fetcher).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
  });
  it("does not fall back to local hashing when a hosted request fails", async () => {
    const { search, fetcher, db } = setup("development", { provider: "openai", model: config.model, region: "eu" });
    fetcher.mockRejectedValue(new Error(config.apiKey));
    await expect(search(config)).rejects.toThrow("Embedding provider unavailable"); expect(db).not.toHaveBeenCalled();
  });
  it("forwards cancellation and does not search with a cancelled embedding", async () => {
    const { search, fetcher, db } = setup(), controller = new AbortController(); controller.abort(config.apiKey);
    await expect(search(config, controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
  });
});
