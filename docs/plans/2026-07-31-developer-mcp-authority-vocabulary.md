# Developer MCP executable authority vocabulary

Status: Approved for unattended implementation

Date: 2026-07-31

## Objective

Encode the accepted Developer MCP authority freeze as a provider-neutral,
route-independent package before any protocol or application endpoint exists.
The package is a closed contract for later authentication, resource
authorization, protocol discovery, and audit composition; it executes no tool.

## Package boundary

Create `packages/developer-mcp` with no runtime dependencies and exports for
`.` and `./testing`.

- `slugs.ts`: the ten immutable permission slugs, risk classes, seven
  assignable slugs, and three
  unassignable v1 slugs.
- `profiles.ts`: immutable `@1` profiles. No assignment means empty authority;
  eligibility has no special grant.
- `authority.ts`: the exact intersection of assigned profile slugs, token
  scopes, and consented client scopes. Unknown or unassignable values fail
  closed and remain distinguishable in internal decision evidence.
- `revocation.ts`: a 60-second maximum stale-authority constant and synchronous
  policy for high-risk slugs.
- `tools.ts`: twelve immutable descriptors with name, slug, risk, resource type,
  and bounded request-field schema. Descriptors contain no handler or callable
  member.
- `catalog.ts`: deterministic permission-filtered discovery data with private
  cache scope and TTL no higher than the revocation bound.
- `audit.ts`: the closed Developer MCP audit field vocabulary; unexpected
  fields are rejected rather than silently discarded.

The existing `packages/auth` boundary remains identity-only. Do not add provider
roles, profile assignment, scopes, tool grants, or sandbox authority there.

## Acceptance criteria

1. The exported slug and profile snapshots exactly match the accepted freeze;
   the assignable and unassignable sets partition all ten slugs; and no profile
   contains an unassignable v1 slug or duplicates another profile's slug set.
2. Profile assignment, token scope, and client consent are a true set
   intersection. No assignment yields an empty set. Unknown and unassignable
   slugs never become effective authority.
3. `module.dev.build.execute` and `module.dev.preview.open` require synchronous
   revocation checks; no cache policy exceeds 60,000 milliseconds.
4. The twelve tool descriptors form a total surjection onto the seven
   assignable slugs: every descriptor has exactly one assignable slug, and every
   assignable slug has at least one descriptor.
5. No tool field accepts a tenant identifier. Every string and array is bounded,
   every enum is closed, and object schemas reject extra properties. Templates,
   limits, network policy, bytes, digests, and provider identifiers are absent
   from caller-controlled fields.
6. Tool discovery is byte-stable and name-sorted for the same effective
   authority. Empty authority returns an empty list, not an error. Cache scope
   is private.
7. The audit contract accepts only the section 6 field vocabulary and rejects
   unexpected keys. MCP `_meta` values are not audit fields.
8. No file under `apps/platform` imports `@opentenant/developer-mcp`, and the
   only existing application MCP route remains `app/api/mcp/brain/route.ts`.
9. No MCP SDK, Next.js route, successful tool call, sandbox/provider operation,
   deployment, or genuine tenant data is added.
10. Focused tests, the forced monorepo typecheck/lint/test matrix, the platform
    production build, diff integrity, and Graphify freshness pass.

## Verification design

Tests must snapshot the closed vocabularies, exercise denial cases before
implementation where practical, permute scope and descriptor order to prove
determinism, walk every request-field schema for boundedness, and scan the
application route surface. Test public functions and exported contracts rather
than implementation-private helpers.

## Follow-on sequence

1. Strict modern MCP `2026-07-28` protocol types, header/body validation,
   tenant-invariant discovery, permission-filtered list serialization, and
   conformance fixtures—still without a route or tool execution.
2. Per-call membership revocation and the provider-neutral local
   resource-authorization adapter.
3. Workspace/profile-assignment persistence, quotas, atomic audit composition,
   and the independent kill switch.
4. Sandbox connect-time resolved-address denial, no-ambient-credential proof,
   and authenticated preview controls.
5. Protected-resource metadata and a disabled-by-default route with no
   successful `tools/call`.
6. The first read-only tool only after `OWNER-DEVELOPER-MCP-02` is fully
   evidenced.
