import { describe, expect, it, vi } from "vitest";
import { ModelRouter, type CrossBorderConsent, type ModelRoutingStore, type TenantId } from "@opentenant/platform-core";
import { AnthropicChatAdapter, OpenAIChatAdapter } from "./model-router-adapters";

const tenantId = "synthetic-tenant" as TenantId;
for (const provider of ["openai", "anthropic"] as const) describe(`${provider} routing policy`, () => {
  const setup = (consent: CrossBorderConsent | null = null, retention = false) => {
    const config = { baseUrl: "https://models.example.test/v1", model: "chat-snapshot-1", region: "us", timeoutMs: 100, maxOutputTokens: 32 } as const;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(provider === "openai"
      ? { model: config.model, choices: [{ message: { content: "safe" }, finish_reason: "stop" }] }
      : { model: config.model, type: "message", content: [{ type: "text", text: "safe" }], stop_reason: "end_turn" }));
    const adapter = provider === "openai" ? new OpenAIChatAdapter({ ...config, apiVersion: "v1" }, fetcher) : new AnthropicChatAdapter({ ...config, apiVersion: "2023-06-01" }, fetcher);
    const store: ModelRoutingStore = {
      tenantPolicy: async () => ({ tenantId, dataRegion: "eu", requireZeroRetention: retention }),
      allowlist: async () => ({ version: "allowlist-v1", requireZeroRetention: false,
        entries: [{ provider, model: config.model, region: "us", retentionPosture: "provider_default" }] }),
      tenantSelection: async () => ({ moduleUseCase: { primary: { provider, model: config.model } } }),
      installationDefaults: async () => ({ byUseCase: {} }), activeCrossBorderConsent: async () => consent,
      consentPolicyVersion: async () => "consent-v1", recordResolution: vi.fn(async () => {}), recordStreamTerminal: vi.fn(async () => {}),
    };
    const broker = { resolve: vi.fn(async () => ({ origin: "tenant" as const, secret: "synthetic-broker-secret" })) };
    return { store, broker, fetcher, adapter, router: new ModelRouter(store, broker, [adapter]) };
  };
  const call = { tenantId, moduleId: "example", useCase: "chat", slot: "primary" as const, input: "synthetic prompt" };
  const consent = (version = "consent-v1"): CrossBorderConsent => ({ actorId: "synthetic-actor", grantedAt: new Date(), policyVersion: version,
    pairs: [{ provider, region: "us", retentionPosture: "provider_default" }] });
  it("blocks cross-border requests without consent before credential lookup or HTTP", async () => {
    const { router, broker, fetcher } = setup();
    await expect(router.complete(call)).rejects.toMatchObject({ code: "RESIDENCY_MISMATCH" });
    expect(broker.resolve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects stale consent and retention mismatch", async () => {
    const stale = setup(consent("old"));
    await expect(stale.router.complete(call)).rejects.toMatchObject({ code: "CONSENT_POLICY_STALE" });
    expect(stale.fetcher).not.toHaveBeenCalled();
    const retaining = setup(consent(), true);
    await expect(retaining.router.complete(call)).rejects.toMatchObject({ code: "RETENTION_MISMATCH" });
    expect(retaining.fetcher).not.toHaveBeenCalled();
  });
  it("dispatches only with matching live consent and records credential origin without its secret", async () => {
    const { router, store, fetcher } = setup(consent());
    await expect(router.complete(call)).resolves.toEqual({ output: "safe" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(store.recordResolution).toHaveBeenCalledWith(expect.objectContaining({ keyOrigin: "tenant", regionServed: "us", allowlistVersion: "allowlist-v1" }));
    expect(JSON.stringify(vi.mocked(store.recordResolution).mock.calls)).not.toContain("synthetic-broker-secret");
  });
  it("keeps the production port unavailable when no adapter is registered", async () => {
    const { store, broker, fetcher } = setup(consent());
    await expect(new ModelRouter(store, broker, []).complete(call)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("routes buffered content and terminal evidence through the stream port", async () => {
    const { router, store } = setup(consent());
    const events = [];
    for await (const event of router.stream(call)) events.push(event);
    expect(events).toEqual([{ type: "content", content: "safe" }, { type: "completed" }]);
    expect(store.recordStreamTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "completed" }));
  });
});
