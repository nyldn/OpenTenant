import { describe, expect, it, vi } from "vitest";
import {
  ModelResolutionError,
  ModelRouter,
  type ModelRoutingStore,
  type ProviderCredentialBroker,
  type SyntheticModelAdapter,
  type TenantId,
} from "@opentenant/platform-core";
import {
  ASSESSMENT_MODULE_ID,
  ASSESSMENT_READOUT_USE_CASE,
  AssessmentReadoutAuthorityError,
  createAssessmentReadout,
} from "./readout";

const tenantId = "tenant_alpha" as TenantId;

function routingStore(version = "allowlist-v1"): ModelRoutingStore {
  return {
    tenantPolicy: vi.fn<ModelRoutingStore["tenantPolicy"]>(async () => ({
      tenantId,
      dataRegion: "eu",
      requireZeroRetention: false,
    })),
    allowlist: vi.fn<ModelRoutingStore["allowlist"]>(async () => ({
      version,
      requireZeroRetention: false,
      entries: [{
        provider: "synthetic",
        model: "assessment-local",
        region: "eu",
        retentionPosture: "zero_retention",
      }],
    })),
    tenantSelection: vi.fn<ModelRoutingStore["tenantSelection"]>(async () => ({
      moduleUseCase: { primary: { provider: "synthetic", model: "assessment-local" } },
    })),
    installationDefaults: vi.fn<ModelRoutingStore["installationDefaults"]>(async () => ({ byUseCase: {} })),
    activeCrossBorderConsent: vi.fn<ModelRoutingStore["activeCrossBorderConsent"]>(async () => null),
    consentPolicyVersion: vi.fn<ModelRoutingStore["consentPolicyVersion"]>(async () => "consent-v1"),
    recordResolution: vi.fn<ModelRoutingStore["recordResolution"]>(async () => undefined),
    recordStreamTerminal: vi.fn<NonNullable<ModelRoutingStore["recordStreamTerminal"]>>(
      async () => undefined,
    ),
  };
}

function syntheticAdapter(): SyntheticModelAdapter {
  return {
    provider: "synthetic",
    regions: ["eu"],
    complete: vi.fn(async () => ({ output: "unused" })),
    stream: vi.fn(async function* () {
      yield "First ";
      yield "step";
    }),
  };
}

describe("Assessment readout composition", () => {
  it("binds trusted authority and server-owned routing attribution", async () => {
    const store = routingStore();
    const adapter = syntheticAdapter();
    const broker: ProviderCredentialBroker = {
      resolve: vi.fn<ProviderCredentialBroker["resolve"]>(async () => ({
        origin: "tenant",
        secret: "synthetic-secret",
      })),
    };
    const router = new ModelRouter(store, broker, [adapter]);
    const service = createAssessmentReadout(router);

    const prepared = await service.prepare({
      tenantId,
      principal: { kind: "identity", principalId: "user_alpha" },
      summary: "Synthetic assessment summary",
    });

    expect(adapter.stream).not.toHaveBeenCalled();
    expect(prepared.policy).toEqual({
      provider: "synthetic",
      model: "assessment-local",
      region: "eu",
      retentionPosture: "zero_retention",
      allowlistVersion: "allowlist-v1",
      source: "tenant_module_use_case",
    });
    const events = [];
    for await (const event of prepared.stream()) events.push(event);
    expect(events).toEqual([
      { type: "content", content: "First " },
      { type: "content", content: "step" },
      { type: "completed" },
    ]);
    expect(store.tenantSelection).toHaveBeenCalledWith(
      tenantId,
      ASSESSMENT_MODULE_ID,
      ASSESSMENT_READOUT_USE_CASE,
    );
    expect(store.allowlist).toHaveBeenCalledTimes(2);
    expect(store.tenantSelection).toHaveBeenCalledTimes(2);
    expect(adapter.stream).toHaveBeenCalledWith(expect.objectContaining({
      model: "assessment-local",
    }));
    expect(store.recordResolution).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId,
      moduleId: ASSESSMENT_MODULE_ID,
      useCase: ASSESSMENT_READOUT_USE_CASE,
      operationKind: "resolve",
      provider: "synthetic",
      model: "assessment-local",
      allowlistVersion: "allowlist-v1",
    }));
    expect(store.recordResolution).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tenantId,
      moduleId: ASSESSMENT_MODULE_ID,
      useCase: ASSESSMENT_READOUT_USE_CASE,
      operationKind: "stream",
      keyOrigin: "tenant",
      provider: "synthetic",
      model: "assessment-local",
      allowlistVersion: "allowlist-v1",
    }));
    expect(store.recordResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.anything(),
    }));
  });

  it("refuses policy drift after preparation without starting inference", async () => {
    const store = routingStore();
    const adapter = syntheticAdapter();
    const broker: ProviderCredentialBroker = {
      resolve: vi.fn<ProviderCredentialBroker["resolve"]>(async () => ({
        origin: "tenant",
        secret: "synthetic-secret",
      })),
    };
    const prepared = await createAssessmentReadout(
      new ModelRouter(store, broker, [adapter]),
    ).prepare({
      tenantId,
      principal: { kind: "identity", principalId: "user_alpha" },
      summary: "Synthetic assessment summary",
    });
    vi.mocked(store.allowlist).mockResolvedValue({
      version: "allowlist-v2",
      requireZeroRetention: false,
      entries: [{
        provider: "synthetic",
        model: "replacement-local",
        region: "eu",
        retentionPosture: "zero_retention",
      }],
    });
    vi.mocked(store.tenantSelection).mockResolvedValue({
      moduleUseCase: { primary: { provider: "synthetic", model: "replacement-local" } },
    });
    const consume = async () => {
      for await (const _event of prepared.stream()) {
        // No event is permitted once the admitted policy is stale.
      }
    };

    await expect(consume()).rejects.toMatchObject({ code: "PREPARED_POLICY_STALE" });
    expect(broker.resolve).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.recordResolution).toHaveBeenCalledTimes(1);
    expect(store.recordStreamTerminal).not.toHaveBeenCalled();
  });

  it("changes the retry fingerprint when resolved policy becomes stale", async () => {
    const adapter = syntheticAdapter();
    const broker: ProviderCredentialBroker = {
      resolve: vi.fn<ProviderCredentialBroker["resolve"]>(async () => ({
        origin: "installation",
        secret: "synthetic",
      })),
    };
    const prepare = async (version: string) => createAssessmentReadout(new ModelRouter(
      routingStore(version), broker, [adapter],
    )).prepare({
      tenantId,
      principal: { kind: "identity", principalId: "user_alpha" },
      summary: "Same summary",
    });

    const current = await prepare("allowlist-v1");
    const stale = await prepare("allowlist-v2");

    expect(current.fingerprint).not.toBe(stale.fingerprint);
    expect(adapter.stream).not.toHaveBeenCalled();
  });

  it("preserves bounded policy errors without starting inference", async () => {
    const refusal = new ModelResolutionError("RESIDENCY_MISMATCH", "bounded policy refusal");
    const router = {
      prepareStream: vi.fn(async () => { throw refusal; }),
    };

    await expect(createAssessmentReadout(router).prepare({
      tenantId,
      principal: { kind: "identity", principalId: "user_alpha" },
      summary: "Synthetic assessment summary",
    })).rejects.toBe(refusal);
    expect(router.prepareStream).toHaveBeenCalledOnce();
  });

  it("accepts only the server-verified tenant-bound Assessment passcode principal", async () => {
    const router = {
      prepareStream: vi.fn(),
    };
    const service = createAssessmentReadout(router);

    await expect(service.prepare({
      tenantId,
      principal: {
        kind: "passcode",
        principalId: "passcode:assessment",
        tenantId: "tenant_beta",
        moduleKey: "assessment",
      },
      summary: "Synthetic assessment summary",
    })).rejects.toBeInstanceOf(AssessmentReadoutAuthorityError);
    await expect(service.prepare({
      tenantId,
      principal: {
        kind: "passcode",
        principalId: "passcode:assessment",
        tenantId: "tenant_alpha",
        moduleKey: "support",
      },
      summary: "Synthetic assessment summary",
    })).rejects.toBeInstanceOf(AssessmentReadoutAuthorityError);
    expect(router.prepareStream).not.toHaveBeenCalled();
  });
});
