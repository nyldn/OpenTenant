import type { EmbeddingDocument, EmbeddingProvider, EmbeddingResult } from "./embeddings";

/** Exact model identifiers must be used in routing and persisted chunk metadata.
 * apiVersion is the supported wire protocol, not a model alias or deployment. */
export interface OpenAIEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  apiVersion: "v1";
  model: string;
  region: "us" | "eu" | "ap";
  dimensions: 1536;
  timeoutMs: number;
}
export type EmbeddingErrorCode = "INVALID_CONFIG" | "UNAVAILABLE" | "MODEL_MISMATCH" | "REGION_MISMATCH"
  | "TIMEOUT" | "CANCELLED" | "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE";
const messages: Record<EmbeddingErrorCode, string> = {
  INVALID_CONFIG: "Invalid embedding provider configuration", UNAVAILABLE: "Approved embedding adapter unavailable",
  MODEL_MISMATCH: "Embedding model mismatch", REGION_MISMATCH: "Embedding region mismatch",
  TIMEOUT: "Embedding provider request timed out", CANCELLED: "Embedding provider request cancelled",
  PROVIDER_REJECTED: "Embedding provider rejected the request", PROVIDER_UNAVAILABLE: "Embedding provider unavailable",
  INVALID_RESPONSE: "Invalid embedding provider response",
};
export class EmbeddingProviderError extends Error {
  constructor(readonly code: EmbeddingErrorCode) { super(messages[code]); this.name = "EmbeddingProviderError"; }
}
function validate(config: OpenAIEmbeddingConfig): string {
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || config.apiVersion !== "v1" || config.dimensions !== 1536
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model)
      || !["us", "eu", "ap"].includes(config.region) || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey)
      || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 300_000) throw new Error();
    return `${url.href.replace(/\/$/, "")}/embeddings`;
  } catch { throw new EmbeddingProviderError("INVALID_CONFIG"); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EmbeddingProviderError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
export class OpenAIEmbeddingAdapter implements EmbeddingProvider {
  readonly provider = "openai";
  readonly dimensions = 1536;
  private readonly config: Readonly<OpenAIEmbeddingConfig>;
  private readonly url: string;
  constructor(config: OpenAIEmbeddingConfig, private readonly fetcher: typeof fetch = fetch) {
    this.url = validate(config);
    this.config = Object.freeze({ ...config });
  }
  async embed(documents: ReadonlyArray<EmbeddingDocument>, options: { signal?: AbortSignal } = {}): Promise<ReadonlyArray<EmbeddingResult>> {
    if (options.signal?.aborted) throw new EmbeddingProviderError("CANCELLED");
    if (documents.length === 0) return [];
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new EmbeddingProviderError(timedOut ? "TIMEOUT" : "CANCELLED"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const body = await Promise.race([this.request(documents, controller.signal), aborted]);
      return this.results(body, documents);
    } catch (error) {
      if (timedOut) throw new EmbeddingProviderError("TIMEOUT");
      if (options.signal?.aborted) throw new EmbeddingProviderError("CANCELLED");
      if (error instanceof EmbeddingProviderError) throw error;
      throw new EmbeddingProviderError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    }
  }
  private async request(documents: ReadonlyArray<EmbeddingDocument>, signal: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(this.url, {
      method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: this.config.model, input: documents.map(doc => doc.content), dimensions: this.dimensions, encoding_format: "float" }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new EmbeddingProviderError(response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED");
    }
    try { return await response.json(); } catch { throw new EmbeddingProviderError("INVALID_RESPONSE"); }
  }
  private results(body: unknown, documents: ReadonlyArray<EmbeddingDocument>): ReadonlyArray<EmbeddingResult> {
    const response = object(body);
    if (response.model !== this.config.model || !Array.isArray(response.data) || response.data.length !== documents.length) throw new EmbeddingProviderError("INVALID_RESPONSE");
    const vectors = new Map<number, number[]>();
    for (const item of response.data) {
      const row = object(item), index = row.index, vector: unknown = row.embedding;
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= documents.length || vectors.has(index)
        || !Array.isArray(vector) || vector.length !== this.dimensions || !vector.every(value => typeof value === "number" && Number.isFinite(value))
        || !Number.isFinite(Math.hypot(...vector)) || Math.hypot(...vector) === 0) throw new EmbeddingProviderError("INVALID_RESPONSE");
      vectors.set(index, vector);
    }
    return documents.map((doc, index) => ({ id: doc.id, vector: vectors.get(index)!, dimensions: this.dimensions,
      provider: this.provider, model: this.config.model, version: this.config.apiVersion }));
  }
}
