export interface EmbeddingDocument {
  id: string;
  content: string;
}

export interface EmbeddingResult {
  id: string;
  vector: ReadonlyArray<number>;
  dimensions: number;
  provider: string;
  model: string;
  /** Wire protocol or local algorithm version. */
  version?: string;
}

export interface EmbeddingProvider {
  readonly provider: string;
  readonly dimensions: number;
  embed(documents: ReadonlyArray<EmbeddingDocument>, options?: { signal?: AbortSignal }): Promise<ReadonlyArray<EmbeddingResult>>;
}

/** Explicit configuration only. There is no implicit hosted provider. */
export function embeddingProviderKeyFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  return env.BRAIN_EMBEDDING_PROVIDER ?? (env.NODE_ENV === "production" ? "unavailable" : "local");
}

/** Deterministic signed token hashing for local development, not semantic AI. */
export class LocalEmbeddingAdapter implements EmbeddingProvider {
  readonly provider = "local";
  readonly dimensions = 1536;
  async embed(documents: ReadonlyArray<EmbeddingDocument>, options: { signal?: AbortSignal } = {}): Promise<ReadonlyArray<EmbeddingResult>> {
    if (options.signal?.aborted) throw new Error("Local deterministic embedding request cancelled");
    return documents.map(({ id, content }) => {
      const vector = Array<number>(this.dimensions).fill(0);
      for (const token of content.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 2166136261;
        for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
        const index = hash % this.dimensions;
        vector[index] = (vector[index] ?? 0) + (hash & 0x80000000 ? -1 : 1);
      }
      if (Math.hypot(...vector) === 0) vector[0] = 1;
      const norm = Math.hypot(...vector);
      return { id, vector: vector.map((value) => value / norm), dimensions: this.dimensions, provider: this.provider, model: "token-hash-v1", version: "token-hash-v1" };
    });
  }
}
