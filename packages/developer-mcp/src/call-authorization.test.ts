import { describe, expect, it, vi } from "vitest";

import {
  DEVELOPER_TOOL_DESCRIPTORS,
  MAX_AUTHORITY_STALENESS_MS,
  assertDeveloperMcpAuditRecord,
  authorizeDeveloperMcpCall,
  createInMemoryDeveloperMcpAuditAppendAdapter,
  createLocalDeveloperMcpResourceAuthorizationAdapter,
  type DeveloperMcpCallAuthorizationInput,
  type DeveloperMcpCallDenialCode,
  type DeveloperMcpAuditDecisionCode,
  type DeveloperMcpResourceAuthorizationAdapter,
  type DeveloperMcpRevocationAdapter,
  type DeveloperMcpAuditAppendAdapter,
} from "./index";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
  : false;
const denialCodeEquality: Equal<DeveloperMcpCallDenialCode, Exclude<DeveloperMcpAuditDecisionCode, "allowed">> = true;
void denialCodeEquality;

const NOW = 2_000_000;
const PROJECT = "11111111111111111111111111111111";
const WORKSPACE = "22222222222222222222222222222222";
const OTHER = "33333333333333333333333333333333";

const principal = Object.freeze({ tenantId: "tenant_example", userId: "user_example", clientId: "client_example" });
const authoritySource = Object.freeze({
  assignedProfile: "developer.builder@1",
  tokenScopes: Object.freeze([
    "module.dev.workspace.read", "module.dev.contract.read", "module.dev.evidence.read",
    "module.dev.workspace.create", "module.dev.workspace.lifecycle", "module.dev.build.execute",
    "module.dev.preview.open",
  ]),
  consentedClientScopes: Object.freeze([
    "module.dev.workspace.read", "module.dev.contract.read", "module.dev.evidence.read",
    "module.dev.workspace.create", "module.dev.workspace.lifecycle", "module.dev.build.execute",
    "module.dev.preview.open",
  ]),
  resolvedAtMs: NOW,
});

function adapters(options: { revoked?: boolean; source?: "live" | "cache"; checkedAtMs?: number } = {}) {
  const calls: string[] = [];
  const revocation: DeveloperMcpRevocationAdapter = {
    revalidate: vi.fn(({ mode }) => {
      calls.push(`revocation:${mode}`);
      return options.revoked
        ? { status: "revoked" as const }
        : { status: "active" as const, checkedAtMs: options.checkedAtMs ?? NOW, source: options.source ?? "live" };
    }),
  };
  const resource: DeveloperMcpResourceAuthorizationAdapter = {
    authorize: vi.fn(() => {
      calls.push("resource");
      return { status: "allowed" as const };
    }),
  };
  return { revocation, resource, calls };
}

function input(overrides: Partial<DeveloperMcpCallAuthorizationInput> = {}): DeveloperMcpCallAuthorizationInput {
  const ports = adapters();
  return {
    toolName: "workspace.get",
    authoritySource,
    principal,
    resource: { resourceType: "module_workspace", resourceId: WORKSPACE },
    nowMs: NOW,
    revocationAdapter: ports.revocation,
    resourceAuthorizationAdapter: ports.resource,
    auditAppendAdapter: createInMemoryDeveloperMcpAuditAppendAdapter(),
    ...overrides,
  };
}

describe("authorizeDeveloperMcpCall", () => {
  it("appends exactly one validated pre-execution record for every typed decision code", async () => {
    const denialCases = {
      invalid_context: () => input({ authoritySource: { ...authoritySource, resolvedAtMs: Number.NaN } }),
      unknown_tool: () => input({ toolName: "workspace.unknown" }),
      authority_missing: () => input({ authoritySource: { ...authoritySource, consentedClientScopes: [] } }),
      resource_denied: () => input({ resourceAuthorizationAdapter: { authorize: () => ({ status: "denied" }) } }),
      revoked: () => input({ revocationAdapter: { revalidate: () => ({ status: "revoked" }) } }),
    } satisfies Record<DeveloperMcpCallDenialCode, () => DeveloperMcpCallAuthorizationInput>;
    for (const [code, makeInput] of Object.entries(denialCases)) {
      const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
      await expect(authorizeDeveloperMcpCall({ ...makeInput(), auditAppendAdapter: adapter })).resolves.toEqual({ status: "denied", code });
      expect(adapter.records).toHaveLength(1);
      expect(assertDeveloperMcpAuditRecord(adapter.records[0])).toEqual(adapter.records[0]);
      expect(adapter.records[0]).toMatchObject({ authorizationDecision: "deny", outcome: "denied" });
    }
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: adapter }))).resolves.toMatchObject({ status: "allowed" });
    expect(adapter.records).toHaveLength(1);
    expect(adapter.records[0]).toMatchObject({ authorizationDecision: "allow", outcome: "authorized", profileVersion: "developer.builder@1" });
  });

  it("generates fresh lowercase UUIDv4 correlation ids inside the boundary", async () => {
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const caller = { clientId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", tenantId: "33333333-3333-4333-8333-333333333333" };
    const assignedProfile = "44444444-4444-4444-8444-444444444444";
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    const candidate = input({ principal: caller, authoritySource: { ...authoritySource, assignedProfile }, auditAppendAdapter: adapter });
    await authorizeDeveloperMcpCall(candidate);
    await authorizeDeveloperMcpCall(candidate);
    const ids = adapter.records.map((record) => record.correlationId);
    expect(ids).toEqual([expect.stringMatching(uuidV4), expect.stringMatching(uuidV4)]);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect([caller.clientId, caller.userId, caller.tenantId, assignedProfile]).not.toContain(id);
    const hostile = createInMemoryDeveloperMcpAuditAppendAdapter();
    await expect(authorizeDeveloperMcpCall({ ...input(), correlationId: caller.clientId, auditAppendAdapter: hostile } as never))
      .resolves.toEqual({ status: "denied", code: "invalid_context" });
    expect(hostile.records[0]).toMatchObject({ contextResolution: "unresolved", correlationId: expect.stringMatching(uuidV4) });
  });

  it("preserves only identity established at each denial stage", async () => {
    const cases = [
      [{ ...input(), extra: true }, "unresolved", "invalid_context", "not_required"],
      [input({ authoritySource: { ...authoritySource, extra: true } as never }), "unresolved", "invalid_context", "not_required"],
      [input({ authoritySource: { ...authoritySource, resolvedAtMs: NOW + 1 } }), "principal", "invalid_context", "not_required"],
      [input({ authoritySource: { ...authoritySource, resolvedAtMs: Number.NaN } }), "principal", "invalid_context", "not_required"],
      [input({ toolName: "workspace.unknown" }), "principal", "unknown_tool", "not_required"],
      [input({ authoritySource: { ...authoritySource, resolvedAtMs: NOW - MAX_AUTHORITY_STALENESS_MS - 1 } }), "principal", "authority_missing", "not_required"],
      [input({ authoritySource: { ...authoritySource, consentedClientScopes: [] } }), "complete", "authority_missing", "not_required"],
      [input({ resource: { resourceType: "module_project", resourceId: PROJECT } }), "complete", "resource_denied", "not_required"],
      [input({ resourceAuthorizationAdapter: { authorize: () => ({ status: "denied" }) } }), "complete", "resource_denied", "passed"],
      [input({ revocationAdapter: { revalidate: () => ({ status: "revoked" }) } }), "complete", "revoked", "failed"],
    ] as const;
    const resourceChecks = [];
    for (const [candidate, contextResolution, decisionCode, revocationCheckResult] of cases) {
      const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
      await expect(authorizeDeveloperMcpCall({ ...candidate, auditAppendAdapter: adapter } as never)).resolves.toMatchObject({ status: "denied" });
      const record = assertDeveloperMcpAuditRecord(adapter.records[0]);
      expect(record).toMatchObject({ contextResolution, decisionCode, revocationCheckResult });
      if (contextResolution === "unresolved") expect(record).toMatchObject({ clientId: null, userId: null, tenantId: null, resourceId: null });
      else expect(record).toMatchObject({ ...principal, ...candidate.resource });
      if (contextResolution === "complete" && decisionCode === "authority_missing") {
        expect(record.profileVersion).toBe("developer.builder@1");
      }
      if (decisionCode === "resource_denied") resourceChecks.push(record.revocationCheckResult);
    }
    expect(resourceChecks).toEqual(["not_required", "passed"]);
  });

  it("validates the audit sink without invoking accessors and accepts class adapters", async () => {
    class ClassAdapter implements DeveloperMcpAuditAppendAdapter {
      readonly delegate = createInMemoryDeveloperMcpAuditAppendAdapter();
      async append(record: Parameters<DeveloperMcpAuditAppendAdapter["append"]>[0]) { return this.delegate.append(record); }
    }
    const classAdapter = new ClassAdapter();
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: classAdapter }))).resolves.toMatchObject({ status: "allowed" });
    expect(classAdapter.delegate.records).toHaveLength(1);

    let topGetterCalls = 0;
    const top = Object.defineProperty({ ...input() }, "auditAppendAdapter", { enumerable: true, get() { topGetterCalls += 1; return classAdapter; } });
    await expect(authorizeDeveloperMcpCall(top as never)).rejects.toThrow(TypeError);
    expect(topGetterCalls).toBe(0);
    let appendGetterCalls = 0;
    const unsafe = Object.defineProperty({}, "append", { get() { appendGetterCalls += 1; return classAdapter.append; } });
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: unsafe as never }))).rejects.toThrow(TypeError);
    expect(appendGetterCalls).toBe(0);
    await expect(authorizeDeveloperMcpCall(null as never)).rejects.toThrow(TypeError);
    await expect(authorizeDeveloperMcpCall({ ...input(), auditAppendAdapter: undefined } as never)).rejects.toThrow(TypeError);
  });

  it("awaits the single append before publishing a decision and propagates append rejection", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const delegate = createInMemoryDeveloperMcpAuditAppendAdapter();
    let appendCount = 0;
    const deferred: DeveloperMcpAuditAppendAdapter = {
      append: async (record) => {
        appendCount += 1;
        markStarted();
        await gate;
        return delegate.append(record);
      },
    };
    let state = "pending";
    const decision = authorizeDeveloperMcpCall(input({ auditAppendAdapter: deferred })).then((value) => { state = "resolved"; return value; });
    await started;
    expect(state).toBe("pending");
    expect(appendCount).toBe(1);
    release();
    await expect(decision).resolves.toMatchObject({ status: "allowed" });
    const failure = new Error("append failed");
    const rejecting = { append: async () => { throw failure; } };
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: rejecting }))).rejects.toBe(failure);
    await expect(authorizeDeveloperMcpCall(input({ toolName: "workspace.unknown", auditAppendAdapter: rejecting }))).rejects.toBe(failure);
    const missingEvidence: DeveloperMcpAuditAppendAdapter = { append: async () => undefined as never };
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: missingEvidence }))).rejects.toThrow(TypeError);
    const wrongDelegate = createInMemoryDeveloperMcpAuditAppendAdapter();
    const mismatched: DeveloperMcpAuditAppendAdapter = {
      append: (record) => wrongDelegate.append({
        ...record,
        correlationId: "00000000-0000-4000-8000-000000000099",
      }),
    };
    await expect(authorizeDeveloperMcpCall(input({ auditAppendAdapter: mismatched }))).rejects.toThrow(TypeError);
  });

  it("serializes racing decisions without permitting both calls to fail", async () => {
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    const settled = await Promise.all([input({ auditAppendAdapter: adapter }), input({ auditAppendAdapter: adapter })].map((candidate) =>
      authorizeDeveloperMcpCall(candidate).then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }))));
    const successes = settled.filter((result) => result.status === "fulfilled");
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(successes).toHaveLength(adapter.records.length);
    if (successes.length === 2) expect(adapter.records[1]!.priorDigest).toBe(adapter.records[0]!.currentDigest);
    else expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("derives every tool's slug, risk, and resource type from the frozen descriptor", async () => {
    for (const descriptor of DEVELOPER_TOOL_DESCRIPTORS) {
      const ports = adapters();
      const result = await authorizeDeveloperMcpCall(input({
        toolName: descriptor.name,
        resource: { resourceType: descriptor.resourceType, resourceId: PROJECT },
        revocationAdapter: ports.revocation,
        resourceAuthorizationAdapter: ports.resource,
      }));
      expect(result).toMatchObject({ status: "allowed", toolName: descriptor.name, slug: descriptor.slug, risk: descriptor.risk, resourceType: descriptor.resourceType });
      expect(ports.revocation.revalidate).toHaveBeenCalledWith(expect.objectContaining({ requiredSlug: descriptor.slug }));
    }
  });

  it("denies unknown and hostile tool names before invoking either adapter", async () => {
    for (const toolName of ["workspace.unknown", " workspace.get", "x".repeat(129)]) {
      const ports = adapters();
      await expect(authorizeDeveloperMcpCall(input({
        toolName,
        revocationAdapter: ports.revocation,
        resourceAuthorizationAdapter: ports.resource,
      }))).resolves.toEqual({ status: "denied", code: "unknown_tool" });
      expect(ports.calls).toEqual([]);
    }
  });

  it("recomputes raw authority and bounds snapshot freshness", async () => {
    const denied = { status: "denied", code: "authority_missing" };
    await expect(authorizeDeveloperMcpCall(input({ authoritySource: { ...authoritySource, tokenScopes: [], effectiveSlugs: ["module.dev.workspace.read"] } as never }))).resolves.toEqual({ status: "denied", code: "invalid_context" });
    await expect(authorizeDeveloperMcpCall(input({ authoritySource: { ...authoritySource, resolvedAtMs: NOW - MAX_AUTHORITY_STALENESS_MS - 1 } }))).resolves.toEqual(denied);
    await expect(authorizeDeveloperMcpCall(input({ authoritySource: { ...authoritySource, resolvedAtMs: NOW + 1 } }))).resolves.toEqual({ status: "denied", code: "invalid_context" });
    await expect(authorizeDeveloperMcpCall(input({ authoritySource: { ...authoritySource, resolvedAtMs: Number.NaN } }))).resolves.toEqual({ status: "denied", code: "invalid_context" });
  });

  it("rejects malformed top-level, principal, and resource shapes before adapters", async () => {
    class PrincipalRecord {
      tenantId = principal.tenantId;
      userId = principal.userId;
      clientId = principal.clientId;
    }
    const cases = [
      { ...input(), extra: true },
      input({ principal: { ...principal, extra: true } as never }),
      input({ principal: new PrincipalRecord() as never }),
      input({ resource: { resourceType: "module_workspace", resourceId: `A${WORKSPACE.slice(1)}` } }),
      input({ resource: { resourceType: "module_workspace", resourceId: WORKSPACE.slice(1) } }),
    ];
    for (const candidate of cases) {
      const ports = adapters();
      await expect(authorizeDeveloperMcpCall({
        ...candidate,
        revocationAdapter: ports.revocation,
        resourceAuthorizationAdapter: ports.resource,
      } as never)).resolves.toEqual({ status: "denied", code: "invalid_context" });
      expect(ports.calls).toEqual([]);
    }
  });

  it("denies narrowed authority before either adapter", async () => {
    const ports = adapters();
    await expect(authorizeDeveloperMcpCall(input({ authoritySource: { ...authoritySource, consentedClientScopes: [] }, revocationAdapter: ports.revocation, resourceAuthorizationAdapter: ports.resource }))).resolves.toEqual({ status: "denied", code: "authority_missing" });
    expect(ports.calls).toEqual([]);
  });

  it("checks revocation before resources and repeats live checks for high risk", async () => {
    const low = adapters();
    await authorizeDeveloperMcpCall(input({ revocationAdapter: low.revocation, resourceAuthorizationAdapter: low.resource }));
    expect(low.calls).toEqual(["revocation:per_call", "resource"]);

    const high = adapters();
    await authorizeDeveloperMcpCall(input({ toolName: "build.run", revocationAdapter: high.revocation, resourceAuthorizationAdapter: high.resource }));
    expect(high.calls).toEqual(["revocation:per_call", "resource", "revocation:synchronous_high_risk"]);
  });

  it("never exposes resource ownership to a revoked principal", async () => {
    const ports = adapters({ revoked: true });
    const owned = await authorizeDeveloperMcpCall(input({ revocationAdapter: ports.revocation, resourceAuthorizationAdapter: ports.resource }));
    const foreign = await authorizeDeveloperMcpCall(input({ resource: { resourceType: "module_workspace", resourceId: OTHER }, revocationAdapter: ports.revocation, resourceAuthorizationAdapter: ports.resource }));
    expect(owned).toEqual({ status: "denied", code: "revoked" });
    expect(foreign).toEqual(owned);
    expect(ports.resource.authorize).not.toHaveBeenCalled();
  });

  it("rechecks a still-fresh source after membership, consent, or session revocation", async () => {
    let active = true;
    const revocation: DeveloperMcpRevocationAdapter = {
      revalidate: () => active ? { status: "active", checkedAtMs: NOW, source: "live" } : { status: "revoked" },
    };
    await expect(authorizeDeveloperMcpCall(input({ revocationAdapter: revocation }))).resolves.toMatchObject({ status: "allowed" });
    active = false;
    await expect(authorizeDeveloperMcpCall(input({ revocationAdapter: revocation }))).resolves.toEqual({ status: "denied", code: "revoked" });
  });

  it.each([
    [{ status: "active", checkedAtMs: NOW - MAX_AUTHORITY_STALENESS_MS - 1, source: "live" }],
    [{ status: "active", checkedAtMs: NOW + 1, source: "live" }],
    [{ status: "active", checkedAtMs: Number.NaN, source: "live" }],
    [{ status: "hostile", provider: "secret" }],
  ])("fails closed for invalid revocation evidence %#", async (evidence) => {
    const value = input({ revocationAdapter: { revalidate: () => evidence as never } });
    await expect(authorizeDeveloperMcpCall(value)).resolves.toEqual({ status: "denied", code: "revoked" });
  });

  it("requires explicit live evidence for the final high-risk check", async () => {
    const ports = adapters({ source: "cache" });
    await expect(authorizeDeveloperMcpCall(input({ toolName: "preview.open", revocationAdapter: ports.revocation, resourceAuthorizationAdapter: ports.resource }))).resolves.toEqual({ status: "denied", code: "revoked" });
  });

  it("bounds thrown revocation failures", async () => {
    const hostile = "provider-token-hostile";
    const result = await authorizeDeveloperMcpCall(input({ revocationAdapter: { revalidate: () => { throw new Error(hostile); } } }));
    expect(result).toEqual({ status: "denied", code: "revoked" });
    expect(JSON.stringify(result)).not.toContain(hostile);
  });

  it("normalizes adapter throws and resource-type mismatch without hostile values", async () => {
    const hostile = "provider-token-hostile";
    const throwing = input({ resourceAuthorizationAdapter: { authorize: () => { throw new Error(hostile); } } });
    const mismatch = input({ resource: { resourceType: "module_project", resourceId: WORKSPACE } });
    expect(await authorizeDeveloperMcpCall(throwing)).toEqual({ status: "denied", code: "resource_denied" });
    expect(await authorizeDeveloperMcpCall(mismatch)).toEqual(await authorizeDeveloperMcpCall(throwing));
    expect(JSON.stringify(await authorizeDeveloperMcpCall(throwing))).not.toContain(hostile);
  });

  it("rejects adapters that try to mint authority or provider evidence", async () => {
    const resourceAuthorizationAdapter = { authorize: () => ({ status: "allowed", slug: "module.dev.workspace.read" }) };
    await expect(authorizeDeveloperMcpCall(input({ resourceAuthorizationAdapter: resourceAuthorizationAdapter as never }))).resolves.toEqual({ status: "denied", code: "resource_denied" });
    const revocationAdapter = { revalidate: () => ({ status: "active", checkedAtMs: NOW, source: "live", provider: "hostile" }) };
    await expect(authorizeDeveloperMcpCall(input({ revocationAdapter: revocationAdapter as never }))).resolves.toEqual({ status: "denied", code: "revoked" });
  });

  it("returns only a frozen, copied, non-executable bounded allow decision", async () => {
    const mutableResource = { resourceType: "module_workspace" as const, resourceId: WORKSPACE };
    const result = await authorizeDeveloperMcpCall(input({ resource: mutableResource }));
    mutableResource.resourceId = OTHER;
    expect(result).toEqual({ status: "allowed", toolName: "workspace.get", slug: "module.dev.workspace.read", risk: "low", resourceType: "module_workspace", resourceId: WORKSPACE, profileVersion: "developer.builder@1", revocation: { checkedAtMs: NOW, source: "live" } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.status === "allowed" ? result.revocation : null)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/token|provider|handler|callback|grant|execute/);
    expect(Object.values(result).some((value) => typeof value === "function")).toBe(false);
  });
});

describe("local resource authorization reference adapter", () => {
  const snapshot = () => ({
    resources: [
      { resourceType: "module_project" as const, resourceId: PROJECT, tenantId: "tenant_example" },
      { resourceType: "module_workspace" as const, resourceId: WORKSPACE, tenantId: "tenant_example", parentProjectId: PROJECT },
      { resourceType: "module_project" as const, resourceId: WORKSPACE, tenantId: "tenant_example" },
    ],
    grants: [{ userId: "user_example", resourceType: "module_project" as const, resourceId: PROJECT, slugs: ["module.dev.workspace.read" as const] }],
  });

  it("allows exact grants, valid inheritance, and compound type/id keys", async () => {
    const adapter = createLocalDeveloperMcpResourceAuthorizationAdapter(snapshot());
    await expect(adapter.authorize({ principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_project", resourceId: PROJECT } })).resolves.toEqual({ status: "allowed" });
    await expect(adapter.authorize({ principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: WORKSPACE } })).resolves.toEqual({ status: "allowed" });
    await expect(adapter.authorize({ principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_project", resourceId: WORKSPACE } })).resolves.toEqual({ status: "denied" });
  });

  it.each([
    ["wrong tenant", { ...principal, tenantId: "tenant_other" }, "module.dev.workspace.read", WORKSPACE],
    ["wrong user", { ...principal, userId: "user_other" }, "module.dev.workspace.read", WORKSPACE],
    ["wrong slug", principal, "module.dev.workspace.create", WORKSPACE],
    ["unknown id", principal, "module.dev.workspace.read", OTHER],
    ["prefix confusion", principal, "module.dev.workspace.read", `${WORKSPACE.slice(0, 31)}3`],
  ])("denies %s identically", async (_name, caller, slug, resourceId) => {
    const adapter = createLocalDeveloperMcpResourceAuthorizationAdapter(snapshot());
    await expect(adapter.authorize({ principal: caller, requiredSlug: slug as never, resource: { resourceType: "module_workspace", resourceId } })).resolves.toEqual({ status: "denied" });
  });

  it.each([
    ["duplicate resources", (value: ReturnType<typeof snapshot>) => value.resources.push({ ...value.resources[0]! })],
    ["duplicate grants", (value: ReturnType<typeof snapshot>) => value.grants.push({ ...value.grants[0]!, slugs: [...value.grants[0]!.slugs] })],
    ["dangling parent", (value: ReturnType<typeof snapshot>) => { value.resources[1] = { resourceType: "module_workspace", resourceId: WORKSPACE, tenantId: "tenant_example", parentProjectId: OTHER }; }],
    ["cross-tenant parent", (value: ReturnType<typeof snapshot>) => { value.resources[1] = { resourceType: "module_workspace", resourceId: WORKSPACE, tenantId: "tenant_other", parentProjectId: PROJECT }; }],
  ])("rejects an invalid %s snapshot", (_name, mutate) => {
    const value = snapshot();
    mutate(value);
    expect(() => createLocalDeveloperMcpResourceAuthorizationAdapter(value)).toThrow(TypeError);
  });

  it("defensively copies and freezes its local snapshot", async () => {
    const value = snapshot();
    const adapter = createLocalDeveloperMcpResourceAuthorizationAdapter(value);
    value.grants[0]!.slugs.length = 0;
    value.resources[1]!.tenantId = "tenant_other";
    await expect(adapter.authorize({ principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: WORKSPACE } })).resolves.toEqual({ status: "allowed" });
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.snapshot)).toBe(true);
    expect(Object.isFrozen(adapter.snapshot.resources)).toBe(true);
    expect(Object.isFrozen(adapter.snapshot.grants[0]!.slugs)).toBe(true);
  });

  it("fails closed for malformed direct adapter requests", async () => {
    const adapter = createLocalDeveloperMcpResourceAuthorizationAdapter(snapshot());
    class PrincipalRecord {
      tenantId = principal.tenantId;
      userId = principal.userId;
      clientId = principal.clientId;
    }
    const requests = [
      { principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: WORKSPACE }, extra: true },
      { principal: new PrincipalRecord(), requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: WORKSPACE } },
      { principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: `A${WORKSPACE.slice(1)}` } },
      { principal, requiredSlug: "module.dev.workspace.read", resource: { resourceType: "module_workspace", resourceId: `${WORKSPACE}0` } },
    ];
    for (const request of requests) {
      await expect(adapter.authorize(request as never)).resolves.toEqual({ status: "denied" });
    }
  });
});
