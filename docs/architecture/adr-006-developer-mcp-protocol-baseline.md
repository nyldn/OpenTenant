# ADR-006: Developer MCP authority and protocol baseline

Status: Accepted

Date: 2026-07-31

## Context

OpenTenant has frozen the first Developer MCP slugs, profiles, tool field lists,
templates, consent intersection, and audit vocabulary. It has not exposed a
Developer MCP endpoint. The transport design previously cited MCP
`2025-06-18`; the stable protocol revision is now `2026-07-28`.

The new revision is a breaking protocol-era change. It removes the
`initialize`/`notifications/initialized` handshake and `Mcp-Session-Id`, moves
protocol version and client capabilities into every request, requires
`server/discover`, and makes Streamable HTTP requests independently routable.
It also requires standard method/name headers, deterministic cacheable lists,
`resultType` on results, and supports complete JSON Schema 2020-12. Multi
Round-Trip Requests replace server-initiated elicitation, while Roots, Sampling,
Logging, HTTP+SSE, and Dynamic Client Registration are deprecated.

Primary sources:

- [MCP `2026-07-28` stable release](https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28)
- [Protocol changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Canonical final schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/2026-07-28/schema/2026-07-28/schema.ts)

The official TypeScript packages reached `2.0.0` with this protocol revision.
That availability does not move protocol authority into an SDK or authorize a
route.

## Decision

1. Build the executable authority vocabulary before transport code. Effective
   authority is the intersection of an explicit immutable profile assignment,
   token scopes, and consented client scopes. Eligibility alone grants nothing.
2. Keep the package provider-neutral and free of runtime dependencies. A future
   protocol subpath or application composition root may pin the official MCP SDK
   after dependency and licence review; the authority core does not import it.
3. Target modern MCP `2026-07-28` only for the first Developer MCP route. Do not
   add a legacy initialization/session path merely for compatibility.
4. Treat request `_meta`, including `clientInfo`, as hostile descriptive input.
   Registered client identity for consent and audit comes from the verified
   token, never `_meta`.
   The required reserved keys are exactly
   `io.modelcontextprotocol/protocolVersion` and
   `io.modelcontextprotocol/clientCapabilities`; optional client and server
   implementation information uses the corresponding namespaced keys from the
   canonical final schema.
5. Make `server/discover` tenant-invariant and free of tool, template, or tenant
   enumeration. Permission-filtered `tools/list` may vary by current authority,
   but must be deterministic for the same authority, use `cacheScope: private`,
   and set `ttlMs` no higher than 60 seconds. HTTP responses remain `no-store`.
   Protocol `ttlMs` and `cacheScope` are direct members of each cacheable MCP
   result, not an OpenTenant wrapper object.
6. Use self-contained JSON Schema 2020-12 with bounded fields,
   `additionalProperties: false`, no external references, and bounded schema
   depth. Tool schemas never accept a tenant identifier, limits, network policy,
   template bytes, or approval digests.
7. Do not emit Multi Round-Trip or `input_required` results in v1. Consequential
   calls require a separately designed confirmation contract; hostile tool or
   sandbox output must not author user-facing questions.
8. Prefer pre-registered OAuth clients. Dynamic Client Registration remains a
   measured compatibility option only and is disabled for the first route.
9. Protected-resource metadata will publish one exact configured resource URL;
   it must never derive the audience from the request host. Inbound tokens are
   audience-bound to that resource and are never accepted for, or forwarded to,
   downstream services.
10. No Next.js Developer MCP route, successful `tools/call`, sandbox execution,
    provider call, deployment, or genuine tenant data is part of this decision.
    `OWNER-DEVELOPER-MCP-02` remains pending until every prerequisite has linked
    evidence.

## Consequences

- The first implementation slice is small, deterministic, and testable without
  network access or provider configuration.
- The protocol layer can consume a closed authority contract instead of
  inventing grants while parsing wire messages.
- The eventual route is stateless at the protocol layer but may use explicit,
  opaque, server-minted resource handles for workspace state.
- Supporting legacy MCP clients would require a separate decision and threat
  review; it is not an implicit fallback.
