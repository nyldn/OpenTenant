import {
  DEVELOPER_MCP_META_KEYS,
  DEVELOPER_MCP_PROTOCOL_VERSION,
  type DeveloperMcpHeader,
} from "./protocol";
import { buildToolList } from "./catalog";

function request(method: string, protocolVersion: string = DEVELOPER_MCP_PROTOCOL_VERSION) {
  return { jsonrpc: "2.0", id: "request-1", method, params: { _meta: {
    [DEVELOPER_MCP_META_KEYS.protocolVersion]: protocolVersion,
    [DEVELOPER_MCP_META_KEYS.clientCapabilities]: {},
    [DEVELOPER_MCP_META_KEYS.clientInfo]: { name: "conformance-client", version: "1" },
  } } } as const;
}

function headers(method: string, protocolVersion: string = DEVELOPER_MCP_PROTOCOL_VERSION): DeveloperMcpHeader[] {
  return [["Content-Type", "application/json"], ["Accept", "application/json, text/event-stream"],
    ["MCP-Protocol-Version", protocolVersion], ["Mcp-Method", method]];
}

const validDiscover = Object.freeze({ headers: Object.freeze(headers("server/discover")), request: Object.freeze(request("server/discover")) });
const validList = Object.freeze({ headers: Object.freeze(headers("tools/list")), request: Object.freeze(request("tools/list")) });

interface MutableDeveloperMcpConformanceRequest {
  [key: string]: unknown;
  jsonrpc: string;
  id: unknown;
  method: string;
  params: {
    [key: string]: unknown;
    _meta: {
      [key: string]: unknown;
      [DEVELOPER_MCP_META_KEYS.protocolVersion]: string;
      [DEVELOPER_MCP_META_KEYS.clientCapabilities]?: Record<string, unknown>;
      [DEVELOPER_MCP_META_KEYS.clientInfo]: Record<string, unknown>;
    };
  };
}

function fixture(
  method: string,
  mutateHeaders?: (value: DeveloperMcpHeader[]) => void,
  mutateRequest?: (value: MutableDeveloperMcpConformanceRequest) => void,
) {
  const headerValue = headers(method);
  const requestValue = structuredClone(request(method)) as MutableDeveloperMcpConformanceRequest;
  mutateHeaders?.(headerValue);
  mutateRequest?.(requestValue);
  return Object.freeze({ headers: Object.freeze(headerValue), request: Object.freeze(requestValue) });
}

export const DEVELOPER_MCP_CONFORMANCE_FIXTURES = Object.freeze({
  valid: Object.freeze({
    serverDiscover: validDiscover,
    toolsList: validList,
    toolsListWithLegacyHeaders: fixture("tools/list", (value) => value.push(
      ["Mcp-Session-Id", "ignored-session"],
      ["Last-Event-ID", "ignored-resume"],
    )),
  }),
  results: Object.freeze({
    emptyAuthorityToolList: buildToolList([]),
    readAuthorityToolList: buildToolList(["module.dev.workspace.read"]),
    unresolvedCatalogueToolList: buildToolList(["module.dev.contract.read", "module.dev.build.execute"]),
  }),
  invalid: Object.freeze({
    missingContentType: fixture("tools/list", (value) => value.splice(0, 1)),
    duplicateContentType: fixture("tools/list", (value) => value.push(["content-type", "application/json"])),
    zeroQualityAccept: fixture("tools/list", (value) => { value[1] = ["Accept", "application/json;q=0, text/event-stream"]; }),
    missingProtocolHeader: fixture("tools/list", (value) => value.splice(2, 1)),
    duplicateMixedCaseProtocolHeader: fixture("tools/list", (value) => value.push(["mcp-protocol-version", DEVELOPER_MCP_PROTOCOL_VERSION])),
    unexpectedNameHeader: fixture("tools/list", (value) => value.push(["Mcp-Name", "dG9vbA=="])),
    invalidId: fixture("tools/list", undefined, (value) => { value.id = Number.MAX_SAFE_INTEGER + 1; }),
    extraEnvelopeMember: fixture("tools/list", undefined, (value) => { value.authority = "tenant-forged"; }),
    missingMetadata: fixture("tools/list", undefined, (value) => { delete value.params._meta[DEVELOPER_MCP_META_KEYS.clientCapabilities]; }),
    extraMetadataMember: fixture("tools/list", undefined, (value) => { value.params._meta.tenantId = "tenant-forged"; }),
    listCursor: fixture("tools/list", undefined, (value) => { value.params.cursor = "not-supported-in-v1"; }),
    headerMethodMismatch: fixture("tools/list", (value) => { value[3] = ["Mcp-Method", "server/discover"]; }),
    unsupportedVersion: Object.freeze({ headers: Object.freeze(headers("tools/list", "2099-01-01")), request: Object.freeze(request("tools/list", "2099-01-01")) }),
    unexpectedNameBeforeUnsupportedVersion: fixture(
      "tools/list",
      (value) => value.push(["Mcp-Name", "workspace.list"]),
      (value) => { value.params._meta[DEVELOPER_MCP_META_KEYS.protocolVersion] = "2099-01-01"; },
    ),
    toolsCall: fixture("tools/call"),
    toolsCallWithRequiredName: fixture("tools/call", (value) => value.push(["Mcp-Name", "workspace.list"])),
    inputRequired: fixture("elicitation/create"),
    initialize: fixture("initialize"),
    caseChangedMethod: fixture("Tools/List"),
    hostileClientMetadata: fixture("tools/list", undefined, (value) => { value.params._meta[DEVELOPER_MCP_META_KEYS.clientInfo].tenantId = "tenant-forged"; }),
    multipleFailures: fixture("tools/list", (value) => { value.splice(0, 1); value.splice(1, 1); }, (value) => { value.id = null; }),
  }),
});
