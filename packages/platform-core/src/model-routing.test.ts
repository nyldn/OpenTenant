import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  ModelResolutionError,
  ModelRouter,
  type ModelRoutingStore,
  type ProviderCredentialBroker,
  type SyntheticModelAdapter,
} from "./model-routing";
import type { ModelStreamEvent } from "./index";
import type { TenantId } from "./tenant";

const tenantId = "tenant_example" as TenantId;
type RecordStreamTerminal = NonNullable<ModelRoutingStore["recordStreamTerminal"]>;
const baseStore = (): ModelRoutingStore => ({
  tenantPolicy: vi.fn<ModelRoutingStore["tenantPolicy"]>(async () => ({
    tenantId,
    dataRegion: "eu",
    requireZeroRetention: false,
  })),
  allowlist: vi.fn<ModelRoutingStore["allowlist"]>(async () => ({
    version: "allowlist-v3",
    requireZeroRetention: false,
    entries: [
      {
        provider: "synthetic",
        model: "triage-eu",
        region: "eu",
        retentionPosture: "zero_retention",
      },
      {
        provider: "synthetic",
        model: "triage-us",
        region: "us",
        retentionPosture: "provider_default",
      },
    ],
  })),
  tenantSelection: vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
    moduleUseCase: {
      primary: { provider: "synthetic", model: "triage-eu" },
    },
  })),
  installationDefaults: vi.fn<ModelRoutingStore["installationDefaults"]>(async () => ({
    byUseCase: {},
  })),
  activeCrossBorderConsent: vi.fn<ModelRoutingStore["activeCrossBorderConsent"]>(
    async () => null,
  ),
  consentPolicyVersion: vi.fn<ModelRoutingStore["consentPolicyVersion"]>(
    async () => "cross-border-v2",
  ),
  recordResolution: vi.fn<ModelRoutingStore["recordResolution"]>(async () => undefined),
  recordStreamTerminal: vi.fn<RecordStreamTerminal>(async () => undefined),
});

const collect = async (events: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> => {
  const collected: ModelStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

describe("ModelRouter", () => {
  it("follows the explicit-to-platform cascade and records the resolved attribution", async () => {
    const store = baseStore();
    vi.mocked(store.tenantSelection).mockResolvedValue({});
    vi.mocked(store.installationDefaults).mockResolvedValue({
      byUseCase: {
        primary: { provider: "synthetic", model: "triage-eu" },
      },
    });
    const router = new ModelRouter(store);

    const result = await router.resolve({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
    });

    expect(result.source).toBe("installation_use_case");
    expect(store.recordResolution).toHaveBeenCalledWith({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      operationKind: "resolve",
      provider: "synthetic",
      model: "triage-eu",
      keyOrigin: "none",
      regionServed: "eu",
      retentionPosture: "zero_retention",
      allowlistVersion: "allowlist-v3",
    });
  });

  it("does not accept coarse residency from the caller", async () => {
    const router = new ModelRouter(baseStore());
    const input: Parameters<typeof router.resolve>[0] & { dataRegion: string } = {
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      dataRegion: "us",
    };

    await expect(router.resolve(input)).rejects.toMatchObject({
      code: "CALLER_RESIDENCY_FORBIDDEN",
    });
  });

  it("fails an explicitly selected residency mismatch instead of substituting another model", async () => {
    const store = baseStore();
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: {
        primary: { provider: "synthetic", model: "triage-us" },
        secondary: { provider: "synthetic", model: "triage-eu" },
      },
    });

    await expect(
      new ModelRouter(store).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "RESIDENCY_MISMATCH" });
    expect(store.recordResolution).not.toHaveBeenCalled();
  });

  it("requires active pair-specific consent for an out-of-region selection", async () => {
    const store = baseStore();
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: {
        primary: { provider: "synthetic", model: "triage-us" },
      },
    });
    vi.mocked(store.activeCrossBorderConsent).mockResolvedValue({
      actorId: "user_admin",
      grantedAt: new Date("2026-07-28T10:00:00Z"),
      policyVersion: "cross-border-v2",
      pairs: [
        {
          provider: "synthetic",
          region: "us",
          retentionPosture: "provider_default",
        },
      ],
    });

    await expect(
      new ModelRouter(store).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).resolves.toMatchObject({ model: "triage-us", region: "us" });

    vi.mocked(store.activeCrossBorderConsent).mockResolvedValue(null);
    await expect(
      new ModelRouter(store).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "RESIDENCY_MISMATCH" });
  });

  it.each(["provider_default", "unverified"] as const)(
    "treats %s as retaining when zero retention is required",
    async (retentionPosture) => {
      const store = baseStore();
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v4",
        requireZeroRetention: true,
        entries: [
          {
            provider: "synthetic",
            model: "triage-eu",
            region: "eu",
            retentionPosture,
          },
        ],
      });

      await expect(
        new ModelRouter(store).resolve({
          tenantId,
          moduleId: "support",
          useCase: "ticket-triage",
          slot: "primary",
        }),
      ).rejects.toMatchObject({ code: "RETENTION_MISMATCH" });
    },
  );

  it("errors when no configured slot resolves instead of inventing a platform default", async () => {
    const store = baseStore();
    vi.mocked(store.tenantSelection).mockResolvedValue({});
    vi.mocked(store.installationDefaults).mockResolvedValue({
      byUseCase: {},
    });

    await expect(
      new ModelRouter(store).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "secondary",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "UNRESOLVABLE_SLOT",
      }),
    );
  });

  it("brokers tenant-first credentials and never exposes them to module callers", async () => {
    const store = baseStore();
    const credentials: ProviderCredentialBroker = {
      resolve: vi.fn<ProviderCredentialBroker["resolve"]>(async () => ({
        origin: "tenant",
        secret: "synthetic-opaque-secret",
      })),
    };
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async ({ model, input }) => ({
        output: `${model}:${input}`,
      })),
    };
    const router = new ModelRouter(store, credentials, [adapter]);

    const result = await router.complete({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "synthetic ticket",
    });

    expect(result).toEqual({ output: "triage-eu:synthetic ticket" });
    expect(credentials.resolve).toHaveBeenCalledWith(tenantId, "synthetic");
    // The resolved region must reach the adapter. Passing only the model let the
    // evidence record claim a region the request never went to.
    expect(adapter.complete).toHaveBeenCalledWith({
      model: "triage-eu",
      region: "eu",
      input: "synthetic ticket",
      credential: "synthetic-opaque-secret",
    });
    expect(store.recordResolution).toHaveBeenCalledWith(
      expect.objectContaining({ keyOrigin: "tenant" }),
    );
    expect(result).not.toHaveProperty("credential");
  });

  it("records a stream attempt before adapter use and emits only content plus a durable terminal", async () => {
    const store = baseStore();
    const order: string[] = [];
    vi.mocked(store.recordResolution).mockImplementation(async () => { order.push("attempt"); });
    vi.mocked(store.recordStreamTerminal!).mockImplementation(async () => { order.push("terminal"); });
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* ({ credential }) {
        order.push("adapter");
        expect(credential).toBe("synthetic-opaque-secret");
        yield "safe ";
        yield "content";
      }),
    };

    const events = await collect(new ModelRouter(store, brokerFor("tenant"), [adapter]).stream({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "private input",
    }));

    expect(events).toEqual([
      { type: "content", content: "safe " },
      { type: "content", content: "content" },
      { type: "completed" },
    ]);
    expect(order).toEqual(["attempt", "adapter", "terminal"]);
    const attempt = vi.mocked(store.recordResolution).mock.calls[0]?.[0];
    expect(attempt).toMatchObject({ operationKind: "stream", keyOrigin: "tenant" });
    expect(attempt?.resolutionId).toMatch(/^res_/u);
    expect(attempt).not.toHaveProperty("input");
    expect(store.recordStreamTerminal).toHaveBeenCalledWith({
      resolutionId: attempt?.resolutionId,
      state: "completed",
    });
    expect(events).not.toContainEqual(expect.objectContaining({ credential: expect.anything() }));
  });

  it("prepares policy before admission without brokering credentials or starting a stream attempt", async () => {
    const store = baseStore();
    const credentials = brokerFor("tenant");
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* () { yield "unused"; }),
    };

    const prepared = await new ModelRouter(store, credentials, [adapter]).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });
    prepared.stream({ input: "private input" });

    expect(prepared.policy).toMatchObject({
      provider: "synthetic",
      model: "triage-eu",
      allowlistVersion: "allowlist-v3",
      source: "tenant_module_use_case",
    });
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operationKind: "resolve",
      provider: "synthetic",
      model: "triage-eu",
    }));
  });

  it("refuses a prepared stream when current policy no longer matches its admission policy", async () => {
    const store = baseStore();
    const credentials = brokerFor("tenant");
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* ({ model }) { yield `used:${model}`; }),
    };
    const router = new ModelRouter(store, credentials, [adapter]);
    const routingInput = {
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary" as const,
    };
    const prepared = await router.prepareStream(routingInput);
    vi.mocked(store.allowlist).mockResolvedValue({
      version: "allowlist-v4",
      requireZeroRetention: false,
      entries: [{
        provider: "synthetic",
        model: "replacement-eu",
        region: "eu",
        retentionPosture: "zero_retention",
      }],
    });
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: { primary: { provider: "synthetic", model: "replacement-eu" } },
    });
    routingInput.moduleId = "caller-module";
    routingInput.useCase = "caller-use-case";
    prepared.policy.model = "caller-model";

    await expect(collect(prepared.stream({ input: "private input" }))).rejects.toMatchObject({
      code: "PREPARED_POLICY_STALE",
      message: "prepared model policy is no longer current",
    });
    expect(store.allowlist).toHaveBeenCalledTimes(2);
    expect(store.tenantSelection).toHaveBeenCalledTimes(2);
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledTimes(1);
    expect(store.recordStreamTerminal).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", (store: ModelRoutingStore) => {
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v3",
        requireZeroRetention: false,
        entries: [{
          provider: "alternate",
          model: "triage-eu",
          region: "eu",
          retentionPosture: "zero_retention",
        }],
      });
      vi.mocked(store.tenantSelection).mockResolvedValue({
        moduleUseCase: { primary: { provider: "alternate", model: "triage-eu" } },
      });
    }],
    ["model", (store: ModelRoutingStore) => {
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v3",
        requireZeroRetention: false,
        entries: [{
          provider: "synthetic",
          model: "replacement-eu",
          region: "eu",
          retentionPosture: "zero_retention",
        }],
      });
      vi.mocked(store.tenantSelection).mockResolvedValue({
        moduleUseCase: { primary: { provider: "synthetic", model: "replacement-eu" } },
      });
    }],
    ["region", (store: ModelRoutingStore) => {
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v3",
        requireZeroRetention: false,
        entries: [{
          provider: "synthetic",
          model: "triage-eu",
          region: "us",
          retentionPosture: "zero_retention",
        }],
      });
      vi.mocked(store.activeCrossBorderConsent).mockResolvedValue({
        actorId: "user_admin",
        grantedAt: new Date("2026-09-06T12:00:00Z"),
        policyVersion: "cross-border-v2",
        pairs: [{ provider: "synthetic", region: "us", retentionPosture: "zero_retention" }],
      });
    }],
    ["retention posture", (store: ModelRoutingStore) => {
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v3",
        requireZeroRetention: false,
        entries: [{
          provider: "synthetic",
          model: "triage-eu",
          region: "eu",
          retentionPosture: "provider_default",
        }],
      });
    }],
    ["allowlist version", (store: ModelRoutingStore) => {
      vi.mocked(store.allowlist).mockResolvedValue({
        version: "allowlist-v4",
        requireZeroRetention: false,
        entries: [{
          provider: "synthetic",
          model: "triage-eu",
          region: "eu",
          retentionPosture: "zero_retention",
        }],
      });
    }],
    ["resolution source", (store: ModelRoutingStore) => {
      vi.mocked(store.tenantSelection).mockResolvedValue({});
      vi.mocked(store.installationDefaults).mockResolvedValue({
        byUseCase: { primary: { provider: "synthetic", model: "triage-eu" } },
      });
    }],
  ] as const)("rejects a prepared stream when its %s changes", async (_field, changePolicy) => {
    const store = baseStore();
    const credentials = brokerFor();
    const prepared = await new ModelRouter(store, credentials).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });
    changePolicy(store);

    await expect(collect(prepared.stream({ input: "private input" }))).rejects.toMatchObject({
      code: "PREPARED_POLICY_STALE",
    });
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledOnce();
  });

  it("rejects a prepared stream when its upstream pin changes", async () => {
    const store = baseStore();
    vi.mocked(store.allowlist).mockResolvedValue({
      version: "allowlist-v3",
      requireZeroRetention: false,
      entries: [{
        provider: "openrouter",
        model: "triage-eu",
        region: "eu",
        retentionPosture: "zero_retention",
        pin: { upstreamProvider: "anthropic", dataPolicy: "policy-v1" },
      }],
    });
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: { primary: { provider: "openrouter", model: "triage-eu" } },
    });
    const credentials = brokerFor();
    const prepared = await new ModelRouter(store, credentials).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });
    vi.mocked(store.allowlist).mockResolvedValue({
      version: "allowlist-v3",
      requireZeroRetention: false,
      entries: [{
        provider: "openrouter",
        model: "triage-eu",
        region: "eu",
        retentionPosture: "zero_retention",
        pin: { upstreamProvider: "anthropic", dataPolicy: "policy-v2" },
      }],
    });

    await expect(collect(prepared.stream({ input: "private input" }))).rejects.toMatchObject({
      code: "PREPARED_POLICY_STALE",
    });
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledOnce();
  });

  it("fails a prepared stream when its current policy is revoked", async () => {
    const store = baseStore();
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: { primary: { provider: "synthetic", model: "triage-us" } },
    });
    vi.mocked(store.activeCrossBorderConsent).mockResolvedValue({
      actorId: "user_admin",
      grantedAt: new Date("2026-09-06T12:00:00Z"),
      policyVersion: "cross-border-v2",
      pairs: [{ provider: "synthetic", region: "us", retentionPosture: "provider_default" }],
    });
    const credentials = brokerFor();
    const prepared = await new ModelRouter(store, credentials).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });
    vi.mocked(store.activeCrossBorderConsent).mockResolvedValue(null);

    await expect(collect(prepared.stream({ input: "private input" }))).rejects.toMatchObject({
      code: "RESIDENCY_MISMATCH",
    });
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledOnce();
  });

  it("fails a prepared stream when its current slot becomes unresolvable", async () => {
    const store = baseStore();
    const credentials = brokerFor();
    const prepared = await new ModelRouter(store, credentials).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });
    vi.mocked(store.tenantSelection).mockResolvedValue({});
    vi.mocked(store.installationDefaults).mockResolvedValue({ byUseCase: {} });

    await expect(collect(prepared.stream({ input: "private input" }))).rejects.toMatchObject({
      code: "UNRESOLVABLE_SLOT",
    });
    expect(credentials.resolve).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledOnce();
  });

  it("allows a prepared stream handle to be consumed only once", async () => {
    const store = baseStore();
    const credentials = brokerFor("tenant");
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* () { yield "safe"; }),
    };
    const prepared = await new ModelRouter(store, credentials, [adapter]).prepareStream({
      tenantId,
      moduleId: "assessment",
      useCase: "executive-readout",
      slot: "primary",
    });

    await expect(collect(prepared.stream({ input: "first" }))).resolves.toEqual([
      { type: "content", content: "safe" },
      { type: "completed" },
    ]);
    await expect(collect(prepared.stream({ input: "second" }))).rejects.toMatchObject({
      code: "PREPARED_STREAM_CONSUMED",
      message: "prepared model stream has already been consumed",
    });
    expect(credentials.resolve).toHaveBeenCalledOnce();
    expect(adapter.stream).toHaveBeenCalledOnce();
    expect(store.recordResolution).toHaveBeenCalledTimes(2);
    expect(store.recordStreamTerminal).toHaveBeenCalledOnce();
  });

  it("refuses streaming without a credential broker", async () => {
    const store = baseStore();
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* () { yield "should not run"; }),
    };

    await expect(collect(new ModelRouter(store, undefined, [adapter]).stream({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "private input",
    }))).rejects.toMatchObject({ code: "CREDENTIAL_BROKER_UNAVAILABLE" });
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordResolution).not.toHaveBeenCalled();
  });

  it("does not invoke a streaming adapter when attempt evidence cannot be recorded", async () => {
    const store = baseStore();
    vi.mocked(store.recordResolution).mockRejectedValue(new Error("database detail"));
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* () { yield "should not run"; }),
    };

    await expect(collect(new ModelRouter(store, brokerFor(), [adapter]).stream({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "private input",
    }))).rejects.toMatchObject({ code: "AUDIT_RECORDING_FAILED" });
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordStreamTerminal).not.toHaveBeenCalled();
  });

  it("records an already-aborted stream without invoking the adapter", async () => {
    const store = baseStore();
    const controller = new AbortController();
    controller.abort();
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(async function* () { yield "should not run"; }),
    };

    await expect(collect(new ModelRouter(store, brokerFor(), [adapter]).stream({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "private input",
      signal: controller.signal,
    }))).resolves.toEqual([{ type: "cancelled" }]);
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordStreamTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
  });

  it("forwards mid-stream cancellation, closes the adapter iterator, and records cancellation once", async () => {
    const store = baseStore();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const cleanup = vi.fn();
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(({ signal }): AsyncIterable<string> => {
        receivedSignal = signal;
        let sent = false;
        const iterator: AsyncIterator<string> & AsyncIterable<string> = {
          [Symbol.asyncIterator]() { return iterator; },
          async next(): Promise<IteratorResult<string>> {
            if (!sent) { sent = true; return { done: false, value: "first" }; }
            return new Promise<IteratorResult<string>>((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true }));
          },
          async return() { cleanup(); return { done: true, value: undefined }; },
        };
        return iterator;
      }),
    };
    const iterator = new ModelRouter(store, brokerFor(), [adapter]).stream({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "private input",
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: "content", content: "first" } });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: "cancelled" } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(receivedSignal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(store.recordStreamTerminal).toHaveBeenCalledTimes(1);
    expect(store.recordStreamTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
  });

  it("aborts a pending adapter read before public return waits for cleanup", async () => {
    const store = baseStore();
    let adapterStarted!: () => void;
    const started = new Promise<void>((resolve) => { adapterStarted = resolve; });
    let receivedSignal: AbortSignal | undefined;
    const cleanup = vi.fn(() => {
      expect(receivedSignal?.aborted).toBe(true);
    });
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(({ signal }): AsyncIterable<string> => {
        receivedSignal = signal;
        const iterator: AsyncIterator<string> & AsyncIterable<string> = {
          [Symbol.asyncIterator]() { return iterator; },
          next: () => {
            adapterStarted();
            return new Promise<IteratorResult<string>>((resolve) => {
              signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true });
            });
          },
          return: async () => {
            cleanup();
            return { done: true, value: undefined };
          },
        };
        return iterator;
      }),
    };
    const iterator = new ModelRouter(store, brokerFor(), [adapter]).stream({
      tenantId, moduleId: "support", useCase: "ticket-triage", slot: "primary", input: "private input",
    });

    const pendingNext = iterator.next();
    await started;
    const returned = iterator.return(undefined);
    expect(receivedSignal?.aborted).toBe(true);
    await expect(pendingNext).resolves.toEqual({ done: false, value: { type: "cancelled" } });
    await expect(returned).resolves.toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(store.recordStreamTerminal).toHaveBeenCalledTimes(1);
    expect(store.recordStreamTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
  });

  it("aborts before awaiting adapter cleanup after an adapter error", async () => {
    let receivedSignal: AbortSignal | undefined;
    let abortedAtCleanup = false;
    const cleanup = vi.fn(() => { abortedAtCleanup = receivedSignal?.aborted === true; });
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn(({ signal }): AsyncIterable<string> => {
        receivedSignal = signal;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => { throw new Error("provider detail"); },
            return: async () => {
              cleanup();
              return { done: true, value: undefined };
            },
          }),
        };
      }),
    };

    await expect(collect(new ModelRouter(baseStore(), brokerFor(), [adapter]).stream({
      tenantId, moduleId: "support", useCase: "ticket-triage", slot: "primary", input: "private input",
    }))).resolves.toEqual([{ type: "failed", code: "ADAPTER_ERROR" }]);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(abortedAtCleanup).toBe(true);
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "keeps queued public calls from changing a durable %s terminal",
    async (state) => {
      const store = baseStore();
      let terminalStarted!: () => void;
      let releaseTerminal!: () => void;
      const started = new Promise<void>((resolve) => { terminalStarted = resolve; });
      const release = new Promise<void>((resolve) => { releaseTerminal = resolve; });
      vi.mocked(store.recordStreamTerminal!).mockImplementation(async () => {
        terminalStarted();
        await release;
      });
      const controller = new AbortController();
      if (state === "cancelled") controller.abort();
      const adapter: SyntheticModelAdapter = {
        provider: "synthetic",
        regions: ["eu"],
        complete: vi.fn(async () => ({ output: "unused" })),
        stream: vi.fn((): AsyncIterable<string> => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              if (state === "failed") throw new Error("provider detail");
              return { done: true, value: undefined };
            },
          }),
        })),
      };
      const iterator = new ModelRouter(store, brokerFor(), [adapter]).stream({
        tenantId, moduleId: "support", useCase: "ticket-triage", slot: "primary", input: "private input",
        signal: controller.signal,
      });

      const terminal = iterator.next();
      await started;
      const queuedNext = iterator.next();
      const callerError = new Error("caller stop");
      const thrown = iterator.throw(callerError);
      const returned = iterator.return(undefined);
      releaseTerminal();

      const expected = state === "failed"
        ? { type: "failed", code: "ADAPTER_ERROR" }
        : { type: state };
      await expect(terminal).resolves.toEqual({ done: false, value: expected });
      await expect(queuedNext).resolves.toEqual({ done: true, value: undefined });
      await expect(thrown).rejects.toBe(callerError);
      await expect(returned).resolves.toEqual({ done: true, value: undefined });
      expect(store.recordStreamTerminal).toHaveBeenCalledTimes(1);
      expect(vi.mocked(store.recordStreamTerminal!).mock.calls[0]?.[0].state).toBe(state);
    },
  );

  it("converts adapter and terminal-audit errors to safe failed states", async () => {
    const store = baseStore();
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "unused" })),
      stream: vi.fn((): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => { throw new Error("provider secret detail"); },
        }),
      })),
    };
    const router = new ModelRouter(store, brokerFor(), [adapter]);

    await expect(collect(router.stream({
      tenantId, moduleId: "support", useCase: "ticket-triage", slot: "primary", input: "private input",
    }))).resolves.toEqual([{ type: "failed", code: "ADAPTER_ERROR" }]);
    expect(store.recordStreamTerminal).toHaveBeenCalledWith(expect.objectContaining({
      state: "failed", failureCode: "ADAPTER_ERROR",
    }));

    vi.mocked(store.recordStreamTerminal!).mockClear();
    vi.mocked(store.recordStreamTerminal!).mockRejectedValue(new Error("database secret detail"));
    adapter.stream = vi.fn(async function* () { yield "chunk"; });
    await expect(collect(router.stream({
      tenantId, moduleId: "support", useCase: "ticket-triage", slot: "primary", input: "private input",
    }))).resolves.toEqual([
      { type: "content", content: "chunk" },
      { type: "failed", code: "AUDIT_ERROR" },
    ]);
    expect(store.recordStreamTerminal).toHaveBeenCalledTimes(1);
  });

  it("bounds generic policy-store failures while preserving policy refusals", async () => {
    const dependencyError = new Error("postgres host and query detail");
    const failingStore = baseStore();
    vi.mocked(failingStore.tenantPolicy).mockRejectedValue(dependencyError);
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "should not run" })),
      stream: vi.fn(async function* () { yield "should not run"; }),
    };
    const router = new ModelRouter(failingStore, brokerFor(), [adapter]);

    for (const call of [
      () => router.resolve({ tenantId, moduleId: "support", useCase: "triage", slot: "primary" }),
      () => router.complete({ tenantId, moduleId: "support", useCase: "triage", slot: "primary", input: "private" }),
      () => router.stream({ tenantId, moduleId: "support", useCase: "triage", slot: "primary", input: "private" }).next(),
    ]) {
      const result = call();
      await expect(result).rejects.toMatchObject({
        code: "POLICY_STORE_UNAVAILABLE",
        message: "model routing policy is unavailable",
      });
      await result.catch((error: unknown) => {
        expect(error).not.toHaveProperty("cause");
      });
    }
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();

    const refusal = new ModelResolutionError("RESIDENCY_MISMATCH", "bounded policy refusal");
    vi.mocked(failingStore.tenantPolicy).mockRejectedValue(refusal);
    await expect(router.resolve({
      tenantId, moduleId: "support", useCase: "triage", slot: "primary",
    })).rejects.toBe(refusal);
  });

  it("bounds credential-broker failures and never invokes an adapter", async () => {
    const broker: ProviderCredentialBroker = {
      resolve: vi.fn(async () => { throw new Error("vault backend and secret detail"); }),
    };
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "should not run" })),
      stream: vi.fn(async function* () { yield "should not run"; }),
    };
    const router = new ModelRouter(baseStore(), broker, [adapter]);
    await expect(router.complete({
      tenantId, moduleId: "support", useCase: "triage", slot: "primary", input: "private",
    })).rejects.toMatchObject({
      code: "CREDENTIAL_BROKER_FAILED",
      message: "provider credential lookup failed",
    });
    await expect(router.stream({
      tenantId, moduleId: "support", useCase: "triage", slot: "primary", input: "private",
    }).next()).rejects.toMatchObject({
      code: "CREDENTIAL_BROKER_FAILED",
      message: "provider credential lookup failed",
    });
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();
  });

  it("removes caller abort forwarding after every early stream refusal", async () => {
    const policyRefusal = new ModelResolutionError("RESIDENCY_MISMATCH", "bounded policy refusal");
    const scenarios: readonly {
      name: string;
      build: (adapter: SyntheticModelAdapter) => {
        router: ModelRouter;
        expected: Pick<ModelResolutionError, "code" | "message">;
        exact?: ModelResolutionError;
      };
    }[] = [
      {
        name: "policy store",
        build: (adapter) => {
          const store = baseStore();
          vi.mocked(store.tenantPolicy).mockRejectedValue(policyRefusal);
          return { router: new ModelRouter(store, brokerFor(), [adapter]), expected: policyRefusal, exact: policyRefusal };
        },
      },
      {
        name: "missing credential broker",
        build: (adapter) => ({
          router: new ModelRouter(baseStore(), undefined, [adapter]),
          expected: {
            code: "CREDENTIAL_BROKER_UNAVAILABLE",
            message: "a credential broker is required; refusing to call a provider unbrokered",
          },
        }),
      },
      {
        name: "credential broker",
        build: (adapter) => ({
          router: new ModelRouter(baseStore(), {
            resolve: vi.fn(async () => { throw new Error("vault backend detail"); }),
          }, [adapter]),
          expected: {
            code: "CREDENTIAL_BROKER_FAILED",
            message: "provider credential lookup failed",
          },
        }),
      },
      {
        name: "missing adapter",
        build: () => ({
          router: new ModelRouter(baseStore(), brokerFor()),
          expected: {
            code: "ADAPTER_UNAVAILABLE",
            message: "streaming provider adapter is unavailable",
          },
        }),
      },
      {
        name: "missing configuration",
        build: (adapter) => {
          const store = baseStore();
          vi.mocked(store.tenantSelection).mockResolvedValue({});
          vi.mocked(store.installationDefaults).mockResolvedValue({ byUseCase: {} });
          return {
            router: new ModelRouter(store, brokerFor(), [adapter]),
            expected: { code: "UNRESOLVABLE_SLOT", message: "no model is configured for this slot" },
          };
        },
      },
      {
        name: "attempt audit",
        build: (adapter) => {
          const store = baseStore();
          vi.mocked(store.recordResolution).mockRejectedValue(new Error("database detail"));
          return {
            router: new ModelRouter(store, brokerFor(), [adapter]),
            expected: {
              code: "AUDIT_RECORDING_FAILED",
              message: "model attempt evidence could not be recorded",
            },
          };
        },
      },
    ];

    for (const scenario of scenarios) {
      const adapter: SyntheticModelAdapter = {
        provider: "synthetic",
        regions: ["eu"],
        complete: vi.fn(async () => ({ output: "unused" })),
        stream: vi.fn(async function* () { yield "should not run"; }),
      };
      const { router, expected, exact } = scenario.build(adapter);
      const controller = new AbortController();
      const baseline = getEventListeners(controller.signal, "abort").length;
      const iterator = router.stream({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
        input: "private input",
        signal: controller.signal,
      });
      expect(getEventListeners(controller.signal, "abort"), scenario.name).toHaveLength(baseline + 1);

      const result = iterator.next();
      if (exact) await expect(result, scenario.name).rejects.toBe(exact);
      else await expect(result, scenario.name).rejects.toMatchObject(expected);
      expect(getEventListeners(controller.signal, "abort"), scenario.name).toHaveLength(baseline);
      expect(adapter.stream, scenario.name).not.toHaveBeenCalled();
    }
  });

  it("records a completed resolution before a synthetic adapter failure", async () => {
    const store = baseStore();
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => {
        throw new Error("synthetic adapter failure");
      }),
    };

    await expect(
      new ModelRouter(store, brokerFor(), [adapter]).complete({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
        input: "synthetic ticket",
      }),
    ).rejects.toThrow("synthetic adapter failure");
    expect(store.recordResolution).toHaveBeenCalledOnce();
  });

  const brokerFor = (origin: "tenant" | "installation" = "installation"): ProviderCredentialBroker => ({
    resolve: vi.fn<ProviderCredentialBroker["resolve"]>(async () => ({
      origin,
      secret: "synthetic-opaque-secret",
    })),
  });

  const allowlistOf = (
    entries: readonly Record<string, unknown>[],
  ): ModelRoutingStore["allowlist"] =>
    vi.fn(async () => ({
      version: "allowlist-v3",
      requireZeroRetention: false,
      entries,
    })) as unknown as ModelRoutingStore["allowlist"];

  it("refuses an adapter whose endpoint does not serve the resolved region", async () => {
    // regionServed is written into the evidence record. If the adapter is never
    // told the region, that field describes the allowlist rather than where the
    // request actually went, and an incident review would be misled.
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["us"],
      complete: vi.fn(async () => ({ output: "should not run" })),
    };

    await expect(
      new ModelRouter(baseStore(), brokerFor(), [adapter]).complete({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
        input: "synthetic ticket",
      }),
    ).rejects.toMatchObject({ code: "ADAPTER_REGION_MISMATCH" });
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("refuses to call a provider when no credential broker is configured", async () => {
    const adapter: SyntheticModelAdapter = {
      provider: "synthetic",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "should not run" })),
    };

    await expect(
      new ModelRouter(baseStore(), undefined, [adapter]).complete({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
        input: "synthetic ticket",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_BROKER_UNAVAILABLE" });
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it("rejects a router entry with no recorded upstream pin", async () => {
    const store = baseStore();
    store.allowlist = allowlistOf([
      { provider: "openrouter", model: "triage-eu", region: "eu", retentionPosture: "zero_retention" },
    ]);
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "openrouter", model: "triage-eu" } },
    }));

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "ROUTER_POLICY_UNPINNED" });
  });

  it("treats router providers case-insensitively", async () => {
    // An exact-string check on 'openrouter' let 'OpenRouter' skip the pin rule.
    const store = baseStore();
    store.allowlist = allowlistOf([
      { provider: "OpenRouter", model: "triage-eu", region: "eu", retentionPosture: "zero_retention" },
    ]);
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "OpenRouter", model: "triage-eu" } },
    }));

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "ROUTER_POLICY_UNPINNED" });
  });

  it("passes a recorded pin through to the adapter", async () => {
    const pin = { upstreamProvider: "anthropic", dataPolicy: "zero-retention-eu" };
    const store = baseStore();
    store.allowlist = allowlistOf([
      { provider: "openrouter", model: "triage-eu", region: "eu", retentionPosture: "zero_retention", pin },
    ]);
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "openrouter", model: "triage-eu" } },
    }));
    const adapter: SyntheticModelAdapter = {
      provider: "openrouter",
      regions: ["eu"],
      complete: vi.fn(async () => ({ output: "ok" })),
    };

    await new ModelRouter(store, brokerFor(), [adapter]).complete({
      tenantId,
      moduleId: "support",
      useCase: "ticket-triage",
      slot: "primary",
      input: "synthetic ticket",
    });

    expect(adapter.complete).toHaveBeenCalledWith(expect.objectContaining({ pin, region: "eu" }));
  });

  it("rejects a non-router entry that carries an upstream pin", async () => {
    const store = baseStore();
    store.allowlist = allowlistOf([
      {
        provider: "synthetic",
        model: "triage-eu",
        region: "eu",
        retentionPosture: "zero_retention",
        pin: { upstreamProvider: "anthropic", dataPolicy: "x" },
      },
    ]);

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "ROUTER_POLICY_UNPINNED" });
  });

  it("rejects a model that is not on the owner allowlist", async () => {
    const store = baseStore();
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "not-allowlisted" } },
    }));

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "NOT_ALLOWLISTED" });
  });

  it("lets a tenant narrow past the owner ceiling", async () => {
    const store = baseStore();
    store.tenantPolicy = vi.fn<ModelRoutingStore["tenantPolicy"]>(async () => ({
      tenantId,
      dataRegion: "us",
      requireZeroRetention: true,
    }));
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "triage-us" } },
    }));

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "RETENTION_MISMATCH" });
  });

  it("stops honouring consent granted under a superseded policy", async () => {
    // 0018 stored policy_version and nothing read it. A tenant who agreed to
    // the old wording kept authorising out-of-region traffic after the question
    // changed, which is consent to something they were never asked.
    const store = baseStore();
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "triage-us" } },
    }));
    store.activeCrossBorderConsent = vi.fn<ModelRoutingStore["activeCrossBorderConsent"]>(
      async () => ({
        actorId: "user_admin",
        grantedAt: new Date("2026-07-28T10:00:00Z"),
        policyVersion: "cross-border-v1",
        pairs: [{ provider: "synthetic", region: "us", retentionPosture: "provider_default" }],
      }),
    );
    store.consentPolicyVersion = vi.fn<ModelRoutingStore["consentPolicyVersion"]>(
      async () => "cross-border-v2",
    );

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "CONSENT_POLICY_STALE" });
  });

  it("refuses to act on a consent record that names no pairs", async () => {
    const store = baseStore();
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "triage-us" } },
    }));
    store.activeCrossBorderConsent = vi.fn<ModelRoutingStore["activeCrossBorderConsent"]>(
      async () => ({
        actorId: "user_admin",
        grantedAt: new Date("2026-07-28T10:00:00Z"),
        policyVersion: "cross-border-v2",
        pairs: [],
      }),
    );

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).rejects.toMatchObject({ code: "CONSENT_PAIRS_EMPTY" });
  });

  it("keeps a current, populated consent working", async () => {
    // The three cases above only mean something if the honest path still
    // resolves. A fail-closed check that fails everything is not a check.
    const store = baseStore();
    store.tenantSelection = vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "triage-us" } },
    }));
    store.activeCrossBorderConsent = vi.fn<ModelRoutingStore["activeCrossBorderConsent"]>(
      async () => ({
        actorId: "user_admin",
        grantedAt: new Date("2026-07-28T10:00:00Z"),
        policyVersion: "cross-border-v2",
        pairs: [{ provider: "synthetic", region: "us", retentionPosture: "provider_default" }],
      }),
    );

    await expect(
      new ModelRouter(store, brokerFor()).resolve({
        tenantId,
        moduleId: "support",
        useCase: "ticket-triage",
        slot: "primary",
      }),
    ).resolves.toMatchObject({ model: "triage-us", region: "us" });
  });

});
