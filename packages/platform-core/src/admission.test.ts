import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  createInMemoryAdmissionAdapter,
  type AdmissionPolicy,
  type AdmissionRequest,
  type AdmissionScope,
} from "./admission";

const scope = (suffix = "a"): AdmissionScope => ({
  tenantId: `tenant-${suffix}`,
  principalId: `principal-${suffix}`,
  operation: "widgets.create",
});

const policy = (overrides: Partial<AdmissionPolicy> = {}): AdmissionPolicy => ({
  maxRequests: 10,
  windowMs: 100,
  maxConcurrent: 4,
  leaseMs: 20,
  idempotencyTtlMs: 200,
  maxIdempotencyEntriesPerScope: 10,
  maxSizeBytes: 100,
  ...overrides,
});

const request = (
  requestScope: AdmissionScope,
  key: string,
  overrides: Partial<AdmissionRequest> = {},
): AdmissionRequest => ({
  scope: requestScope,
  idempotencyKey: key,
  fingerprint: `fingerprint-${key}`,
  sizeBytes: 1,
  ...overrides,
});

const hexId = (value: number): string => value.toString(16).padStart(32, "0");

function harness(config: { now?: number; ids?: string[]; beforeCommit?: (r: AdmissionRequest) => Promise<void> } = {}) {
  let now = config.now ?? 0;
  let idCalls = 0;
  let hookCalls = 0;
  const ids = [...(config.ids ?? [])];
  const adapter = createInMemoryAdmissionAdapter({
    clock: { nowMs: async () => now },
    leaseIdFactory: {
      nextLeaseId: async () => {
        idCalls += 1;
        return ids.shift() ?? hexId(idCalls);
      },
    },
    beforeCommit: async (admissionRequest) => {
      hookCalls += 1;
      await config.beforeCommit?.(admissionRequest);
    },
  });
  return { adapter, setNow: (value: number) => (now = value), idCalls: () => idCalls, hookCalls: () => hookCalls };
}

async function admittedLease(decision: Awaited<ReturnType<ReturnType<typeof harness>["adapter"]["admit"]>>) {
  expect(decision.admitted).toBe(true);
  if (!decision.admitted) throw new Error("expected admission");
  return decision.lease;
}

async function yieldMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function loadModule(source: string): { createInMemoryAdmissionAdapter: typeof createInMemoryAdmissionAdapter } {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(output, { module, exports: module.exports, Object, Map, Promise, Number, Math });
  return module.exports as { createInMemoryAdmissionAdapter: typeof createInMemoryAdmissionAdapter };
}

describe("provider-neutral admission", () => {
  it("serializes interleaved admissions at the concurrency limit", async () => {
    let releaseBarrier: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => (releaseBarrier = resolve));
    const live = harness({ beforeCommit: async () => barrier });
    const requestScope = scope("race-live");
    const calls = [1, 2, 3].map((n) => live.adapter.admit(request(requestScope, `k${n}`), policy({ maxConcurrent: 2 })));
    await yieldMicrotasks();
    releaseBarrier();
    const results = await Promise.all(calls);
    expect(results.filter((result) => result.admitted)).toHaveLength(2);
    expect(results.filter((result) => !result.admitted)).toHaveLength(1);
    expect(results.find((result) => !result.admitted)).toEqual({ admitted: false, code: "concurrency_limited" });
    expect(live.adapter.snapshot(requestScope).activeLeaseCount).toBe(2);
    const leases = results.filter((result) => result.admitted).map((result) => result.admitted && result.lease.leaseId);
    expect(new Set(leases).size).toBe(2);
    expect(live.idCalls()).toBe(2);
    expect(live.hookCalls()).toBe(2);
    expect(live.adapter.snapshot(requestScope).windowCount).toBe(2);
  }, 2_000);

  it("replays only matching admitted decisions within the full scope", async () => {
    const h = harness();
    const firstScope = scope("replay-a");
    const first = await h.adapter.admit(request(firstScope, "same"), policy({ maxConcurrent: 1 }));
    const replay = await h.adapter.admit(request(firstScope, "same"), policy({ maxConcurrent: 1 }));
    const conflict = await h.adapter.admit(request(firstScope, "same", { fingerprint: "different" }), policy({ maxConcurrent: 1 }));
    const otherTenant = await h.adapter.admit(request(scope("replay-b"), "same"), policy({ maxConcurrent: 1 }));
    const otherPrincipalScope = { ...firstScope, principalId: "principal-replay-b" };
    const otherOperationScope = { ...firstScope, operation: "widgets.delete" };
    const otherPrincipal = await h.adapter.admit(
      request(otherPrincipalScope, "same"),
      policy({ maxConcurrent: 1 }),
    );
    const otherOperation = await h.adapter.admit(
      request(otherOperationScope, "same"),
      policy({ maxConcurrent: 1 }),
    );
    expect(first.admitted).toBe(true);
    expect(replay.admitted).toBe(true);
    expect(replay.admitted && replay.replayed).toBe(true);
    expect(replay.admitted && first.admitted && replay.lease.leaseId).toBe(first.admitted && first.lease.leaseId);
    expect(conflict).toEqual({ admitted: false, code: "idempotency_conflict" });
    expect(otherTenant.admitted).toBe(true);
    expect(otherPrincipal.admitted).toBe(true);
    expect(otherPrincipal.admitted && otherPrincipal.replayed).toBe(false);
    expect(otherPrincipal.admitted && otherPrincipal.lease.scope).toEqual(otherPrincipalScope);
    expect(otherOperation.admitted).toBe(true);
    expect(otherOperation.admitted && otherOperation.replayed).toBe(false);
    expect(otherOperation.admitted && otherOperation.lease.scope).toEqual(otherOperationScope);
    expect(h.adapter.snapshot(firstScope).windowCount).toBe(1);
    expect(h.adapter.snapshot(firstScope).activeLeaseCount).toBe(1);
    expect(h.adapter.snapshot(otherPrincipalScope).windowCount).toBe(1);
    expect(h.adapter.snapshot(otherOperationScope).windowCount).toBe(1);
  });

  it("uses half-open fixed windows and expires leases at the boundary", async () => {
    const h = harness({ now: 100 });
    const s = scope("window");
    const p = policy({ maxRequests: 2, maxConcurrent: 3 });
    const first = await h.adapter.admit(request(s, "one"), p);
    await h.adapter.admit(request(s, "two"), p);
    h.setNow(199);
    expect(await h.adapter.admit(request(s, "three"), p)).toEqual({ admitted: false, code: "rate_limited" });
    expect(h.adapter.snapshot(s).windowStartMs).toBe(100);
    expect(h.adapter.snapshot(s).windowCount).toBe(2);
    h.setNow(200);
    expect((await h.adapter.admit(request(s, "four"), p)).admitted).toBe(true);
    expect(h.adapter.snapshot(s).windowStartMs).toBe(200);
    expect(h.adapter.snapshot(s).windowCount).toBe(1);
    expect(first.admitted).toBe(true);
    expect(first.admitted && (await h.adapter.release({ scope: s, leaseId: first.lease.leaseId })).status).toBe("expired");
    expect(h.adapter.snapshot(s).activeLeaseCount).toBe(1);
  });

  it("honors inclusive request and size limits", async () => {
    const h = harness();
    const s = scope("inclusive");
    const p = policy({ maxRequests: 2, maxConcurrent: 2, maxSizeBytes: 1 });
    expect((await h.adapter.admit(request(s, "one", { sizeBytes: 1 }), p)).admitted).toBe(true);
    expect((await h.adapter.admit(request(s, "two", { sizeBytes: 1 }), p)).admitted).toBe(true);
    expect(await h.adapter.admit(request(s, "three", { sizeBytes: 1 }), p)).toEqual({ admitted: false, code: "rate_limited" });
    expect(h.adapter.snapshot(s).windowCount).toBe(2);
    expect(h.adapter.snapshot(s).activeLeaseCount).toBe(2);
    const zero = harness();
    expect((await zero.adapter.admit(request(scope("zero"), "zero", { sizeBytes: 0 }), policy({ maxSizeBytes: 0 }))).admitted).toBe(true);
    expect(await zero.adapter.admit(request(scope("zero"), "large", { sizeBytes: 1 }), policy({ maxSizeBytes: 0 }))).toEqual({ admitted: false, code: "size_exceeded" });
    expect(zero.adapter.snapshot(scope("zero")).windowCount).toBe(1);
  });

  it("rejects policy drift while live state is retained", async () => {
    const h = harness();
    const s = scope("policy");
    const a = policy({ maxRequests: 1, idempotencyTtlMs: 200 });
    const b = policy({ maxRequests: 2, idempotencyTtlMs: 201 });
    expect((await h.adapter.admit(request(s, "one"), a)).admitted).toBe(true);
    expect(await h.adapter.admit(request(s, "one"), b)).toEqual({ admitted: false, code: "invalid_request" });
    expect(h.adapter.snapshot(s).policy).toEqual(a);
    expect(h.adapter.snapshot(s).windowCount).toBe(1);
    h.setNow(199);
    expect(await h.adapter.admit(request(s, "two"), b)).toEqual({ admitted: false, code: "invalid_request" });
    h.setNow(200);
    expect((await h.adapter.admit(request(s, "two"), b)).admitted).toBe(true);
  });

  it("isolates monotonic clocks and lease identifiers by full scope", async () => {
    const h = harness({
      now: 10,
      ids: ["a".repeat(32), "a".repeat(32), "a".repeat(32), "b".repeat(32)],
    });
    const a = scope("clock-a");
    const otherPrincipal = { ...a, principalId: "principal-clock-b" };
    const otherOperation = { ...a, operation: "widgets.delete" };
    const first = await h.adapter.admit(request(a, "one"), policy());
    h.setNow(9);
    expect(await h.adapter.admit(request(a, "two"), policy())).toEqual({ admitted: false, code: "invalid_request" });
    expect((await h.adapter.admit(request(otherPrincipal, "one"), policy())).admitted).toBe(true);
    expect((await h.adapter.admit(request(otherOperation, "one"), policy())).admitted).toBe(true);
    h.setNow(10);
    expect((await h.adapter.admit(request(a, "two"), policy())).admitted).toBe(true);
    expect(first.admitted).toBe(true);
    expect(h.adapter.snapshot(a).windowCount).toBe(2);
    expect(h.adapter.snapshot(otherPrincipal).windowCount).toBe(1);
    expect(h.adapter.snapshot(otherOperation).windowCount).toBe(1);
    expect(h.idCalls()).toBe(4);
  });

  it("calls the lease-id factory only for otherwise eligible admissions", async () => {
    const collision = "c".repeat(32);
    const h = harness({ ids: [collision, collision] });
    const s = scope("factory");
    const p = policy({ maxSizeBytes: 0 });
    expect(await h.adapter.admit(request(s, "large", { sizeBytes: 1 }), p)).toEqual({ admitted: false, code: "size_exceeded" });
    const first = await h.adapter.admit(request(s, "one", { sizeBytes: 0 }), p);
    expect(h.idCalls()).toBe(1);
    expect(h.hookCalls()).toBe(1);
    expect(first.admitted).toBe(true);
    expect(first.admitted && (await h.adapter.release({ scope: s, leaseId: first.lease.leaseId })).status).toBe("released");
    expect(await h.adapter.admit(request(s, "two", { sizeBytes: 0 }), p)).toEqual({ admitted: false, code: "invalid_request" });
    expect(h.hookCalls()).toBe(1);
  });

  it("bounds retention without evicting live state", async () => {
    const h = harness();
    const s = scope("cap");
    const p = policy({ maxConcurrent: 3, maxIdempotencyEntriesPerScope: 2 });
    expect((await h.adapter.admit(request(s, "one"), p)).admitted).toBe(true);
    expect((await h.adapter.admit(request(s, "two"), p)).admitted).toBe(true);
    expect(await h.adapter.admit(request(s, "three"), p)).toEqual({ admitted: false, code: "idempotency_capacity" });
    expect(h.adapter.snapshot(s).retainedIdempotencyCount).toBe(2);
    expect(h.adapter.snapshot(s).retainedLeaseCount).toBe(2);
    expect(h.adapter.snapshot(s).activeLeaseCount).toBe(2);
    expect(h.idCalls()).toBe(2);
    expect(h.adapter.snapshot(s).windowCount).toBe(2);
  });

  it("returns typed no-ops for malformed and foreign release requests", async () => {
    const h = harness();
    const s = scope("release");
    const lease = await admittedLease(await h.adapter.admit(request(s, "one"), policy()));
    expect(await h.adapter.release({ scope: s, leaseId: "bad" })).toEqual({ status: "invalid_request" });
    expect(await h.adapter.release({ scope: s, leaseId: "f".repeat(32) })).toEqual({ status: "not_found" });
    expect(await h.adapter.release({ scope: scope("foreign"), leaseId: lease.leaseId })).toEqual({ status: "not_found" });
    expect(await h.adapter.release({ scope: s, leaseId: lease.leaseId })).toEqual({ status: "released" });
    h.setNow(20);
    expect(await h.adapter.release({ scope: s, leaseId: lease.leaseId })).toEqual({ status: "already_released" });
    expect(h.adapter.snapshot(s).activeLeaseCount).toBe(0);
    expect(h.adapter.snapshot(s).retainedIdempotencyCount).toBe(1);
    expect(h.adapter.snapshot(s).retainedLeaseCount).toBe(1);
  });

  it("rejects malformed inputs without mutation", async () => {
    const h = harness();
    const s = scope("malformed");
    expect(await h.adapter.admit(request({ ...s, tenantId: " tenant" }, "a"), policy())).toEqual({ admitted: false, code: "invalid_request" });
    expect(await h.adapter.admit(request(s, "a", { sizeBytes: -1 }), policy())).toEqual({ admitted: false, code: "invalid_request" });
    expect(await h.adapter.admit(request(s, "a"), policy({ maxRequests: 0 }))).toEqual({ admitted: false, code: "invalid_request" });
    expect(await h.adapter.admit(request(s, "a"), policy({ leaseMs: 201, idempotencyTtlMs: 200 }))).toEqual({ admitted: false, code: "invalid_request" });
    const throwingRequest = {
      scope: s,
      get idempotencyKey(): string {
        throw new Error("hostile request getter");
      },
      fingerprint: "fingerprint-throwing",
      sizeBytes: 1,
    } as AdmissionRequest;
    await expect(h.adapter.admit(throwingRequest, policy())).resolves.toEqual({
      admitted: false,
      code: "invalid_request",
    });
    let requestReads = 0;
    const changingRequest = {
      scope: s,
      get idempotencyKey(): string {
        requestReads += 1;
        return requestReads === 1 ? "changing-key" : " changing-key";
      },
      fingerprint: "fingerprint-changing",
      sizeBytes: 1,
    } as AdmissionRequest;
    const changingHarness = harness();
    expect((await changingHarness.adapter.admit(changingRequest, policy())).admitted).toBe(true);
    expect(requestReads).toBe(1);
    const capturedReplay = await changingHarness.adapter.admit(request(s, "changing-key", {
      fingerprint: "fingerprint-changing",
    }), policy());
    expect(capturedReplay.admitted && capturedReplay.replayed).toBe(true);
    expect(changingHarness.idCalls()).toBe(1);
    let policyReads = 0;
    const changingPolicy = {
      ...policy(),
      get maxRequests(): number {
        policyReads += 1;
        return policyReads === 1 ? 10 : 0;
      },
    } as AdmissionPolicy;
    const policyHarness = harness();
    expect((await policyHarness.adapter.admit(request(s, "changing-policy"), changingPolicy)).admitted).toBe(true);
    expect(policyReads).toBe(1);
    expect(policyHarness.adapter.snapshot(s).policy?.maxRequests).toBe(10);
    const throwingPolicy = {
      ...policy(),
      get maxRequests(): number {
        throw new Error("hostile policy getter");
      },
    } as AdmissionPolicy;
    await expect(h.adapter.admit(request(s, "throwing-policy"), throwingPolicy)).resolves.toEqual({
      admitted: false,
      code: "invalid_request",
    });
    const throwingRelease = {
      scope: s,
      get leaseId(): string {
        throw new Error("hostile release getter");
      },
    };
    await expect(h.adapter.release(throwingRelease)).resolves.toEqual({ status: "invalid_request" });
    const callerOwnedInvalidKey = { value: "not-a-string" };
    expect(await h.adapter.admit(request(s, "object-key", {
      idempotencyKey: callerOwnedInvalidKey as unknown as string,
    }), policy())).toEqual({ admitted: false, code: "invalid_request" });
    expect(Object.isFrozen(callerOwnedInvalidKey)).toBe(false);
    const overflow = harness({ now: Number.MAX_SAFE_INTEGER });
    expect(await overflow.adapter.admit(request(scope("overflow"), "overflow"), policy({ windowMs: 1, leaseMs: 1, idempotencyTtlMs: 1 }))).toEqual({
      admitted: false,
      code: "invalid_request",
    });
    expect(overflow.idCalls()).toBe(0);
    expect(overflow.adapter.snapshot(scope("overflow")).policy).toBeNull();
    expect(h.adapter.snapshot(s).windowCount).toBe(0);
    expect(h.idCalls()).toBe(0);
  });

  it("keeps denied idempotency keys out of retention", async () => {
    const h = harness();
    const s = scope("denied");
    const p = policy({ maxRequests: 1, maxConcurrent: 1 });
    expect((await h.adapter.admit(request(s, "one"), p)).admitted).toBe(true);
    expect(await h.adapter.admit(request(s, "rate"), p)).toEqual({ admitted: false, code: "rate_limited" });
    expect(h.adapter.snapshot(s).retainedIdempotencyCount).toBe(1);
    expect(h.adapter.snapshot(s).retainedLeaseCount).toBe(1);
    expect(h.adapter.snapshot(s).windowCount).toBe(1);
    expect(h.idCalls()).toBe(1);
  });

  it("cleans empty scope tails with compare-and-delete", async () => {
    let now = 0;
    let blockNextClock = false;
    let releaseClock: () => void = () => undefined;
    const clockBarrier = new Promise<void>((resolve) => (releaseClock = resolve));
    let arrivals = 0;
    let releaseCommit: () => void = () => undefined;
    const commitBarrier = new Promise<void>((resolve) => (releaseCommit = resolve));
    let gateCommits = false;
    const adapter = createInMemoryAdmissionAdapter({
      clock: {
        nowMs: async () => {
          if (blockNextClock) {
            blockNextClock = false;
            await clockBarrier;
          }
          return now;
        },
      },
      leaseIdFactory: { nextLeaseId: () => hexId(arrivals + 1) },
      beforeCommit: async () => {
        if (gateCommits) {
          arrivals += 1;
          await commitBarrier;
        }
      },
    });
    const s = scope("tails");
    const p = policy({ maxConcurrent: 1, windowMs: 10, leaseMs: 5, idempotencyTtlMs: 10 });
    const seed = await admittedLease(await adapter.admit(request(s, "seed"), p));
    expect(await adapter.release({ scope: s, leaseId: seed.leaseId })).toEqual({ status: "released" });
    now = 10;
    gateCommits = true;
    blockNextClock = true;
    const cleanup = adapter.release({ scope: s, leaseId: seed.leaseId });
    const second = adapter.admit(request(s, "second"), p);
    await yieldMicrotasks();
    expect(arrivals).toBe(0);
    releaseClock();
    expect(await cleanup).toEqual({ status: "not_found" });
    const third = adapter.admit(request(s, "third"), p);
    await yieldMicrotasks();
    expect(arrivals).toBe(1);
    releaseCommit();
    const results = await Promise.all([second, third]);
    expect(results.filter((result) => result.admitted)).toHaveLength(1);
    expect(results.find((result) => !result.admitted)).toEqual({ admitted: false, code: "concurrency_limited" });
    expect(adapter.snapshot(s).activeLeaseCount).toBe(1);
    expect(adapter.snapshot(s).windowCount).toBe(1);
  });

  it("mutation proof fails without serialization and fingerprint guards", async () => {
    const source = readFileSync(new URL("./admission.ts", import.meta.url), "utf8");
    const serializationToken = "return enqueueScopeOperation(scopeKey, operation);";
    const fingerprintToken = "existing.fingerprint === request.fingerprint";
    expect(source.split(serializationToken)).toHaveLength(2);
    expect(source.split(fingerprintToken)).toHaveLength(2);
    const concurrencyMutant = loadModule(source.replace(serializationToken, "return operation();"));
    let unblock: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => (unblock = resolve));
    let ids = 0;
    const mutant = concurrencyMutant.createInMemoryAdmissionAdapter({
      clock: { nowMs: () => 0 },
      leaseIdFactory: { nextLeaseId: () => hexId(++ids) },
      beforeCommit: async () => barrier,
    });
    const s = scope("mutant");
    const races = [mutant.admit(request(s, "one"), policy({ maxConcurrent: 1 })), mutant.admit(request(s, "two"), policy({ maxConcurrent: 1 }))];
    await yieldMicrotasks();
    unblock();
    const raceResults = await Promise.all(races);
    expect(raceResults.filter((result) => result.admitted)).toHaveLength(2);
    expect(mutant.snapshot(s).activeLeaseCount).toBe(2);
    expect(ids).toBe(2);
    const fingerprintMutant = loadModule(source.replace(fingerprintToken, "existing.fingerprint !== request.fingerprint"));
    const fingerprintAdapter = fingerprintMutant.createInMemoryAdmissionAdapter({ clock: { nowMs: () => 0 }, leaseIdFactory: { nextLeaseId: () => "d".repeat(32) } });
    expect((await fingerprintAdapter.admit(request(s, "same"), policy())).admitted).toBe(true);
    const mismatch = await fingerprintAdapter.admit(request(s, "same", { fingerprint: "mismatch" }), policy());
    expect(mismatch.admitted).toBe(true);
    expect(mismatch.admitted && mismatch.replayed).toBe(true);
  });

  it("deep-freezes returned decisions and snapshots", async () => {
    const h = harness();
    const inboundScope = scope("freeze");
    const inboundPolicy = policy();
    const inboundRequest = request(inboundScope, "one");
    const decision = await h.adapter.admit(inboundRequest, inboundPolicy);
    expect(Object.isFrozen(inboundRequest)).toBe(false);
    expect(Object.isFrozen(inboundScope)).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.admitted && Object.isFrozen(decision.lease)).toBe(true);
    expect(decision.admitted && Object.isFrozen(decision.lease.scope)).toBe(true);
    expect(decision.admitted && Object.isFrozen(decision.lease.policy)).toBe(true);
    inboundScope.tenantId = "mutated-tenant";
    inboundPolicy.maxRequests = 1;
    inboundRequest.idempotencyKey = "mutated-key";
    const replay = await h.adapter.admit(request(scope("freeze"), "one"), policy());
    expect(replay.admitted && replay.replayed).toBe(true);
    expect(replay.admitted && decision.admitted && replay.lease.leaseId).toBe(decision.admitted && decision.lease.leaseId);
    if (decision.admitted) {
      expect(() => {
        decision.lease.scope.tenantId = "mutated-return";
      }).toThrow(TypeError);
    }
    const snapshot = h.adapter.snapshot(inboundScope);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.scope)).toBe(true);
    const retained = h.adapter.snapshot(scope("freeze"));
    expect(retained.policy && Object.isFrozen(retained.policy)).toBe(true);
    expect(retained.windowCount).toBe(1);
    expect(retained.policy?.maxRequests).toBe(10);
  });
});
