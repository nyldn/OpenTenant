import type { DataRegion, TenantId } from "./tenant";
import { randomUUID } from "node:crypto";

export type RetentionPosture = "zero_retention" | "provider_default" | "unverified";
export type ModelSlot = "primary" | "secondary";
export type CredentialOrigin = "tenant" | "installation" | "none";

export interface ModelRef {
  provider: string;
  model: string;
}

export type ModelSlots = Partial<Record<ModelSlot, ModelRef>>;

/**
 * Providers that route onward to an upstream of their own choosing. They cannot
 * satisfy a residency constraint unless the owner has pinned where the request
 * actually lands, so the pin records what was agreed rather than that something
 * was. Compared case-insensitively: an exact-string check let 'OpenRouter'
 * bypass the rule.
 */
export const ROUTER_PROVIDERS: readonly string[] = ["openrouter"];

export const isRouterProvider = (provider: string): boolean =>
  ROUTER_PROVIDERS.includes(provider.trim().toLowerCase());

export interface UpstreamPin {
  upstreamProvider: string;
  dataPolicy: string;
}

export interface ModelAllowlistEntry extends ModelRef {
  region: DataRegion;
  retentionPosture: RetentionPosture;
  /** Required for router providers, forbidden for direct ones. */
  pin?: UpstreamPin;
}

export interface ModelAllowlist {
  version: string;
  requireZeroRetention: boolean;
  entries: readonly ModelAllowlistEntry[];
}

export interface TenantModelPolicy {
  tenantId: TenantId;
  dataRegion: DataRegion;
  requireZeroRetention: boolean;
}

export interface CrossBorderConsent {
  actorId: string;
  grantedAt: Date;
  policyVersion: string;
  pairs: readonly {
    provider: string;
    region: DataRegion;
    retentionPosture: RetentionPosture;
  }[];
}

export interface TenantModelSelection {
  moduleUseCase?: ModelSlots;
  moduleDefault?: ModelSlots;
}

export interface InstallationModelDefaults {
  byUseCase: ModelSlots;
  default?: ModelSlots;
  platformDefault?: ModelSlots;
}

export interface ModelResolutionRecord extends ModelRef {
  resolutionId?: string;
  operationKind?: ModelOperationKind;
  tenantId: TenantId;
  moduleId: string;
  useCase: string;
  keyOrigin: CredentialOrigin;
  regionServed: DataRegion;
  retentionPosture: RetentionPosture;
  allowlistVersion: string;
}

export type ModelOperationKind = "resolve" | "complete" | "stream";
export type ModelStreamTerminalState = "completed" | "failed" | "cancelled";
export type ModelStreamFailureCode = "ADAPTER_ERROR" | "AUDIT_ERROR";

export type ModelStreamTerminalRecord =
  | { resolutionId: string; state: "completed" | "cancelled" }
  | { resolutionId: string; state: "failed"; failureCode: "ADAPTER_ERROR" };

export interface ModelRoutingStore {
  tenantPolicy(tenantId: TenantId): Promise<TenantModelPolicy>;
  allowlist(): Promise<ModelAllowlist>;
  tenantSelection(
    tenantId: TenantId,
    moduleId: string,
    useCase: string,
  ): Promise<TenantModelSelection>;
  installationDefaults(useCase: string): Promise<InstallationModelDefaults>;
  activeCrossBorderConsent(tenantId: TenantId): Promise<CrossBorderConsent | null>;
  /**
   * The consent policy version currently in force. Consent granted under an
   * earlier wording does not carry forward: ADR-006 section 7 stores the
   * version precisely so a later audit can see which question the tenant
   * answered, and a changed question is a question they have not answered.
   */
  consentPolicyVersion(): Promise<string>;
  recordResolution(record: ModelResolutionRecord): Promise<void>;
  recordStreamTerminal?(record: ModelStreamTerminalRecord): Promise<void>;
}

export interface ProviderCredentialBroker {
  /**
   * Implementations resolve encrypted tenant credentials first and encrypted
   * installation credentials second. The secret must stay inside the router.
   */
  resolve(
    tenantId: TenantId,
    provider: string,
  ): Promise<{ origin: Exclude<CredentialOrigin, "none">; secret: string } | null>;
}

export interface SyntheticModelAdapter {
  readonly provider: string;
  /** Regions this adapter's endpoint actually serves. */
  readonly regions: readonly DataRegion[];
  complete(input: {
    model: string;
    region: DataRegion;
    input: string;
    credential?: string;
    pin?: UpstreamPin;
  }): Promise<{ output: string }>;
  stream?(input: {
    model: string;
    region: DataRegion;
    input: string;
    credential?: string;
    pin?: UpstreamPin;
    signal: AbortSignal;
  }): AsyncIterable<string>;
}

export type ModelStreamEvent =
  | { type: "content"; content: string }
  | { type: "completed" }
  | { type: "failed"; code: ModelStreamFailureCode }
  | { type: "cancelled" };

export interface PreparedModelStream {
  policy: ResolvedModel;
  stream(input: { input: string; signal?: AbortSignal }): AsyncGenerator<ModelStreamEvent>;
}

export type ModelResolutionSource =
  | "tenant_module_use_case"
  | "tenant_module_default"
  | "installation_use_case"
  | "installation_default"
  | "platform_default";

export interface ResolvedModel extends ModelAllowlistEntry {
  source: ModelResolutionSource;
  allowlistVersion: string;
}

export type ModelResolutionErrorCode =
  | "CALLER_RESIDENCY_FORBIDDEN"
  | "TENANT_POLICY_MISMATCH"
  | "NOT_ALLOWLISTED"
  | "ROUTER_POLICY_UNPINNED"
  | "RESIDENCY_MISMATCH"
  | "RETENTION_MISMATCH"
  | "UNRESOLVABLE_SLOT"
  | "CREDENTIAL_UNAVAILABLE"
  | "ADAPTER_UNAVAILABLE"
  | "ADAPTER_REGION_MISMATCH"
  | "AUDIT_RECORDING_FAILED"
  | "CREDENTIAL_BROKER_UNAVAILABLE"
  | "CREDENTIAL_BROKER_FAILED"
  | "POLICY_STORE_UNAVAILABLE"
  | "PREPARED_POLICY_STALE"
  | "PREPARED_STREAM_CONSUMED"
  | "CONSENT_POLICY_STALE"
  | "CONSENT_PAIRS_EMPTY";

export class ModelResolutionError extends Error {
  constructor(
    readonly code: ModelResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelResolutionError";
  }
}

/**
 * `tenantId` is supplied by the caller and is the router's only tenant binding.
 *
 * Everything downstream trusts it: residency, consent, credential scope and the
 * attribution record all derive from this one field. The router cannot verify
 * it, because there is no authenticated principal or signed-grant verifier in
 * this package to check it against. The request boundary must derive the tenant
 * from an authenticated session or from an equivalent verified, tenant-bound
 * grant. The Assessment passcode path is one such boundary: it accepts only a
 * server-verified signed grant bound to the same tenant and module.
 *
 * `CALLER_RESIDENCY_FORBIDDEN` narrows this: a caller may not assert a region,
 * only a tenant, so residency is always loaded from the tenant record. It does
 * not close the gap. Neither does `TENANT_POLICY_MISMATCH`, which compares the
 * store's answer against the same value the store was asked about, and so
 * catches a broken store rather than a caller naming someone else's tenant.
 *
 * Recorded as OPS-13 F4. Any HTTP or MCP surface put in front of this router
 * must derive `tenantId` from server-verified authority, never from submitted
 * request content.
 */
interface ResolveInput {
  tenantId: TenantId;
  moduleId: string;
  useCase: string;
  slot: ModelSlot;
}

interface PreparedStreamGuard {
  policy: ResolvedModel;
  claim(): Promise<void>;
}

const retaining = (posture: RetentionPosture): boolean =>
  posture === "provider_default" || posture === "unverified";

export class ModelRouter {
  private readonly adapters: ReadonlyMap<string, SyntheticModelAdapter>;

  constructor(
    private readonly store: ModelRoutingStore,
    private readonly credentials?: ProviderCredentialBroker,
    adapters: readonly SyntheticModelAdapter[] = [],
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  async resolve(input: ResolveInput): Promise<ResolvedModel> {
    return this.resolveAndRecord(input, "none", "resolve");
  }

  async prepareStream(input: ResolveInput): Promise<PreparedModelStream> {
    const routingInput = { ...input };
    const resolved = await this.resolveAndRecord(routingInput, "none", "resolve");
    const boundPolicy = this.copyResolved(resolved);
    let consumed = false;
    const guard: PreparedStreamGuard = {
      policy: boundPolicy,
      claim: async () => {
        if (consumed) {
          throw new ModelResolutionError(
            "PREPARED_STREAM_CONSUMED",
            "prepared model stream has already been consumed",
          );
        }
        consumed = true;
        const current = await this.resolvePolicy(routingInput);
        if (!this.sameResolvedPolicy(boundPolicy, current)) {
          throw new ModelResolutionError(
            "PREPARED_POLICY_STALE",
            "prepared model policy is no longer current",
          );
        }
      },
    };
    return {
      policy: this.copyResolved(resolved),
      stream: ({ input: content, signal }) => this.streamWithPolicy({
        ...routingInput,
        input: content,
        ...(signal ? { signal } : {}),
      }, guard),
    };
  }

  async complete(input: ResolveInput & { input: string }): Promise<{ output: string }> {
    const { tenantId, moduleId, useCase, slot } = input;
    const resolved = await this.resolvePolicy({ tenantId, moduleId, useCase, slot });
    // Degrading open when the broker is missing is not brokered credentials:
    // an adapter holding an ambient key would then run with a credential the
    // policy layer never saw.
    if (!this.credentials) {
      throw new ModelResolutionError(
        "CREDENTIAL_BROKER_UNAVAILABLE",
        "a credential broker is required; refusing to call a provider unbrokered",
      );
    }
    const credential = await this.resolveCredential(tenantId, resolved.provider);
    if (!credential) {
      throw new ModelResolutionError("CREDENTIAL_UNAVAILABLE", "provider credential is unavailable");
    }
    const adapter = this.adapters.get(resolved.provider);
    if (!adapter) {
      throw new ModelResolutionError("ADAPTER_UNAVAILABLE", "provider adapter is unavailable");
    }
    // Residency is enforced here, not merely recorded. Without this the
    // evidence record could claim a region the request never reached.
    if (!adapter.regions.includes(resolved.region)) {
      throw new ModelResolutionError(
        "ADAPTER_REGION_MISMATCH",
        "provider adapter does not serve the resolved region",
      );
    }
    await this.record(input, resolved, credential.origin, "complete");
    return adapter.complete({
      model: resolved.model,
      region: resolved.region,
      input: input.input,
      credential: credential.secret,
      ...(resolved.pin ? { pin: resolved.pin } : {}),
    });
  }

  stream(
    input: ResolveInput & { input: string; signal?: AbortSignal },
  ): AsyncGenerator<ModelStreamEvent> {
    return this.streamWithPolicy(input);
  }

  private streamWithPolicy(
    input: ResolveInput & { input: string; signal?: AbortSignal },
    prepared?: PreparedStreamGuard,
  ): AsyncGenerator<ModelStreamEvent> {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", forwardAbort, { once: true });

    const execution = this.executeStream(input, controller, prepared);
    let terminalDelivered = false;
    const removeForwarding = (): void => input.signal?.removeEventListener("abort", forwardAbort);
    const observe = (
      result: IteratorResult<ModelStreamEvent, void>,
    ): IteratorResult<ModelStreamEvent, void> => {
      if (result.done || result.value.type !== "content") {
        terminalDelivered = true;
        removeForwarding();
      }
      return result;
    };
    const iterator: AsyncGenerator<ModelStreamEvent> = {
      [Symbol.asyncIterator]: () => iterator,
      next: async (...args: [] | [unknown]) => {
        try {
          return observe(await execution.next(...args));
        } catch (error) {
          removeForwarding();
          throw error;
        }
      },
      return: async (value) => {
        if (!terminalDelivered) controller.abort();
        removeForwarding();
        return observe(await execution.return(value));
      },
      throw: async (error) => {
        if (!terminalDelivered) controller.abort();
        removeForwarding();
        if (terminalDelivered) {
          await execution.return(undefined);
          throw error;
        }
        return observe(await execution.throw(error));
      },
    };
    return iterator;
  }

  private async *executeStream(
    input: ResolveInput & { input: string; signal?: AbortSignal },
    controller: AbortController,
    prepared?: PreparedStreamGuard,
  ): AsyncGenerator<ModelStreamEvent> {
    const { tenantId, moduleId, useCase, slot } = input;
    await prepared?.claim();
    const resolved = prepared
      ? this.copyResolved(prepared.policy)
      : await this.resolvePolicy({ tenantId, moduleId, useCase, slot });
    if (!this.credentials) {
      throw new ModelResolutionError(
        "CREDENTIAL_BROKER_UNAVAILABLE",
        "a credential broker is required; refusing to call a provider unbrokered",
      );
    }
    const recordStreamTerminal = this.store.recordStreamTerminal?.bind(this.store);
    if (!recordStreamTerminal) {
      throw new ModelResolutionError(
        "AUDIT_RECORDING_FAILED",
        "stream terminal evidence storage is unavailable",
      );
    }
    const credential = await this.resolveCredential(tenantId, resolved.provider);
    if (!credential) {
      throw new ModelResolutionError("CREDENTIAL_UNAVAILABLE", "provider credential is unavailable");
    }
    const adapter = this.adapters.get(resolved.provider);
    if (!adapter?.stream) {
      throw new ModelResolutionError("ADAPTER_UNAVAILABLE", "streaming provider adapter is unavailable");
    }
    if (!adapter.regions.includes(resolved.region)) {
      throw new ModelResolutionError(
        "ADAPTER_REGION_MISMATCH",
        "provider adapter does not serve the resolved region",
      );
    }
    const resolutionId = `res_${randomUUID()}`;
    try {
      await this.record(input, resolved, credential.origin, "stream", resolutionId);
    } catch {
      throw new ModelResolutionError(
        "AUDIT_RECORDING_FAILED",
        "model attempt evidence could not be recorded",
      );
    }

    let iterator: AsyncIterator<string> | undefined;
    let terminalAttempted = false;
    const closeIterator = async (): Promise<void> => {
      if (!iterator?.return) return;
      const returnIterator = iterator.return.bind(iterator);
      iterator = undefined;
      try {
        await returnIterator();
      } catch {
        // Adapter cleanup errors cannot replace the safe terminal contract.
      }
    };
    const recordTerminal = async (
      record: { state: "completed" | "cancelled" } | { state: "failed"; failureCode: "ADAPTER_ERROR" },
    ): Promise<boolean> => {
      terminalAttempted = true;
      try {
        await recordStreamTerminal({ resolutionId, ...record });
        return true;
      } catch {
        return false;
      }
    };

    try {
      if (controller.signal.aborted) {
        if (await recordTerminal({ state: "cancelled" })) yield { type: "cancelled" };
        else yield { type: "failed", code: "AUDIT_ERROR" };
        return;
      }
      iterator = adapter.stream({
        model: resolved.model,
        region: resolved.region,
        input: input.input,
        credential: credential.secret,
        ...(resolved.pin ? { pin: resolved.pin } : {}),
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      while (true) {
        if (controller.signal.aborted) {
          await closeIterator();
          if (await recordTerminal({ state: "cancelled" })) yield { type: "cancelled" };
          else yield { type: "failed", code: "AUDIT_ERROR" };
          return;
        }
        const next = await iterator.next();
        if (controller.signal.aborted) {
          await closeIterator();
          if (await recordTerminal({ state: "cancelled" })) yield { type: "cancelled" };
          else yield { type: "failed", code: "AUDIT_ERROR" };
          return;
        }
        if (next.done) break;
        yield { type: "content", content: next.value };
      }
      if (await recordTerminal({ state: "completed" })) yield { type: "completed" };
      else yield { type: "failed", code: "AUDIT_ERROR" };
    } catch (error) {
      const cancelled = controller.signal.aborted;
      controller.abort();
      await closeIterator();
      if (terminalAttempted) throw error;
      if (cancelled) {
        if (await recordTerminal({ state: "cancelled" })) yield { type: "cancelled" };
        else yield { type: "failed", code: "AUDIT_ERROR" };
      } else if (await recordTerminal({ state: "failed", failureCode: "ADAPTER_ERROR" })) {
        yield { type: "failed", code: "ADAPTER_ERROR" };
      } else {
        yield { type: "failed", code: "AUDIT_ERROR" };
      }
    } finally {
      if (!terminalAttempted) {
        controller.abort();
        await closeIterator();
        await recordTerminal({ state: "cancelled" });
      }
    }
  }

  private async resolveAndRecord(
    input: ResolveInput,
    keyOrigin: CredentialOrigin,
    operationKind: ModelOperationKind,
  ): Promise<ResolvedModel> {
    const resolved = await this.resolvePolicy(input);
    await this.record(input, resolved, keyOrigin, operationKind);
    return resolved;
  }

  private copyResolved(resolved: ResolvedModel): ResolvedModel {
    return {
      ...resolved,
      ...(resolved.pin ? { pin: { ...resolved.pin } } : {}),
    };
  }

  private sameResolvedPolicy(left: ResolvedModel, right: ResolvedModel): boolean {
    return left.provider === right.provider
      && left.model === right.model
      && left.region === right.region
      && left.retentionPosture === right.retentionPosture
      && left.allowlistVersion === right.allowlistVersion
      && left.source === right.source
      && left.pin?.upstreamProvider === right.pin?.upstreamProvider
      && left.pin?.dataPolicy === right.pin?.dataPolicy;
  }

  private async resolvePolicy(input: ResolveInput): Promise<ResolvedModel> {
    try {
      return await this.resolveCandidate(input);
    } catch (error) {
      if (error instanceof ModelResolutionError) throw error;
      throw new ModelResolutionError(
        "POLICY_STORE_UNAVAILABLE",
        "model routing policy is unavailable",
      );
    }
  }

  private async resolveCredential(
    tenantId: TenantId,
    provider: string,
  ): Promise<{ origin: Exclude<CredentialOrigin, "none">; secret: string } | null> {
    try {
      return await this.credentials!.resolve(tenantId, provider);
    } catch {
      throw new ModelResolutionError(
        "CREDENTIAL_BROKER_FAILED",
        "provider credential lookup failed",
      );
    }
  }

  private async resolveCandidate(input: ResolveInput): Promise<ResolvedModel> {
    if (Object.hasOwn(input, "dataRegion")) {
      throw new ModelResolutionError(
        "CALLER_RESIDENCY_FORBIDDEN",
        "tenant residency must be loaded from the tenant record",
      );
    }
    const [tenant, allowlist, selection, defaults, consent, consentPolicyVersion] = await Promise.all([
      this.store.tenantPolicy(input.tenantId),
      this.store.allowlist(),
      this.store.tenantSelection(input.tenantId, input.moduleId, input.useCase),
      this.store.installationDefaults(input.useCase),
      this.store.activeCrossBorderConsent(input.tenantId),
      this.store.consentPolicyVersion(),
    ]);
    if (tenant.tenantId !== input.tenantId) {
      throw new ModelResolutionError("TENANT_POLICY_MISMATCH", "tenant policy scope mismatch");
    }

    const cascade: readonly [ModelResolutionSource, ModelRef | undefined][] = [
      ["tenant_module_use_case", selection.moduleUseCase?.[input.slot]],
      ["tenant_module_default", selection.moduleDefault?.[input.slot]],
      ["installation_use_case", defaults.byUseCase[input.slot]],
      ["installation_default", defaults.default?.[input.slot]],
      ["platform_default", defaults.platformDefault?.[input.slot]],
    ];
    const configured = cascade.find((candidate) => candidate[1] !== undefined);
    if (!configured?.[1]) {
      throw new ModelResolutionError("UNRESOLVABLE_SLOT", "no model is configured for this slot");
    }
    const [source, candidate] = configured;

    // The candidate must survive each policy layer in order. Failure is final:
    // policy must never select a different model than the configured cascade.
    const entry = allowlist.entries.find(
      (allowed) =>
        allowed.provider === candidate.provider && allowed.model === candidate.model,
    );
    if (!entry) {
      throw new ModelResolutionError("NOT_ALLOWLISTED", "configured model is not owner-allowlisted");
    }
    if (isRouterProvider(entry.provider)) {
      const pin = entry.pin;
      if (!pin || pin.upstreamProvider.trim() === "" || pin.dataPolicy.trim() === "") {
        throw new ModelResolutionError(
          "ROUTER_POLICY_UNPINNED",
          "router allowlist entry has no recorded upstream provider and data policy",
        );
      }
    } else if (entry.pin) {
      throw new ModelResolutionError(
        "ROUTER_POLICY_UNPINNED",
        "a non-router allowlist entry must not carry an upstream pin",
      );
    }
    if (entry.region !== tenant.dataRegion) {
      // The consent record is checked before it is trusted. 0018 stores
      // policy_version and nothing read it, so consent granted against an
      // earlier question kept authorising out-of-region traffic after the
      // question changed. Withdrawal semantics apply: the slot stops resolving
      // rather than falling back to an in-region model, per ADR-006 section 7.
      if (consent && consent.policyVersion !== consentPolicyVersion) {
        throw new ModelResolutionError(
          "CONSENT_POLICY_STALE",
          "cross-border consent was granted under a superseded consent policy",
        );
      }
      // A consent naming no pairs records that something was agreed without
      // recording what. 0019 refuses to store one; this refuses to act on one
      // that predates the constraint.
      if (consent && consent.pairs.length === 0) {
        throw new ModelResolutionError(
          "CONSENT_PAIRS_EMPTY",
          "cross-border consent records no provider and region pairs",
        );
      }
      const covered = consent?.pairs.some(
        (pair) =>
          pair.provider === entry.provider &&
          pair.region === entry.region &&
          pair.retentionPosture === entry.retentionPosture,
      );
      if (!covered) {
        throw new ModelResolutionError(
          "RESIDENCY_MISMATCH",
          "configured model is outside tenant residency without matching consent",
        );
      }
    }
    if (
      (allowlist.requireZeroRetention || tenant.requireZeroRetention) &&
      retaining(entry.retentionPosture)
    ) {
      throw new ModelResolutionError(
        "RETENTION_MISMATCH",
        "configured model does not satisfy zero-retention policy",
      );
    }
    return { ...entry, source, allowlistVersion: allowlist.version };
  }

  private async record(
    input: ResolveInput,
    resolved: ResolvedModel,
    keyOrigin: CredentialOrigin,
    operationKind: ModelOperationKind,
    resolutionId?: string,
  ): Promise<void> {
    try {
      await this.store.recordResolution({
        ...(resolutionId ? { resolutionId } : {}),
        operationKind,
        tenantId: input.tenantId,
        moduleId: input.moduleId,
        useCase: input.useCase,
        provider: resolved.provider,
        model: resolved.model,
        keyOrigin,
        regionServed: resolved.region,
        retentionPosture: resolved.retentionPosture,
        allowlistVersion: resolved.allowlistVersion,
      });
    } catch (error) {
      if (error instanceof ModelResolutionError) throw error;
      throw new ModelResolutionError(
        "AUDIT_RECORDING_FAILED",
        "model attempt evidence could not be recorded",
      );
    }
  }
}
