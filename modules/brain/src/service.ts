import { BRAIN_MANIFEST } from "./manifest";
import { LocalEmbeddingAdapter, type EmbeddingProvider } from "./embeddings";
import { EmbeddingProviderError, OpenAIEmbeddingAdapter, type OpenAIEmbeddingConfig } from "./embeddings-openai";
import { executeBrainTool, type BrainTool } from "./mcp-service";
import type { TenantId } from "@opentenant/auth";
import type { ModuleHostServices } from "@opentenant/database/module-host";
export async function brainAuthority(host: ModuleHostServices, tenantId: string, userId: string): Promise<readonly string[]> {
  const tenant = await host.currentTenant();
  if (!tenant || tenant.tenantId !== tenantId) return [];
  const session = await host.currentSession(tenant.tenantId as TenantId);
  if (!session || session.userId !== userId || session.activeTenantId !== tenantId) return [];
  return host.resolvePermissions(session, tenantId, BRAIN_MANIFEST.key);
}

/** Host composition passes credentials in typed configuration, separately from
 * browser config and module environment projections. Nothing is auto-enabled. */
export interface BrainCallOptions {
  embedding?: OpenAIEmbeddingConfig;
  signal?: AbortSignal;
  /** Test-only injection of synthetic HTTP. Defaults to native fetch. */
  fetcher?: typeof fetch;
}

export async function brainCall(host: ModuleHostServices, tenantId: string, userId: string, permissions: readonly string[], name: BrainTool, args: Record<string, unknown>, options: BrainCallOptions = {}) {
  const storage = { withClient: <T>(work: (client: import("./decisions-chain").DecisionChainClient) => Promise<T>) => host.withTenantDb(tenantId as TenantId, work) };
  const router = host.modelRouter();
  const embeddingAdapters = new Map<string, EmbeddingProvider>();
  // Resolve policy before constructing or dispatching any hosted adapter. A
  // configured hosted provider never falls back to deterministic token hashing.
  if (!options.embedding && ["development", "test"].includes(host.serverConfig().NODE_ENV ?? "")) {
    embeddingAdapters.set("local", new LocalEmbeddingAdapter());
  }
  return executeBrainTool({ storage, embeddingAdapters,
    resolveEmbeddingRoute: async () => {
      const route = await router.resolve({ tenantId: tenantId as TenantId, moduleId: BRAIN_MANIFEST.key, useCase: "embedding", slot: "primary" });
      if (options.embedding) {
        if (route.provider !== "openai") throw new EmbeddingProviderError("UNAVAILABLE");
        if (route.model !== options.embedding.model) throw new EmbeddingProviderError("MODEL_MISMATCH");
        if (route.region !== options.embedding.region) throw new EmbeddingProviderError("REGION_MISMATCH");
        const adapter = new OpenAIEmbeddingAdapter(options.embedding, options.fetcher);
        embeddingAdapters.set(adapter.provider, { provider: adapter.provider, dimensions: adapter.dimensions,
          embed: documents => adapter.embed(documents, options.signal ? { signal: options.signal } : {}),
        });
      }
      return route;
    },
  }, { tenantId, userId, permissions }, name, args);
}
