import { afterEach, expect, it, vi } from "vitest";
import { embeddingProviderKeyFromEnv } from "./embeddings";
afterEach(() => vi.unstubAllEnvs());
it("uses supplied configuration even when ambient configuration differs", () => {
  vi.stubEnv("BRAIN_EMBEDDING_PROVIDER", "ambient-provider");
  expect(embeddingProviderKeyFromEnv({ BRAIN_EMBEDDING_PROVIDER: "configured-provider" })).toBe("configured-provider");
  expect(embeddingProviderKeyFromEnv({})).toBe("local");
  expect(embeddingProviderKeyFromEnv({ NODE_ENV: "production" })).toBe("unavailable");
});

import { describe } from "vitest";
import { LocalEmbeddingAdapter } from "./embeddings";
describe("local embedding adapter", () => {
  it("is deterministic, normalized and needs no provider credentials", async () => {
    const adapter = new LocalEmbeddingAdapter();
    const result = await adapter.embed([{ id: "a", content: "tenant architecture" }, { id: "b", content: "tenant architecture" }]);
    expect(result[0]!.vector).toEqual(result[1]!.vector); expect(result[0]!.vector).toHaveLength(1536);
    expect(Math.hypot(...result[0]!.vector)).toBeCloseTo(1); expect(embeddingProviderKeyFromEnv({})).toBe("local");
  });
});

import { OpenAIEmbeddingAdapter } from "./embeddings-openai";
const hostedConfig = { baseUrl: "https://models.example.test/v1", apiKey: "synthetic-embedding-secret", apiVersion: "v1", model: "embedding-snapshot-1", region: "eu", dimensions: 1536, timeoutMs: 30 } as const;
const documents = [{ id: "a", content: "synthetic content" }];
const vector = () => Array<number>(1536).fill(0.25);
const response = () => ({ model: hostedConfig.model, data: [{ index: 0, embedding: vector() }] });
describe("OpenAI embedding conformance", () => {
  it("returns exact model, version, dimensions and document correspondence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(response()));
    const result = await new OpenAIEmbeddingAdapter(hostedConfig, fetcher).embed(documents);
    expect(result[0]).toMatchObject({ id: "a", provider: "openai", model: hostedConfig.model, version: "v1", dimensions: 1536, vector: vector() });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${hostedConfig.baseUrl}/embeddings`);
    expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${hostedConfig.apiKey}`);
    expect(JSON.parse(init!.body as string)).toEqual({ model: hostedConfig.model, input: [documents[0]!.content], dimensions: 1536, encoding_format: "float" });
    expect(init!.redirect).toBe("error");
  });
  it("times out through AbortSignal", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { signal = init!.signal as AbortSignal; return new Promise(() => {}); });
    await expect(new OpenAIEmbeddingAdapter(hostedConfig, fetcher).embed(documents)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
  });
  it("keeps the timeout active while reading the response body", async () => {
    const response = new Response();
    vi.spyOn(response, "json").mockImplementation(async () => new Promise(() => {}));
    await expect(new OpenAIEmbeddingAdapter(hostedConfig, async () => response).embed(documents)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("cancels in flight and before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Promise(() => {})), controller = new AbortController();
    const adapter = new OpenAIEmbeddingAdapter(hostedConfig, fetcher);
    const pending = adapter.embed(documents, { signal: controller.signal }); controller.abort(hostedConfig.apiKey);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    fetcher.mockClear();
    await expect(adapter.embed(documents, { signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])("maps HTTP %s to safe errors", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: hostedConfig.apiKey }, { status }));
    await expect(new OpenAIEmbeddingAdapter(hostedConfig, fetcher).embed(documents)).rejects.toMatchObject({ code: status < 500 ? "PROVIDER_REJECTED" : "PROVIDER_UNAVAILABLE" });
  });
  it("rejects wrong dimensions, non-finite vectors, zero vectors and model substitution", async () => {
    const invalid = [
      { ...response(), data: [{ index: 0, embedding: [1, 2] }] },
      { ...response(), data: [{ index: 0, embedding: Array(1536).fill(0) }] },
      { ...response(), data: [{ index: 0, embedding: Array(1536).fill(null) }] },
      { ...response(), model: "other" }, { ...response(), data: [] },
      { ...response(), data: [{ index: 1, embedding: vector() }] },
    ];
    for (const body of invalid) await expect(new OpenAIEmbeddingAdapter(hostedConfig, async () => Response.json(body)).embed(documents)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("validates dimensions and version at construction", () => {
    for (const overrides of [{ dimensions: 42 }, { apiVersion: "v2" }, { timeoutMs: 0 }, { apiKey: "" }, { baseUrl: "http://models.example.test" }]) {
      expect(() => new OpenAIEmbeddingAdapter({ ...hostedConfig, ...overrides } as never)).toThrow("Invalid embedding provider configuration");
    }
  });
  it("orders out-of-order responses by index and rejects duplicate indices", async () => {
    const data = [{ index: 1, embedding: vector() }, { index: 0, embedding: vector() }];
    const adapter = new OpenAIEmbeddingAdapter(hostedConfig, async () => Response.json({ model: hostedConfig.model, data }));
    expect((await adapter.embed([...documents, { id: "b", content: "second" }])).map(row => row.id)).toEqual(["a", "b"]);
    data[0]!.index = 0;
    await expect(adapter.embed([...documents, { id: "b", content: "second" }])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("never logs or retains credential-bearing upstream errors", async () => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    for (const fetcher of [async () => Response.json({ error: hostedConfig.apiKey }, { status: 500 }), async () => { throw new Error(hostedConfig.apiKey); }, async () => new Response(hostedConfig.apiKey)]) {
      const error = await new OpenAIEmbeddingAdapter(hostedConfig, fetcher).embed(documents).catch(error => error);
      expect(String(error)).not.toContain(hostedConfig.apiKey); expect(error.stack).not.toContain(hostedConfig.apiKey); expect(error.cause).toBeUndefined();
    }
    for (const log of logs) { expect(log).not.toHaveBeenCalled(); log.mockRestore(); }
  });
});
