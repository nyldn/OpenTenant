/**
 * Admission evidence is neither an exact usage ledger nor authorization.
 * Composition must bind scope, clock, and identifiers on the server side.
 */

export interface AdmissionScope {
  tenantId: string;
  principalId: string;
  operation: string;
}

export interface AdmissionRequest {
  scope: AdmissionScope;
  idempotencyKey: string;
  fingerprint: string;
  sizeBytes: number;
}

export interface AdmissionPolicy {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  leaseMs: number;
  idempotencyTtlMs: number;
  maxIdempotencyEntriesPerScope: number;
  maxSizeBytes: number;
}

export type AdmissionDenialCode =
  | "invalid_request"
  | "idempotency_conflict"
  | "idempotency_capacity"
  | "size_exceeded"
  | "rate_limited"
  | "concurrency_limited";

export interface AdmissionLease {
  leaseId: string;
  scope: AdmissionScope;
  admittedAtMs: number;
  expiresAtMs: number;
  policy: AdmissionPolicy;
}

export type AdmissionDecision =
  | { admitted: true; replayed: boolean; lease: AdmissionLease }
  | { admitted: false; code: AdmissionDenialCode };

export interface AdmissionReleaseRequest {
  scope: AdmissionScope;
  leaseId: string;
}

export interface AdmissionReleaseResult {
  status: "released" | "already_released" | "expired" | "not_found" | "invalid_request";
}

export interface AdmissionClock {
  nowMs(): number | Promise<number>;
}

export interface AdmissionLeaseIdFactory {
  nextLeaseId(): string | Promise<string>;
}

export interface AdmissionAdapter {
  admit(request: AdmissionRequest, policy: AdmissionPolicy): Promise<AdmissionDecision>;
  release(request: AdmissionReleaseRequest): Promise<AdmissionReleaseResult>;
}

export interface InMemoryAdmissionAdapterOptions {
  clock: AdmissionClock;
  leaseIdFactory: AdmissionLeaseIdFactory;
  beforeCommit?: (request: AdmissionRequest) => void | Promise<void>;
}

export interface AdmissionSnapshot {
  scope: AdmissionScope;
  policy: AdmissionPolicy | null;
  windowStartMs: number | null;
  windowCount: number;
  activeLeaseCount: number;
  retainedIdempotencyCount: number;
  retainedLeaseCount: number;
}

export interface InMemoryAdmissionAdapter extends AdmissionAdapter {
  snapshot(scope: AdmissionScope): AdmissionSnapshot;
}

type LeaseStatus = "active" | "released" | "expired";

interface RetainedLease {
  lease: AdmissionLease;
  status: LeaseStatus;
  retainedUntilMs: number;
}

interface IdempotencyRecord {
  fingerprint: string;
  lease: AdmissionLease;
  retainedUntilMs: number;
}

interface ScopeState {
  scope: AdmissionScope;
  policy: AdmissionPolicy | null;
  windowStartMs: number | null;
  windowCount: number;
  activeLeaseCount: number;
  idempotency: Map<string, IdempotencyRecord>;
  leases: Map<string, RetainedLease>;
  lastObservedMs: number | null;
}

const leaseIdPattern = /^[0-9a-f]{32}$/;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function copyScope(scope: AdmissionScope): AdmissionScope {
  return deepFreeze({
    tenantId: scope.tenantId,
    principalId: scope.principalId,
    operation: scope.operation,
  });
}

function copyPolicy(policy: AdmissionPolicy): AdmissionPolicy {
  return deepFreeze({
    maxRequests: policy.maxRequests,
    windowMs: policy.windowMs,
    maxConcurrent: policy.maxConcurrent,
    leaseMs: policy.leaseMs,
    idempotencyTtlMs: policy.idempotencyTtlMs,
    maxIdempotencyEntriesPerScope: policy.maxIdempotencyEntriesPerScope,
    maxSizeBytes: policy.maxSizeBytes,
  });
}

function copyRequest(request: AdmissionRequest): AdmissionRequest {
  return deepFreeze({
    scope: copyScope(request.scope),
    idempotencyKey: request.idempotencyKey,
    fingerprint: request.fingerprint,
    sizeBytes: request.sizeBytes,
  });
}

function copyLease(lease: AdmissionLease): AdmissionLease {
  return deepFreeze({
    leaseId: lease.leaseId,
    scope: copyScope(lease.scope),
    admittedAtMs: lease.admittedAtMs,
    expiresAtMs: lease.expiresAtMs,
    policy: copyPolicy(lease.policy),
  });
}

function denied(code: AdmissionDenialCode): AdmissionDecision {
  return deepFreeze({ admitted: false, code });
}

function releaseResult(status: AdmissionReleaseResult["status"]): AdmissionReleaseResult {
  return deepFreeze({ status });
}

function admitted(lease: AdmissionLease, replayed: boolean): AdmissionDecision {
  return deepFreeze({ admitted: true, replayed, lease: copyLease(lease) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isBoundedPrintable(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value !== value.trim()) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint > 0x7e) {
      return false;
    }
  }
  return true;
}

function isScope(value: unknown): value is AdmissionScope {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["tenantId", "principalId", "operation"]) &&
    isBoundedPrintable(value.tenantId) &&
    isBoundedPrintable(value.principalId) &&
    isBoundedPrintable(value.operation)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function isRequest(value: unknown): value is AdmissionRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["scope", "idempotencyKey", "fingerprint", "sizeBytes"]) &&
    isScope(value.scope) &&
    isBoundedPrintable(value.idempotencyKey) &&
    isBoundedPrintable(value.fingerprint) &&
    isNonNegativeSafeInteger(value.sizeBytes)
  );
}

function isPolicy(value: unknown): value is AdmissionPolicy {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "maxRequests",
      "windowMs",
      "maxConcurrent",
      "leaseMs",
      "idempotencyTtlMs",
      "maxIdempotencyEntriesPerScope",
      "maxSizeBytes",
    ])
  ) {
    return false;
  }
  return (
    isPositiveSafeInteger(value.maxRequests) &&
    isPositiveSafeInteger(value.windowMs) &&
    isPositiveSafeInteger(value.maxConcurrent) &&
    isPositiveSafeInteger(value.leaseMs) &&
    isPositiveSafeInteger(value.idempotencyTtlMs) &&
    isPositiveSafeInteger(value.maxIdempotencyEntriesPerScope) &&
    isNonNegativeSafeInteger(value.maxSizeBytes) &&
    value.idempotencyTtlMs >= value.leaseMs
  );
}

function isReleaseRequest(value: unknown): value is AdmissionReleaseRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["scope", "leaseId"]) &&
    isScope(value.scope) &&
    typeof value.leaseId === "string" &&
    value.leaseId === value.leaseId.trim() &&
    leaseIdPattern.test(value.leaseId)
  );
}

function captureScope(value: unknown): AdmissionScope | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ["tenantId", "principalId", "operation"])) {
      return null;
    }
    const captured = {
      tenantId: value.tenantId,
      principalId: value.principalId,
      operation: value.operation,
    };
    return isScope(captured) ? deepFreeze(captured) : null;
  } catch {
    return null;
  }
}

function captureRequest(value: unknown): AdmissionRequest | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ["scope", "idempotencyKey", "fingerprint", "sizeBytes"])) {
      return null;
    }
    const scope = captureScope(value.scope);
    if (!scope) return null;
    const captured = {
      scope,
      idempotencyKey: value.idempotencyKey,
      fingerprint: value.fingerprint,
      sizeBytes: value.sizeBytes,
    };
    return isRequest(captured) ? deepFreeze(captured) : null;
  } catch {
    return null;
  }
}

function capturePolicy(value: unknown): AdmissionPolicy | null {
  try {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "maxRequests",
        "windowMs",
        "maxConcurrent",
        "leaseMs",
        "idempotencyTtlMs",
        "maxIdempotencyEntriesPerScope",
        "maxSizeBytes",
      ])
    ) {
      return null;
    }
    const captured = {
      maxRequests: value.maxRequests,
      windowMs: value.windowMs,
      maxConcurrent: value.maxConcurrent,
      leaseMs: value.leaseMs,
      idempotencyTtlMs: value.idempotencyTtlMs,
      maxIdempotencyEntriesPerScope: value.maxIdempotencyEntriesPerScope,
      maxSizeBytes: value.maxSizeBytes,
    };
    return isPolicy(captured) ? deepFreeze(captured) : null;
  } catch {
    return null;
  }
}

function captureReleaseRequest(value: unknown): AdmissionReleaseRequest | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ["scope", "leaseId"])) return null;
    const scope = captureScope(value.scope);
    if (!scope) return null;
    const captured = { scope, leaseId: value.leaseId };
    return isReleaseRequest(captured) ? deepFreeze(captured) : null;
  } catch {
    return null;
  }
}

function addSafeIntegers(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function scopeKeyOf(scope: AdmissionScope): string {
  return `${scope.tenantId.length}:${scope.tenantId}${scope.principalId.length}:${scope.principalId}${scope.operation.length}:${scope.operation}`;
}

function policiesEqual(left: AdmissionPolicy, right: AdmissionPolicy): boolean {
  return (
    left.maxRequests === right.maxRequests &&
    left.windowMs === right.windowMs &&
    left.maxConcurrent === right.maxConcurrent &&
    left.leaseMs === right.leaseMs &&
    left.idempotencyTtlMs === right.idempotencyTtlMs &&
    left.maxIdempotencyEntriesPerScope === right.maxIdempotencyEntriesPerScope &&
    left.maxSizeBytes === right.maxSizeBytes
  );
}

function newState(scope: AdmissionScope): ScopeState {
  return {
    scope,
    policy: null,
    windowStartMs: null,
    windowCount: 0,
    activeLeaseCount: 0,
    idempotency: new Map(),
    leases: new Map(),
    lastObservedMs: null,
  };
}

function stateIsEmpty(state: ScopeState): boolean {
  return state.windowStartMs === null && state.idempotency.size === 0 && state.leases.size === 0;
}

export function createInMemoryAdmissionAdapter(
  options: InMemoryAdmissionAdapterOptions,
): InMemoryAdmissionAdapter {
  const states = new Map<string, ScopeState>();
  const scopeTails = new Map<string, Promise<void>>();
  const clock = options.clock;
  const leaseIdFactory = options.leaseIdFactory;
  const beforeCommit = options.beforeCommit ?? (() => undefined);

  const enqueueScopeOperation = <T>(scopeKey: string, operation: () => Promise<T>): Promise<T> => {
    const previous = scopeTails.get(scopeKey) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    scopeTails.set(scopeKey, tail);
    void tail.then(() => {
      if (scopeTails.get(scopeKey) === tail) {
        scopeTails.delete(scopeKey);
      }
    });
    return result;
  };

  const serializeScopeOperation = <T>(
    scopeKey: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    return enqueueScopeOperation(scopeKey, operation);
  };

  const reclaim = (state: ScopeState, nowMs: number): void => {
    const epoch = state.policy;
    if (epoch && state.windowStartMs !== null && nowMs >= state.windowStartMs + epoch.windowMs) {
      state.windowStartMs = null;
      state.windowCount = 0;
    }
    for (const retained of state.leases.values()) {
      if (retained.status === "active" && nowMs >= retained.lease.expiresAtMs) {
        retained.status = "expired";
        state.activeLeaseCount = Math.max(0, state.activeLeaseCount - 1);
      }
    }
    for (const [key, record] of state.idempotency) {
      if (nowMs >= record.retainedUntilMs) {
        state.idempotency.delete(key);
      }
    }
    for (const [leaseId, retained] of state.leases) {
      if (nowMs >= retained.retainedUntilMs) {
        state.leases.delete(leaseId);
      }
    }
    if (stateIsEmpty(state)) {
      state.policy = null;
    }
  };

  const readClock = async (state: ScopeState): Promise<number | null> => {
    let observed: unknown;
    try {
      observed = await clock.nowMs();
    } catch {
      return null;
    }
    if (
      typeof observed !== "number" ||
      !Number.isSafeInteger(observed) ||
      observed < 0 ||
      (state.lastObservedMs !== null && observed < state.lastObservedMs)
    ) {
      return null;
    }
    state.lastObservedMs = observed;
    return observed;
  };

  const admitOperation = async (
    scopeKey: string,
    request: AdmissionRequest,
    policy: AdmissionPolicy,
  ): Promise<AdmissionDecision> => {
    let state = states.get(scopeKey);
    if (!state) {
      state = newState(request.scope);
      states.set(scopeKey, state);
    }
    const nowMs = await readClock(state);
    if (nowMs === null) {
      if (stateIsEmpty(state)) states.delete(scopeKey);
      return denied("invalid_request");
    }
    reclaim(state, nowMs);
    const denyAdmission = (code: AdmissionDenialCode): AdmissionDecision => {
      if (stateIsEmpty(state)) states.delete(scopeKey);
      return denied(code);
    };
    if (state.policy && !policiesEqual(state.policy, policy)) {
      return denyAdmission("invalid_request");
    }
    const existing = state.idempotency.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint === request.fingerprint) {
        return admitted(existing.lease, true);
      }
      return denyAdmission("idempotency_conflict");
    }
    if (request.sizeBytes > policy.maxSizeBytes) return denyAdmission("size_exceeded");
    if (state.idempotency.size >= policy.maxIdempotencyEntriesPerScope) {
      return denyAdmission("idempotency_capacity");
    }
    const windowStartMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs;
    if (!Number.isSafeInteger(windowStartMs)) return denyAdmission("invalid_request");
    const windowCount = state.windowStartMs === windowStartMs ? state.windowCount : 0;
    if (windowCount >= policy.maxRequests) return denyAdmission("rate_limited");
    if (state.activeLeaseCount >= policy.maxConcurrent) return denyAdmission("concurrency_limited");
    const windowEndMs = addSafeIntegers(windowStartMs, policy.windowMs);
    const expiresAtMs = addSafeIntegers(nowMs, policy.leaseMs);
    const retainedUntilMs = addSafeIntegers(nowMs, policy.idempotencyTtlMs);
    if (windowEndMs === null || expiresAtMs === null || retainedUntilMs === null) {
      return denyAdmission("invalid_request");
    }

    let leaseId: unknown;
    try {
      leaseId = await leaseIdFactory.nextLeaseId();
    } catch {
      return denyAdmission("invalid_request");
    }
    if (typeof leaseId !== "string" || !leaseIdPattern.test(leaseId) || state.leases.has(leaseId)) {
      return denyAdmission("invalid_request");
    }
    try {
      await beforeCommit(copyRequest(request));
    } catch {
      return denyAdmission("invalid_request");
    }

    const epoch = state.policy ?? policy;
    const lease = deepFreeze({
      leaseId,
      scope: copyScope(request.scope),
      admittedAtMs: nowMs,
      expiresAtMs,
      policy: copyPolicy(epoch),
    });
    state.policy = epoch;
    state.scope = request.scope;
    state.windowStartMs = windowStartMs;
    state.windowCount = windowCount + 1;
    state.activeLeaseCount += 1;
    state.idempotency.set(request.idempotencyKey, {
      fingerprint: request.fingerprint,
      lease,
      retainedUntilMs,
    });
    state.leases.set(leaseId, { lease, status: "active", retainedUntilMs });
    return admitted(lease, false);
  };

  const releaseOperation = async (
    scopeKey: string,
    request: AdmissionReleaseRequest,
  ): Promise<AdmissionReleaseResult> => {
    let state = states.get(scopeKey);
    if (!state) {
      state = newState(request.scope);
      states.set(scopeKey, state);
    }
    const nowMs = await readClock(state);
    if (nowMs === null) {
      if (stateIsEmpty(state)) states.delete(scopeKey);
      return releaseResult("invalid_request");
    }
    reclaim(state, nowMs);
    const retained = state.leases.get(request.leaseId);
    if (!retained) {
      if (stateIsEmpty(state)) states.delete(scopeKey);
      return releaseResult("not_found");
    }
    if (retained.status === "released") return releaseResult("already_released");
    if (retained.status === "expired") return releaseResult("expired");
    retained.status = "released";
    state.activeLeaseCount = Math.max(0, state.activeLeaseCount - 1);
    return releaseResult("released");
  };

  return {
    async admit(rawRequest: AdmissionRequest, rawPolicy: AdmissionPolicy): Promise<AdmissionDecision> {
      const request = captureRequest(rawRequest);
      const policy = capturePolicy(rawPolicy);
      if (!request || !policy) return denied("invalid_request");
      const scopeKey = scopeKeyOf(request.scope);
      return serializeScopeOperation(scopeKey, () => admitOperation(scopeKey, request, policy));
    },

    async release(rawRequest: AdmissionReleaseRequest): Promise<AdmissionReleaseResult> {
      const request = captureReleaseRequest(rawRequest);
      if (!request) return releaseResult("invalid_request");
      const scopeKey = scopeKeyOf(request.scope);
      return serializeScopeOperation(scopeKey, () => releaseOperation(scopeKey, request));
    },

    snapshot(rawScope: AdmissionScope): AdmissionSnapshot {
      const capturedScope = captureScope(rawScope);
      const scope = capturedScope ?? deepFreeze({ tenantId: "", principalId: "", operation: "" });
      const state = capturedScope ? states.get(scopeKeyOf(capturedScope)) : undefined;
      return deepFreeze({
        scope,
        policy: state?.policy ? copyPolicy(state.policy) : null,
        windowStartMs: state?.windowStartMs ?? null,
        windowCount: state?.windowCount ?? 0,
        activeLeaseCount: state?.activeLeaseCount ?? 0,
        retainedIdempotencyCount: state?.idempotency.size ?? 0,
        retainedLeaseCount: state?.leases.size ?? 0,
      });
    },
  };
}
