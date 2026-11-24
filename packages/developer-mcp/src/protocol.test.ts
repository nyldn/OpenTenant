import { describe, expect, it } from "vitest";

import {
  DEVELOPER_MCP_PROTOCOL_VERSION,
  DEVELOPER_MCP_META_KEYS,
  MAX_AUTHORITY_STALENESS_MS,
  buildServerDiscovery,
  buildToolList,
  serializeServerDiscovery,
  serializeToolList,
  validateDeveloperMcpRequest,
} from "./index";
import { DEVELOPER_MCP_CONFORMANCE_FIXTURES } from "./testing";

const fixtures = DEVELOPER_MCP_CONFORMANCE_FIXTURES;

describe("Developer MCP modern request contract", () => {
  it("accepts a literal final-spec request without using package metadata constants", () => {
    const request = {
      jsonrpc: "2.0",
      id: "",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "literal-client", version: "1" },
        },
      },
    };
    const headers = [
      ["Content-Type", "application/json"],
      ["Accept", "application/json, text/event-stream"],
      ["MCP-Protocol-Version", "2026-07-28"],
      ["Mcp-Method", "server/discover"],
    ];
    expect(validateDeveloperMcpRequest(headers, request)).toMatchObject({ ok: true, request: { id: "" } });
  });

  it.each(["serverDiscover", "toolsList"] as const)("accepts the %s fixture", (name) => {
    const fixture = fixtures.valid[name];
    const validated = validateDeveloperMcpRequest(fixture.headers, fixture.request);
    expect(validated).toEqual({
      ok: true,
      request: fixture.request,
    });
    expect(validated.ok && validated.request).not.toBe(fixture.request);
    expect(validated.ok && Object.isFrozen(validated.request)).toBe(true);
  });

  it("accepts differently cased header names and ignores legacy session headers", () => {
    const fixture = fixtures.valid.toolsListWithLegacyHeaders;
    const headers = fixture.headers.map(([name, value]) => [name.toLowerCase(), value] as const);
    expect(validateDeveloperMcpRequest(headers, fixture.request)).toEqual({
      ok: true,
      request: fixture.request,
    });
  });

  it.each([
    [fixtures.invalid.missingContentType, -32600, 400],
    [fixtures.invalid.duplicateContentType, -32600, 400],
    [fixtures.invalid.zeroQualityAccept, -32600, 400],
    [fixtures.invalid.missingProtocolHeader, -32020, 400],
    [fixtures.invalid.duplicateMixedCaseProtocolHeader, -32020, 400],
    [fixtures.invalid.unexpectedNameHeader, -32020, 400],
    [fixtures.invalid.invalidId, -32600, 400],
    [fixtures.invalid.extraEnvelopeMember, -32600, 400],
    [fixtures.invalid.missingMetadata, -32602, 400],
    [fixtures.invalid.extraMetadataMember, -32602, 400],
    [fixtures.invalid.listCursor, -32600, 400],
    [fixtures.invalid.headerMethodMismatch, -32020, 400],
    [fixtures.invalid.unsupportedVersion, -32022, 400],
    [fixtures.invalid.unexpectedNameBeforeUnsupportedVersion, -32020, 400],
    [fixtures.invalid.toolsCall, -32601, 404],
    [fixtures.invalid.toolsCallWithRequiredName, -32601, 404],
    [fixtures.invalid.inputRequired, -32601, 404],
    [fixtures.invalid.initialize, -32601, 404],
  ] as const)("returns the frozen bounded failure for %#", (fixture, code, httpStatus) => {
    const result = validateDeveloperMcpRequest(fixture.headers, fixture.request);
    expect(result).toMatchObject({ ok: false, error: { code, httpStatus } });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  });

  it("uses the frozen first-error precedence", () => {
    const fixture = fixtures.invalid.multipleFailures;
    expect(validateDeveloperMcpRequest(fixture.headers, fixture.request)).toMatchObject({
      ok: false,
      error: { code: -32600, httpStatus: 400, message: "Invalid media negotiation headers" },
    });
  });

  it("keeps hostile optional metadata descriptive and bounded", () => {
    const fixture = fixtures.invalid.hostileClientMetadata;
    const result = validateDeveloperMcpRequest(fixture.headers, fixture.request);
    expect(result).toMatchObject({ ok: false, error: { code: -32602 } });
    expect(JSON.stringify(result)).not.toContain("tenant-forged");
  });

  it("keeps mirrored values case-sensitive", () => {
    const fixture = fixtures.invalid.caseChangedMethod;
    expect(validateDeveloperMcpRequest(fixture.headers, fixture.request)).toMatchObject({
      ok: false,
      error: { code: -32601, httpStatus: 404 },
    });
  });

  it("accepts bounded standard client capability and client-info shapes", () => {
    const fixture = structuredClone(fixtures.valid.toolsList);
    const metadata = fixture.request.params._meta as unknown as Record<string, unknown>;
    metadata[DEVELOPER_MCP_META_KEYS.clientCapabilities] = {
      sampling: { tools: { formats: ["json"] } },
      elicitation: { form: {} },
      extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } },
    };
    metadata[DEVELOPER_MCP_META_KEYS.clientInfo] = {
      name: "conformance-client",
      title: "Conformance Client",
      version: "1",
      description: "Synthetic client metadata.",
      websiteUrl: "https://example.test/client",
    };
    expect(validateDeveloperMcpRequest(fixture.headers, fixture.request)).toMatchObject({ ok: true });
  });

  it("fails closed instead of throwing on malformed runtime header input", () => {
    expect(() => validateDeveloperMcpRequest([[null, "application/json"]], fixtures.valid.toolsList.request)).not.toThrow();
    expect(validateDeveloperMcpRequest([[null, "application/json"]], fixtures.valid.toolsList.request)).toMatchObject({
      ok: false,
      error: { code: -32600, httpStatus: 400 },
    });
  });

  it("does not reject a bounded request merely because it carries more than 64 unrelated headers", () => {
    const fixture = fixtures.valid.toolsList;
    const headers = [
      ...fixture.headers,
      ...Array.from({ length: 65 }, (_, index) => [`X-Synthetic-${index}`, "bounded"] as const),
    ];
    expect(validateDeveloperMcpRequest(headers, fixture.request)).toMatchObject({ ok: true });
  });

  it("uses the protocol-defined unsupported-version data shape", () => {
    expect(validateDeveloperMcpRequest(
      fixtures.invalid.unsupportedVersion.headers,
      fixtures.invalid.unsupportedVersion.request,
    )).toMatchObject({
      ok: false,
      error: {
        code: -32022,
        data: { supported: [DEVELOPER_MCP_PROTOCOL_VERSION], requested: "2099-01-01" },
      },
    });
  });
});

describe("Developer MCP discovery contract", () => {
  it("is tenant-invariant, public, byte-stable, and enumeration-free", () => {
    const first = buildServerDiscovery();
    expect(first).toEqual({
      resultType: "complete",
      supportedVersions: [DEVELOPER_MCP_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "OpenTenant Developer MCP", version: "1" } },
      ttlMs: 60_000,
      cacheScope: "public",
    });
    expect(serializeServerDiscovery()).toBe(JSON.stringify(first));
    expect(serializeServerDiscovery()).toBe(serializeServerDiscovery());
    expect(serializeServerDiscovery()).not.toMatch(/tenantId|toolName|templateId|profile|provider|route|environment/i);
  });
});

describe("Developer MCP tools/list contract", () => {
  it("is complete, private, authority-filtered, sorted, and byte-stable", () => {
    const authority = ["module.dev.workspace.lifecycle", "module.dev.workspace.read"] as const;
    const first = buildToolList(authority);
    const second = buildToolList([...authority].reverse());
    expect(first).toMatchObject({ cacheScope: "private", ttlMs: 60_000, resultType: "complete" });
    expect(second).toEqual(first);
    expect(first.ttlMs).toBeLessThanOrEqual(MAX_AUTHORITY_STALENESS_MS);
    expect(first).not.toHaveProperty("nextCursor");
    expect(first.tools.map(({ name }) => name)).toEqual(
      [...first.tools.map(({ name }) => name)].sort(),
    );
    expect(serializeToolList(authority)).toBe(JSON.stringify(first));
    expect(serializeToolList(authority)).toBe(serializeToolList([...authority].reverse()));
    expect(buildToolList([]).tools).toEqual([]);
  });

  it("projects only wire fields and self-contained JSON Schema 2020-12", () => {
    const tools = buildToolList([
      "module.dev.workspace.read",
      "module.dev.workspace.create",
    ]).tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(Object.keys(tool)).toEqual(["name", "description", "inputSchema"]);
      expect(tool.description.length).toBeGreaterThanOrEqual(1);
      expect(tool.description.length).toBeLessThanOrEqual(280);
      expect(tool.inputSchema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
      });
      expect(JSON.stringify(tool)).not.toMatch(/enumSource|resourceType|risk|slug|schemaVersion|\$ref|x-mcp-header/);
      expect(Object.values(tool.inputSchema.properties).some(
        (field) => typeof field === "object" && field !== null && "enum" in field
          && Array.isArray(field.enum) && field.enum.length === 0,
      )).toBe(false);
    }
  });

  it("omits descriptors whose server-owned enum remains unresolved", () => {
    const tools = buildToolList([
      "module.dev.contract.read",
      "module.dev.build.execute",
    ]).tools.map(({ name }) => name);
    expect(tools).toContain("contract.list");
    expect(tools).not.toContain("contract.get");
    expect(tools).not.toContain("build.run");
    expect(fixtures.results.unresolvedCatalogueToolList.tools.map(({ name }) => name)).toEqual(["contract.list"]);
  });
});
