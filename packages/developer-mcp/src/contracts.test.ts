import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_PERMISSION_SLUGS,
  DEVELOPER_MCP_AUDIT_FIELDS,
  DEVELOPER_TOOL_DESCRIPTORS,
  MAX_AUTHORITY_STALENESS_MS,
  assertDeveloperMcpAuditRecord,
  buildToolList,
  requiresSynchronousRevocationCheck,
  type DeveloperMcpAuditDecisionCode,
  type DeveloperMcpAuditRecord,
} from "./index";
import * as testingExports from "./testing";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
  : false;
type Assert<T extends true> = T;
type Stage<S extends DeveloperMcpAuditRecord["contextResolution"]> = Extract<DeveloperMcpAuditRecord, { contextResolution: S }>;
type _UnresolvedIdentity = Assert<Equal<Pick<Stage<"unresolved">, "toolName" | "slug" | "profileVersion" | "clientId" | "userId" | "tenantId" | "resourceType" | "resourceId" | "riskClass">,
  Readonly<{ toolName: null; slug: null; profileVersion: null; clientId: null; userId: null; tenantId: null; resourceType: null; resourceId: null; riskClass: null }>>>;
type _PrincipalIdentity = Assert<Equal<Pick<Stage<"principal">, "toolName" | "slug" | "profileVersion" | "clientId" | "userId" | "tenantId" | "resourceType" | "resourceId" | "riskClass">,
  Readonly<{ toolName: null; slug: null; profileVersion: null; clientId: string; userId: string; tenantId: string; resourceType: "module_project" | "module_workspace"; resourceId: string; riskClass: null }>>>;
type _CompleteNullability = Assert<Equal<null extends Stage<"complete">["profileVersion"] ? true : false, true>>;
type _CompleteTool = Assert<Equal<Stage<"complete">["toolName"], string>>;
type _CompleteSlug = Assert<Equal<null extends Stage<"complete">["slug"] ? true : false, false>>;
type _CompleteClient = Assert<Equal<Stage<"complete">["clientId"], string>>;
type _CompleteUser = Assert<Equal<Stage<"complete">["userId"], string>>;
type _CompleteTenant = Assert<Equal<Stage<"complete">["tenantId"], string>>;
type _CompleteResourceType = Assert<Equal<null extends Stage<"complete">["resourceType"] ? true : false, false>>;
type _CompleteResourceId = Assert<Equal<Stage<"complete">["resourceId"], string>>;
type _CompleteRisk = Assert<Equal<null extends Stage<"complete">["riskClass"] ? true : false, false>>;

describe("Developer MCP revocation policy", () => {
  it("bounds stale authority and synchronously checks high-risk grants", () => {
    expect(MAX_AUTHORITY_STALENESS_MS).toBe(60_000);
    expect(requiresSynchronousRevocationCheck("module.dev.build.execute")).toBe(true);
    expect(requiresSynchronousRevocationCheck("module.dev.preview.open")).toBe(true);
    expect(requiresSynchronousRevocationCheck("module.dev.workspace.create")).toBe(false);
    expect(requiresSynchronousRevocationCheck("module.dev.future-risk")).toBe(true);
  });
});

describe("Developer MCP tools", () => {
  it("snapshots the twelve names and forms a total surjection", () => {
    expect(DEVELOPER_TOOL_DESCRIPTORS.map(({ name }) => name)).toEqual([
      "workspace.list", "workspace.get", "workspace.create", "workspace.resume",
      "workspace.snapshot", "workspace.archive", "contract.list", "contract.get",
      "build.run", "preview.open", "evidence.list", "evidence.get",
    ]);
    expect(DEVELOPER_TOOL_DESCRIPTORS).toHaveLength(12);
    expect(new Set(DEVELOPER_TOOL_DESCRIPTORS.map(({ slug }) => slug))).toEqual(
      new Set(ASSIGNABLE_PERMISSION_SLUGS),
    );
    for (const tool of DEVELOPER_TOOL_DESCRIPTORS) {
      expect(ASSIGNABLE_PERMISSION_SLUGS).toContain(tool.slug);
      expect(tool.description.length).toBeGreaterThanOrEqual(1);
      expect(tool.description.length).toBeLessThanOrEqual(280);
      expect("handler" in tool || "execute" in tool || "call" in tool).toBe(false);
    }
  });

  it("uses only closed, bounded caller fields and excludes authority escalation fields", () => {
    const forbidden = /tenant|limits|network|bytes|digest|provider/i;
    for (const tool of DEVELOPER_TOOL_DESCRIPTORS) {
      expect(tool.request.additionalProperties).toBe(false);
      for (const [name, field] of Object.entries(tool.request.properties)) {
        expect(name).not.toMatch(forbidden);
        if (field.type === "string") {
          expect(field.minLength).toBeGreaterThan(0);
          expect(field.maxLength).toBeGreaterThan(0);
          if (field.enumSource !== undefined) {
            expect(field.enum).toBeDefined();
            expect(Object.isFrozen(field.enum)).toBe(true);
          }
        } else if (field.type === "integer") {
          expect(field.minimum).toBeTypeOf("number");
          expect(field.maximum).toBeTypeOf("number");
        }
      }
    }
  });

  it("fails closed for unresolved template-command and contract catalogues", () => {
    const build = DEVELOPER_TOOL_DESCRIPTORS.find(({ name }) => name === "build.run");
    const contract = DEVELOPER_TOOL_DESCRIPTORS.find(({ name }) => name === "contract.get");
    expect(build?.request.properties.command).toMatchObject({ enum: [] });
    expect(contract?.request.properties.contractId).toMatchObject({ enum: [] });
  });

  it("deep-freezes every exported descriptor and security vocabulary", () => {
    expect(Object.isFrozen(DEVELOPER_TOOL_DESCRIPTORS)).toBe(true);
    for (const tool of DEVELOPER_TOOL_DESCRIPTORS) {
      expect(Object.isFrozen(tool)).toBe(true);
      expect(Object.isFrozen(tool.request)).toBe(true);
      expect(Object.isFrozen(tool.request.properties)).toBe(true);
      expect(Object.isFrozen(tool.request.required)).toBe(true);
      for (const field of Object.values(tool.request.properties)) {
        expect(Object.isFrozen(field)).toBe(true);
        if (field.type === "string" && field.enum !== undefined) {
          expect(Object.isFrozen(field.enum)).toBe(true);
        }
      }
    }
  });
});

describe("Developer MCP tool list", () => {
  it("is private, bounded, filtered, name-sorted, and byte-stable", () => {
    const authority = ["module.dev.workspace.lifecycle", "module.dev.workspace.read"] as const;
    const first = buildToolList(authority);
    const second = buildToolList([...authority].reverse());
    expect(first).toMatchObject({ cacheScope: "private", ttlMs: 60_000, resultType: "complete" });
    expect(first.ttlMs).toBeLessThanOrEqual(MAX_AUTHORITY_STALENESS_MS);
    expect(first.tools.map(({ name }) => name)).toEqual(
      [...first.tools.map(({ name }) => name)].sort(),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(buildToolList([]).tools).toEqual([]);
  });
});

describe("Developer MCP audit vocabulary", () => {
  const validRecord = {
    toolName: "workspace.get",
    schemaVersion: "2",
    contextResolution: "complete",
    decisionCode: "allowed",
    slug: "module.dev.workspace.read",
    profileVersion: "developer.readonly@1",
    clientId: "client_synthetic",
    userId: "user_synthetic",
    tenantId: "tenant_synthetic",
    resourceType: "module_workspace",
    resourceId: "0123456789abcdef0123456789abcdef",
    riskClass: "low",
    authorizationDecision: "allow",
    revocationCheckResult: "passed",
    outcome: "authorized",
    correlationId: "correlation_synthetic",
    priorDigest: null,
    currentDigest: null,
  } as const;
  const principalRecord = {
    ...validRecord, toolName: null, slug: null, profileVersion: null, riskClass: null,
    contextResolution: "principal", decisionCode: "unknown_tool", authorizationDecision: "deny",
    revocationCheckResult: "not_required", outcome: "denied",
  } as const;
  const unresolvedRecord = {
    ...principalRecord, clientId: null, userId: null, tenantId: null, resourceType: null, resourceId: null,
    contextResolution: "unresolved", decisionCode: "invalid_context",
  } as const;

  it("snapshots the closed section 6 field vocabulary", () => {
    expect(DEVELOPER_MCP_AUDIT_FIELDS).toEqual([
      "toolName", "schemaVersion", "slug", "profileVersion", "clientId", "userId",
      "tenantId", "resourceType", "resourceId", "riskClass", "authorizationDecision",
      "revocationCheckResult", "outcome", "correlationId", "priorDigest", "currentDigest",
      "contextResolution", "decisionCode",
    ]);
    expect(assertDeveloperMcpAuditRecord(validRecord)).toEqual(validRecord);
  });

  it.each(["extra", "_meta", "clientInfo"])("rejects hostile or extra field %s", (field) => {
    expect(() => assertDeveloperMcpAuditRecord({ ...validRecord, [field]: "hostile" })).toThrow();
  });

  it.each([
    ["toolName", "unknown.tool"],
    ["schemaVersion", "1"],
    ["slug", "module.dev.unknown"],
    ["profileVersion", "developer.proposer@1"],
    ["clientId", "client\nforged"],
    ["resourceType", "tenant"],
    ["riskClass", "critical"],
    ["authorizationDecision", "maybe"],
    ["revocationCheckResult", "unknown"],
    ["outcome", "unknown"],
    ["priorDigest", "not-a-digest"],
  ])("rejects an invalid %s value", (field, invalid) => {
    expect(() => assertDeveloperMcpAuditRecord({ ...validRecord, [field]: invalid })).toThrow();
  });

  it("rejects hidden and symbol fields and returns a frozen defensive copy", () => {
    const hidden = { ...validRecord };
    Object.defineProperty(hidden, "hidden", { value: "hostile", enumerable: false });
    expect(() => assertDeveloperMcpAuditRecord(hidden)).toThrow();
    expect(() => assertDeveloperMcpAuditRecord({
      ...validRecord,
      [Symbol("hostile")]: "hostile",
    })).toThrow();
    const accessor = { ...validRecord };
    Object.defineProperty(accessor, "toolName", { enumerable: true, get: () => "workspace.get" });
    expect(() => assertDeveloperMcpAuditRecord(accessor)).toThrow();
    expect(() => assertDeveloperMcpAuditRecord(Object.assign(Object.create({ inherited: true }), validRecord))).toThrow();

    const accepted = assertDeveloperMcpAuditRecord(validRecord);
    expect(accepted).not.toBe(validRecord);
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  it("pins descriptor agreement for every frozen tool", () => {
    const rows = [
      ["workspace.list", "module.dev.workspace.read", "low", "module_project"],
      ["workspace.get", "module.dev.workspace.read", "low", "module_workspace"],
      ["workspace.create", "module.dev.workspace.create", "medium", "module_project"],
      ["workspace.resume", "module.dev.workspace.lifecycle", "medium", "module_workspace"],
      ["workspace.snapshot", "module.dev.workspace.lifecycle", "medium", "module_workspace"],
      ["workspace.archive", "module.dev.workspace.lifecycle", "medium", "module_workspace"],
      ["contract.list", "module.dev.contract.read", "low", "module_project"],
      ["contract.get", "module.dev.contract.read", "low", "module_project"],
      ["build.run", "module.dev.build.execute", "high", "module_workspace"],
      ["preview.open", "module.dev.preview.open", "high", "module_workspace"],
      ["evidence.list", "module.dev.evidence.read", "low", "module_workspace"],
      ["evidence.get", "module.dev.evidence.read", "low", "module_workspace"],
    ] as const;
    expect(DEVELOPER_TOOL_DESCRIPTORS.map(({ name, slug, risk, resourceType }) => [name, slug, risk, resourceType])).toEqual(rows);
    for (const [toolName, slug, riskClass, resourceType] of rows) {
      const record = { ...validRecord, toolName, slug, riskClass, resourceType };
      expect(assertDeveloperMcpAuditRecord(record)).toEqual(record);
      expect(() => assertDeveloperMcpAuditRecord({ ...record, slug: slug === "module.dev.workspace.read" ? "module.dev.contract.read" : "module.dev.workspace.read" })).toThrow();
      expect(() => assertDeveloperMcpAuditRecord({ ...record, riskClass: riskClass === "low" ? "medium" : "low" })).toThrow();
      expect(() => assertDeveloperMcpAuditRecord({ ...record, resourceType: resourceType === "module_project" ? "module_workspace" : "module_project" })).toThrow();
    }
  });

  it("exhaustively validates the 48 complete evidence tuples and exactly eight acceptances", () => {
    const rules = {
      allowed: { authorizationDecision: "allow", outcome: "authorized" },
      invalid_context: { authorizationDecision: "deny", outcome: "denied" },
      unknown_tool: { authorizationDecision: "deny", outcome: "denied" },
      authority_missing: { authorizationDecision: "deny", outcome: "denied" },
      resource_denied: { authorizationDecision: "deny", outcome: "denied" },
      revoked: { authorizationDecision: "deny", outcome: "denied" },
    } as const satisfies Record<DeveloperMcpAuditDecisionCode, { authorizationDecision: "allow" | "deny"; outcome: "authorized" | "denied" }>;
    const codes = ["allowed", "authority_missing", "resource_denied", "revoked"] as const;
    const revocations = ["passed", "failed", "not_required"] as const;
    const profiles = [null, "developer.readonly@1"] as const;
    const resources = ["module_workspace", "module_project"] as const;
    let candidates = 0;
    let accepted = 0;
    for (const decisionCode of codes) for (const revocationCheckResult of revocations) for (const profileVersion of profiles) for (const resourceType of resources) {
      candidates += 1;
      const matched = resourceType === "module_workspace";
      const expected = decisionCode === "allowed" ? revocationCheckResult === "passed" && profileVersion !== null && matched
        : decisionCode === "authority_missing" ? revocationCheckResult === "not_required"
          : decisionCode === "resource_denied" ? profileVersion !== null && ((matched && revocationCheckResult === "passed") || (!matched && revocationCheckResult === "not_required"))
            : revocationCheckResult === "failed" && profileVersion !== null && matched;
      const candidate = { ...validRecord, decisionCode, revocationCheckResult, profileVersion, resourceType, ...rules[decisionCode] };
      if (expected) { expect(assertDeveloperMcpAuditRecord(candidate)).toEqual(candidate); accepted += 1; }
      else expect(() => assertDeveloperMcpAuditRecord(candidate)).toThrow();
    }
    expect({ candidates, accepted }).toEqual({ candidates: 48, accepted: 8 });
  });

  it("proves the full code x stage x authorization x outcome agreement matrix", () => {
    const rules = {
      allowed: ["complete", "allow", "authorized"],
      invalid_context: ["unresolved", "deny", "denied"],
      unknown_tool: ["principal", "deny", "denied"],
      authority_missing: ["complete", "deny", "denied"],
      resource_denied: ["complete", "deny", "denied"],
      revoked: ["complete", "deny", "denied"],
    } as const satisfies Record<DeveloperMcpAuditDecisionCode, readonly [DeveloperMcpAuditRecord["contextResolution"], "allow" | "deny", "authorized" | "denied"]>;
    const bases = {
      unresolved: unresolvedRecord,
      principal: principalRecord,
      complete: validRecord,
    } as const;
    const codes = Object.keys(rules) as DeveloperMcpAuditDecisionCode[];
    for (const decisionCode of codes) for (const contextResolution of ["unresolved", "principal", "complete"] as const)
      for (const authorizationDecision of ["allow", "deny"] as const) for (const outcome of ["authorized", "denied"] as const) {
        const base = bases[contextResolution];
        const completeEvidence = decisionCode === "authority_missing" ? { profileVersion: null, revocationCheckResult: "not_required" }
          : decisionCode === "resource_denied" ? { profileVersion: "developer.readonly@1", revocationCheckResult: "passed" }
            : decisionCode === "revoked" ? { profileVersion: "developer.readonly@1", revocationCheckResult: "failed" }
              : {};
        const candidate = { ...base, ...completeEvidence, contextResolution, decisionCode, authorizationDecision, outcome };
        const [expectedStage, expectedAuthorization, expectedOutcome] = rules[decisionCode];
        const stagePermitsCode = contextResolution === expectedStage
          || (contextResolution === "principal" && decisionCode === "invalid_context")
          || (contextResolution === "principal" && decisionCode === "authority_missing");
        const expected = stagePermitsCode && authorizationDecision === expectedAuthorization && outcome === expectedOutcome;
        if (expected) expect(assertDeveloperMcpAuditRecord(candidate)).toEqual(candidate);
        else expect(() => assertDeveloperMcpAuditRecord(candidate)).toThrow();
      }
  });

  it("represents every authorization branch without deriving expected audit identity", () => {
    const fixtures = [
      unresolvedRecord,
      { ...principalRecord, decisionCode: "invalid_context" },
      { ...principalRecord, decisionCode: "unknown_tool" },
      { ...principalRecord, decisionCode: "authority_missing" },
      { ...validRecord, decisionCode: "authority_missing", profileVersion: null, authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" },
      { ...validRecord, decisionCode: "authority_missing", authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" },
      { ...validRecord, decisionCode: "authority_missing", profileVersion: null, resourceType: "module_project", authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" },
      { ...validRecord, decisionCode: "authority_missing", resourceType: "module_project", authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" },
      { ...validRecord, decisionCode: "resource_denied", resourceType: "module_project", authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" },
      { ...validRecord, decisionCode: "resource_denied", authorizationDecision: "deny", revocationCheckResult: "passed", outcome: "denied" },
      { ...validRecord, decisionCode: "revoked", authorizationDecision: "deny", revocationCheckResult: "failed", outcome: "denied" },
      validRecord,
    ] as const;
    for (const fixture of fixtures) expect(assertDeveloperMcpAuditRecord(fixture)).toEqual(fixture);
  });

  it("keeps correlation evidence distinct from actor and resource grammars at every stage", () => {
    for (const fixture of [unresolvedRecord, principalRecord, validRecord]) {
      for (const correlationId of [" leading", "trailing ", "nonascii_£", "λ-trace", "x".repeat(128)])
        expect(assertDeveloperMcpAuditRecord({ ...fixture, correlationId }).correlationId).toBe(correlationId);
      for (const correlationId of ["", "x".repeat(129), "corr\nid", "corr\u0000id", "corr\u009fid"])
        expect(() => assertDeveloperMcpAuditRecord({ ...fixture, correlationId })).toThrow();
    }
    for (const fixture of [principalRecord, validRecord]) for (const field of ["clientId", "userId", "tenantId"] as const)
      for (const invalid of [" leading", "trailing ", "nonascii_£", "λ-trace"])
        expect(() => assertDeveloperMcpAuditRecord({ ...fixture, [field]: invalid })).toThrow();
    for (const fixture of [principalRecord, validRecord]) for (const invalid of ["A".repeat(32), "a".repeat(31), "a".repeat(33)])
      expect(() => assertDeveloperMcpAuditRecord({ ...fixture, resourceId: invalid })).toThrow();
  });

  it("rejects fabricated and discarded identity one field at a time", () => {
    for (const field of ["toolName", "slug", "profileVersion", "clientId", "userId", "tenantId", "resourceType", "resourceId", "riskClass"] as const)
      expect(() => assertDeveloperMcpAuditRecord({ ...unresolvedRecord, [field]: validRecord[field] })).toThrow();
    for (const field of ["toolName", "slug", "profileVersion", "riskClass"] as const)
      expect(() => assertDeveloperMcpAuditRecord({ ...principalRecord, [field]: validRecord[field] })).toThrow();
    for (const field of ["clientId", "userId", "tenantId", "resourceType", "resourceId"] as const)
      expect(() => assertDeveloperMcpAuditRecord({ ...principalRecord, [field]: null })).toThrow();
    for (const field of ["toolName", "slug", "clientId", "userId", "tenantId", "resourceType", "resourceId", "riskClass"] as const)
      expect(() => assertDeveloperMcpAuditRecord({ ...validRecord, [field]: null })).toThrow();
  });

  it("exports an exhaustive decision vocabulary and a staged record union", () => {
    const decisions = {
      allowed: true,
      invalid_context: true,
      unknown_tool: true,
      authority_missing: true,
      resource_denied: true,
      revoked: true,
    } satisfies Record<DeveloperMcpAuditDecisionCode, true>;
    expect(Object.keys(decisions)).toHaveLength(6);

    const unresolved: DeveloperMcpAuditRecord = {
      ...validRecord,
      toolName: null, slug: null, profileVersion: null, clientId: null, userId: null,
      tenantId: null, resourceType: null, resourceId: null, riskClass: null,
      contextResolution: "unresolved", decisionCode: "invalid_context",
      authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied",
    };
    expect(assertDeveloperMcpAuditRecord(unresolved)).toEqual(unresolved);
  });
});

describe("Developer MCP testing export", () => {
  it("keeps the documented testing subpath live", () => {
    expect(Object.keys(testingExports).sort()).toEqual([
      "DEVELOPER_MCP_AUDIT_FIELDS",
      "DEVELOPER_MCP_CONFORMANCE_FIXTURES",
      "DEVELOPER_PROFILES",
      "DEVELOPER_TOOL_DESCRIPTORS",
    ]);
  });
});
