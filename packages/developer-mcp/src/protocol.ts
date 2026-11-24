import { MAX_AUTHORITY_STALENESS_MS } from "./revocation";

export const DEVELOPER_MCP_PROTOCOL_VERSION = "2026-07-28" as const;
export const DEVELOPER_MCP_METHODS = Object.freeze(["server/discover", "tools/list"] as const);
export const DEVELOPER_MCP_META_KEYS = Object.freeze({
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const);

export type DeveloperMcpHeader = readonly [name: string, value: string];

type FailureCode = -32600 | -32602 | -32020 | -32022 | -32601;
type ValidationFailure = Readonly<{
  ok: false;
  error: Readonly<{
    code: FailureCode;
    message: string;
    httpStatus: 400 | 404;
    data?: Readonly<Record<string, unknown>>;
  }>;
}>;

function failure(code: FailureCode, message: string, httpStatus: 400 | 404, data?: Record<string, unknown>): ValidationFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, httpStatus, ...(data === undefined ? {} : { data: Object.freeze(data) }) }),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string")
    && keys.length === allowed.length
    && keys.every((key) => allowed.includes(key as string));
}

const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const headerValuePattern = /^[\t\x20-\x7E]*$/;

function parseHeaders(value: unknown): readonly DeveloperMcpHeader[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed: DeveloperMcpHeader[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== "string" || entry[0].length < 1 || entry[0].length > 128
      || !headerNamePattern.test(entry[0])
      || typeof entry[1] !== "string" || entry[1].length > 8_192) {
      return null;
    }
    parsed.push([entry[0], entry[1]]);
  }
  return parsed;
}

function headerValues(headers: readonly DeveloperMcpHeader[], name: string): string[] {
  const lower = name.toLowerCase();
  return headers.filter(([candidate]) => candidate.toLowerCase() === lower).map(([, value]) => value);
}

function validMediaHeaders(headers: readonly DeveloperMcpHeader[]): boolean {
  const contentTypes = headerValues(headers, "Content-Type");
  const accepts = headerValues(headers, "Accept");
  if (contentTypes.length !== 1 || accepts.length !== 1
    || !headerValuePattern.test(contentTypes[0] ?? "")
    || !headerValuePattern.test(accepts[0] ?? "")) return false;
  const contentType = contentTypes[0]?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json"
    && acceptsMediaType(accepts[0] ?? "", "application/json")
    && acceptsMediaType(accepts[0] ?? "", "text/event-stream");
}

function acceptsMediaType(value: string, expected: string): boolean {
  for (const rawEntry of value.split(",")) {
    const [rawType, ...rawParameters] = rawEntry.split(";");
    if (rawType?.trim().toLowerCase() !== expected) continue;
    let quality = 1;
    for (const parameter of rawParameters) {
      const [rawName, rawValue] = parameter.split("=", 2);
      if (rawName?.trim().toLowerCase() !== "q") continue;
      const normalized = rawValue?.trim() ?? "";
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(normalized)) return false;
      quality = Number(normalized);
    }
    return quality > 0;
  }
  return false;
}

function validClientInfo(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const allowed = ["name", "title", "version", "description", "websiteUrl", "icons"];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")
    || !keys.every((key) => allowed.includes(key as string))) return false;
  if (!(typeof value.name === "string" && value.name.length >= 1 && value.name.length <= 80)
    || !(typeof value.version === "string" && value.version.length >= 1 && value.version.length <= 40)) return false;
  if (value.title !== undefined && !(typeof value.title === "string" && value.title.length <= 160)) return false;
  if (value.description !== undefined && !(typeof value.description === "string" && value.description.length <= 512)) return false;
  if (value.websiteUrl !== undefined && !(typeof value.websiteUrl === "string" && value.websiteUrl.length <= 2_048)) return false;
  return value.icons === undefined || validIcons(value.icons);
}

function validIcons(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 8) return false;
  return value.every((icon) => {
    if (!isPlainRecord(icon)) return false;
    const keys = Reflect.ownKeys(icon);
    if (keys.some((key) => typeof key !== "string")
      || !keys.every((key) => ["src", "mimeType", "sizes", "theme"].includes(key as string))) return false;
    return typeof icon.src === "string" && icon.src.length >= 1 && icon.src.length <= 2_048
      && (icon.mimeType === undefined || typeof icon.mimeType === "string" && icon.mimeType.length <= 128)
      && (icon.sizes === undefined || Array.isArray(icon.sizes) && icon.sizes.length <= 16
        && icon.sizes.every((size) => typeof size === "string" && size.length >= 1 && size.length <= 32))
      && (icon.theme === undefined || icon.theme === "light" || icon.theme === "dark");
  });
}

function validBoundedJson(value: unknown, depth: number, budget: { remaining: number }): boolean {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > 6) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 1_024;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 32 && value.every((entry) => validBoundedJson(entry, depth + 1, budget));
  }
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length <= 32
    && keys.every((key) => typeof key === "string" && key.length >= 1 && key.length <= 128)
    && Object.values(value).every((entry) => validBoundedJson(entry, depth + 1, budget));
}

function validCapabilities(value: unknown): boolean {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length > 16) return false;
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  const budget = { remaining: 256 };
  return Object.entries(value).every(([key, capability]) => key.length >= 1 && key.length <= 128
    && isPlainRecord(capability) && validBoundedJson(capability, 0, budget));
}

function validMeta(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const keys = ownKeys as string[];
  const allowed = Object.values(DEVELOPER_MCP_META_KEYS).filter((key) => key !== DEVELOPER_MCP_META_KEYS.serverInfo);
  if (!keys.every((key) => allowed.includes(key as (typeof allowed)[number]))) return false;
  const version = value[DEVELOPER_MCP_META_KEYS.protocolVersion];
  const capabilities = value[DEVELOPER_MCP_META_KEYS.clientCapabilities];
  const clientInfo = value[DEVELOPER_MCP_META_KEYS.clientInfo];
  if (!keys.includes(DEVELOPER_MCP_META_KEYS.protocolVersion)
    || !keys.includes(DEVELOPER_MCP_META_KEYS.clientCapabilities)) return false;
  return typeof version === "string" && version.length >= 1 && version.length <= 32
    && validCapabilities(capabilities)
    && (clientInfo === undefined || validClientInfo(clientInfo));
}

function cloneFrozenJson(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozenJson));
  if (isPlainRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneFrozenJson(entry)])));
  }
  return value;
}

export function validateDeveloperMcpRequest(headerInput: unknown, request: unknown) {
  const headers = parseHeaders(headerInput);
  if (headers === null || !validMediaHeaders(headers)) {
    return failure(-32600, "Invalid media negotiation headers", 400);
  }
  const protocolHeaders = headerValues(headers, "MCP-Protocol-Version");
  const methodHeaders = headerValues(headers, "Mcp-Method");
  if (protocolHeaders.length !== 1 || methodHeaders.length !== 1
    || !protocolHeaders[0] || protocolHeaders[0].length > 32
    || !methodHeaders[0] || methodHeaders[0].length > 64
    || !headerValuePattern.test(protocolHeaders[0])
    || !headerValuePattern.test(methodHeaders[0])) {
    return failure(-32020, "MCP header mismatch", 400);
  }
  if (!isPlainRecord(request) || !hasExactKeys(request, ["jsonrpc", "id", "method", "params"])
    || request.jsonrpc !== "2.0"
    || !(typeof request.id === "string" && request.id.length <= 128
      || typeof request.id === "number" && Number.isSafeInteger(request.id))
    || typeof request.method !== "string" || request.method.length < 1 || request.method.length > 64
    || !isPlainRecord(request.params) || !hasExactKeys(request.params, ["_meta"])) {
    return failure(-32600, "Invalid JSON-RPC request", 400);
  }
  if (!validMeta(request.params._meta)) {
    return failure(-32602, "Invalid request metadata", 400);
  }
  const version = request.params._meta[DEVELOPER_MCP_META_KEYS.protocolVersion] as string;
  if (protocolHeaders[0] !== version || methodHeaders[0] !== request.method) {
    return failure(-32020, "MCP header mismatch", 400);
  }
  if ((DEVELOPER_MCP_METHODS as readonly string[]).includes(request.method)
    && headerValues(headers, "Mcp-Name").length !== 0) {
    return failure(-32020, "MCP header mismatch", 400);
  }
  if (version !== DEVELOPER_MCP_PROTOCOL_VERSION) {
    return failure(-32022, "Unsupported MCP protocol version", 400, {
      supported: Object.freeze([DEVELOPER_MCP_PROTOCOL_VERSION]),
      requested: version,
    });
  }
  if (!(DEVELOPER_MCP_METHODS as readonly string[]).includes(request.method)) {
    return failure(-32601, "Method not found", 404);
  }
  const clientInfo = request.params._meta[DEVELOPER_MCP_META_KEYS.clientInfo];
  const normalizedMeta = Object.freeze({
    [DEVELOPER_MCP_META_KEYS.protocolVersion]: version,
    [DEVELOPER_MCP_META_KEYS.clientCapabilities]: cloneFrozenJson(
      request.params._meta[DEVELOPER_MCP_META_KEYS.clientCapabilities],
    ),
    ...(clientInfo === undefined
      ? {}
      : { [DEVELOPER_MCP_META_KEYS.clientInfo]: cloneFrozenJson(clientInfo) }),
  });
  const normalizedRequest = Object.freeze({
    jsonrpc: "2.0" as const,
    id: request.id,
    method: request.method,
    params: Object.freeze({ _meta: normalizedMeta }),
  });
  return Object.freeze({ ok: true, request: normalizedRequest });
}

export const DEVELOPER_SERVER_DISCOVERY_CACHE_POLICY = Object.freeze({
  cacheScope: "public",
  ttlMs: MAX_AUTHORITY_STALENESS_MS,
} as const);

const SERVER_DISCOVERY = Object.freeze({
  resultType: "complete",
  supportedVersions: Object.freeze([DEVELOPER_MCP_PROTOCOL_VERSION]),
  capabilities: Object.freeze({ tools: Object.freeze({}) }),
  _meta: Object.freeze({
    [DEVELOPER_MCP_META_KEYS.serverInfo]: Object.freeze({ name: "OpenTenant Developer MCP", version: "1" }),
  }),
  ttlMs: DEVELOPER_SERVER_DISCOVERY_CACHE_POLICY.ttlMs,
  cacheScope: DEVELOPER_SERVER_DISCOVERY_CACHE_POLICY.cacheScope,
});

export function buildServerDiscovery() {
  return SERVER_DISCOVERY;
}

export function serializeServerDiscovery(): string {
  return JSON.stringify(SERVER_DISCOVERY);
}
