# Developer MCP modern protocol contract

Status: Approved for unattended implementation

Date: 2026-07-31

## Objective

Encode the strict modern MCP `2026-07-28` request, transport-header,
discovery, and permission-filtered tool-list contracts inside the existing
dependency-free `@opentenant/developer-mcp` package. This slice produces pure,
route-independent validators, serializers, and conformance fixtures. It does
not create an HTTP endpoint or execute a tool.

Primary protocol sources:

- [MCP `2026-07-28` release](https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28)
- [Revision changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Canonical final TypeScript schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/2026-07-28/schema/2026-07-28/schema.ts)

ADR-006 remains authoritative where the protocol permits more than one safe
choice.

An independent `claude -p` architecture and security review on 2026-07-31
returned `REVISE`. This version resolves all four blocking findings: descriptor
descriptions now have an explicit source, error precedence is frozen, header
name casing has positive coverage, and public server discovery is named
separately from the existing private tool list.

## Frozen scope

The package supports exactly two request methods in this slice:

- `server/discover`
- `tools/list`

Every accepted request is JSON-RPC `2.0`, has a string or safe-integer ID, and
has a closed `params` object containing the required `_meta` object. `_meta`
must include `io.modelcontextprotocol/protocolVersion` with exact value
`2026-07-28` and a bounded
`io.modelcontextprotocol/clientCapabilities` object; bounded
`io.modelcontextprotocol/clientInfo` is optional. Client metadata is
descriptive hostile input and never supplies identity, consent, tenant, or
authority.

The request validator returns a closed success or structured failure value. It
must not throw client-controlled values into logs or interpolate unbounded
input into errors. The failure contract covers invalid request `-32600`,
invalid params `-32602`, header mismatch `-32020`, unsupported protocol version
`-32022`, and method not found `-32601`, with the protocol-required HTTP status
where one is defined.

Validation runs in exactly this order and stops at the first failure:

1. `Content-Type` and `Accept` presence and shape. Missing, duplicated, or
   malformed media-negotiation headers return bounded invalid request `-32600`
   with HTTP 400; they are not mirrored MCP headers.
2. Mirrored-header presence and shape. `MCP-Protocol-Version` and `Mcp-Method`
   must each be present exactly once under case-insensitive name comparison;
   missing, duplicated, or malformed values return header mismatch `-32020`
   with HTTP 400.
3. JSON-RPC envelope validity. Exact `2.0` framing, string or safe-integer ID,
   supported request shape, and closed `params` object are required; failures
   return invalid request `-32600` with HTTP 400.
4. Closed bounded `_meta` validity. Failures, including either missing required
   metadata member, return invalid params `-32602` with HTTP 400.
5. Header-to-body protocol-version and method mirror equality, followed by the
   supported-method `Mcp-Name` absence rule. A mismatch, or any `Mcp-Name` on
   `server/discover` or `tools/list`, returns header mismatch `-32020` with HTTP
   400. This stage precedes version and method support checks.
6. Supported protocol version. Any value other than `2026-07-28` returns
   unsupported protocol version `-32022` with HTTP 400 and bounded
   `{ supported: ["2026-07-28"], requested }` data.
7. Supported method. Any value other than `server/discover` or `tools/list`
   returns method not found `-32601` with HTTP 404.

Fixtures exercise every stage in isolation and at least one request where two
stages independently fail, proving that only the earlier failure is returned.

## Pure Streamable HTTP validation

Add no web framework, listener, handler, or route. A pure validator consumes a
duplicate-preserving ordered header collection plus an already-parsed request.
It enforces:

1. `Content-Type` is JSON and `Accept` lists both `application/json` and
   `text/event-stream`.
2. `MCP-Protocol-Version` and `Mcp-Method` are present exactly once, with
   case-insensitive header names and case-sensitive values. Repeating the same
   semantic name under different casing is still a duplicate and fails closed.
3. The mirrored protocol version and method match the request body. A mismatch
   is HTTP 400 with `-32020`.
4. Only `2026-07-28` is supported. An unsupported body/header version is HTTP
   400 with `-32022` and bounded supported/requested version data.
5. An unsupported method is HTTP 404 with `-32601`. `tools/call` is unsupported
   and cannot reach an execution path.
6. `Mcp-Name` is absent for the two supported methods. The package may expose
   the exact MCP Base64-sentinel codec as a separately tested pure utility, but
   this slice has no request that consumes `Mcp-Name` or `Mcp-Param-*`.
7. Legacy `Mcp-Session-Id` and `Last-Event-ID` headers have no semantic effect
   and are never copied into results. No `initialize`, notification, GET,
   DELETE, session, resumability, or legacy fallback contract is added.

Origin, authentication, authorization, response headers, POST-only routing,
HTTP `405` handling, and `no-store` are application-composition concerns for a
future disabled route and remain out of this package slice.

## Discovery result

Before adding `server/discover`, rename the existing `buildToolDiscovery`
function and `DEVELOPER_DISCOVERY_CACHE_POLICY` constant in
`packages/developer-mcp/src/catalog.ts` to `buildToolList` and
`DEVELOPER_TOOL_LIST_CACHE_POLICY`. Both serve `tools/list`, not
`server/discover`. Reserve `discover` and `discovery` names for the public,
tenant-invariant result in this section.

`server/discover` serialization is tenant-invariant and byte-stable. It returns
only these direct result members, with no OpenTenant cache wrapper:

- `resultType: "complete"`;
- `supportedVersions: ["2026-07-28"]`;
- a tools capability without `listChanged`;
- fixed bounded server information at
  `_meta["io.modelcontextprotocol/serverInfo"]`;
- `cacheScope: "public"` and `ttlMs: 60000`.

It must not enumerate tools, templates, tenants, profiles, slugs, resources,
providers, routes, account data, or environment details. It emits no
instructions whose wording could become an authority or security input.

## Permission-filtered tool list

`tools/list` projects the current authority-filtered non-callable descriptors
into MCP Tool objects. The direct result members include
`resultType: "complete"`, `cacheScope: "private"`, and `ttlMs` no higher than
the 60-second revocation bound; there is no separate cache wrapper. Empty
effective authority returns a complete empty list.

For the same effective authority and catalogue state, the serialized result is
byte-stable and sorted by exact tool name. Each wire tool includes only its
name, a bounded factual description, and a self-contained JSON Schema 2020-12
`inputSchema`. `DeveloperToolDescriptor` gains one required frozen
`description` string of 1-280 characters for every descriptor; this additive
wire-projection field does not reopen the frozen slug, input-schema, or template
surface. Internal slug, risk, resource, schema-version, and `enumSource` fields
never cross the protocol boundary. Every emitted schema includes exact
`$schema: "https://json-schema.org/draft/2020-12/schema"`, has bounded fields,
uses `additionalProperties: false`, and contains no external `$ref` or
`x-mcp-header`.

Any descriptor with an empty request-property `enum` is omitted from the wire
list; `enumSource` remains internal provenance, not the fail-closed trigger. In
particular, `contract.get` and
`build.run` remain undiscoverable until their server-owned catalogues contain
separately approved values. No caller supplies template bytes; the
already-approved server-owned `templateId` enum may be represented for
`workspace.create`.

The v1 list is small and complete in one response. Request cursors are rejected
rather than interpreted, and no `nextCursor` is emitted. This does not remove
pagination from MCP; it chooses no pagination for this bounded catalogue. The
`cursor` fields inside `workspace.list`, `contract.list`, and `evidence.list`
schemas paginate those future tools' own domain results and are unrelated to
the MCP-level `tools/list` request cursor rejected here.

## Conformance and testing boundary

Export deterministic fixtures through `@opentenant/developer-mcp/testing` for:

- the two valid request shapes and header sets;
- literal final-schema request and result shapes that do not reuse package key
  constants, preventing self-referential conformance tests;
- invalid JSON-RPC IDs and closed-object violations;
- missing and duplicated mirrored headers, including one semantic name repeated
  under different casing, plus mismatched or unsupported header values;
- differently cased header names accepted identically to canonical casing,
  proving header-name matching is case-insensitive while values remain
  case-sensitive;
- missing required request metadata and hostile optional client metadata;
- ignored legacy session/resume headers;
- tenant-invariant discovery and authority-varying deterministic tool lists;
- unresolved-catalogue omission and schema projection;
- exact `{ cacheScope: "public", ttlMs: 60000 }` discovery caching and private
  tool-list caching no higher than 60,000 milliseconds;
- explicit denial of `tools/call`, MRTR/input-required, and legacy methods.

Keep the existing application route-surface proof green: no file under
`apps/platform` imports `@opentenant/developer-mcp`, and
`app/api/mcp/brain/route.ts` remains the only application MCP route.

## Explicit exclusions

This task adds no MCP SDK or runtime dependency, authentication-provider
composition, OAuth or protected-resource metadata, Next.js route, successful
`tools/call`, handler registry, sandbox operation, provider call, network I/O,
deployment, genuine tenant data, MRTR, Roots, Sampling, Logging,
subscriptions, HTTP+SSE, or Dynamic Client Registration.

The next safe slice after this contract is per-call membership revocation and
provider-neutral resource authorization. Route enablement remains governed by
`OWNER-DEVELOPER-MCP-02` and cannot be inferred from protocol conformance.

## Verification

Run:

```bash
pnpm --filter @opentenant/developer-mcp test
pnpm --filter @opentenant/developer-mcp typecheck
pnpm --filter @opentenant/platform test
pnpm turbo typecheck lint test --force
pnpm turbo build --filter=@opentenant/platform --force
git diff --check
graphify check-update .
```
