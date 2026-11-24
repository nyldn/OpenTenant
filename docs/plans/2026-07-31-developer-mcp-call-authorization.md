# Developer MCP per-call authorization contract

Status: Approved for unattended implementation

Date: 2026-07-31

## Objective

Add a dependency-free, route-independent Developer MCP call-authorization
contract that recomputes the already-frozen authority decision from a bounded
server snapshot, combines it with per-call revocation evidence and
provider-neutral resource authorization. The slice
defines one named enforcement point for future tool calls, but it does not add
`tools/call`, a handler registry, an application route, a workspace store, or
any executable operation.

Authoritative inputs:

- [Developer MCP authority vocabulary freeze](../product/developer-mcp-authority-freeze.md),
  especially sections 3, 5, 9.2, 9.6, and 10;
- [Developer MCP threat model](../security/developer-mcp-threat-model.md),
  especially `TM-002` and `TM-007`;
- [Developer MCP PRD](../product/developer-mcp.md), especially `FR-001` and
  `FR-002`; and
- [ADR-006](../architecture/adr-006-developer-mcp-protocol-baseline.md).

This plan implements another prerequisite behind
`OWNER-DEVELOPER-MCP-02`; it does not satisfy or close the owner gate.

An initial independent `claude -p` architecture and security review returned
`REVISE` for a revoked-principal ownership oracle, unbounded staleness of a
precomputed authority decision, ambiguous resource-type denial, self-reported
live evidence, and missing adversarial cases. This revision checks revocation
before resource lookup, recomputes authority from a timestamp-bounded raw
snapshot, gives resource-type mismatch the identical denial, requires a second
high-risk live check, records the concrete-adapter proof boundary, and adds the
missing tests. The second independent review returned `SHIP` with no remaining
blocking or serious findings.

## Existing contracts to preserve

- `resolveEffectiveAuthority` remains the only package function that intersects
  explicit profile assignment, token scopes, and consented client scopes.
- `requiresSynchronousRevocationCheck` remains authoritative for risk routing:
  `module.dev.build.execute` and `module.dev.preview.open` are high risk, and an
  unknown slug defaults to synchronous revalidation.
- `DEVELOPER_TOOL_DESCRIPTORS` remains the source of the exact tool, slug, risk,
  and resource-type relationship. The new enforcement point must not accept a
  caller-supplied replacement descriptor.
- The maximum stale-authority window remains 60,000 milliseconds. No authority
  source snapshot, decision, adapter result, or documentation in this slice may
  widen it.
- The audit vocabulary remains unchanged. This slice may return the bounded
  fields a later atomic audit integration will need, but it does not append an
  audit event.

## Named enforcement point

Add `authorizeDeveloperMcpCall` inside `@opentenant/developer-mcp`. It consumes
only server-composed inputs:

- exact tool name;
- a bounded authority-source snapshot containing the exact
  `AuthorityResolutionInput` fields plus `resolvedAtMs`;
- a verified principal containing bounded `tenantId`, `userId`, and registered
  `clientId` strings; and
- a server-resolved resource reference containing the descriptor's exact
  `resourceType` plus one 128-bit opaque lowercase-hex resource ID.

The authority source snapshot is a server-side reading of the current explicit
profile assignment, token scopes, and registered-client consent scopes. The
gate rejects a non-finite, future, or more-than-60-second-old `resolvedAtMs`,
then calls `resolveEffectiveAuthority` itself. It never accepts a caller-built
`AuthorityDecision`, so a structurally forged decision cannot bypass the
three-way intersection. A profile downgrade or scope narrowing may remain
visible only for the accepted 60-second maximum and never indefinitely.

No MCP request field can supply or override authority inputs, timestamp,
tenant, user, client, slug, risk, profile, resource type, or resource ownership.
A future composition root must resolve the resource behind an opaque request
identifier before invoking this function. For example, `evidence.get` must
resolve an evidence identifier to its owning workspace; it cannot relabel the
evidence identifier itself as a workspace.

The function returns a deeply immutable closed decision. An allowed decision
contains only the descriptor-derived tool, slug, risk, resource type, the
copied opaque resource ID, profile version, and revocation evidence required by
the audit vocabulary. It is not a bearer credential, durable grant, handler,
or execution callback. A denied decision contains exactly
`{ status: "denied", code }`, uses one bounded internal denial code, and never
carries adapter errors, provider data, resource metadata, or hostile caller
strings.

## Exact decision order

The enforcement point evaluates in this order and stops at the first denial:

1. Validate the closed principal, authority-source snapshot, and resource-
   reference shapes. Strings are printable, trimmed, and bounded; the resource
   ID is exactly 32 lowercase hexadecimal characters. Reject an authority
   snapshot whose `resolvedAtMs` is non-finite or in the future with
   `invalid_context`; an otherwise-valid snapshot older than
   `MAX_AUTHORITY_STALENESS_MS` returns `authority_missing`.
2. Resolve the tool only from `DEVELOPER_TOOL_DESCRIPTORS`. Unknown tools deny.
3. Call `resolveEffectiveAuthority` on the bounded source snapshot. Require an
   assigned known profile and the tool's exact slug in the returned
   `effectiveSlugs`. Do not infer authority from the profile name, descriptor,
   eligibility, revocation result, feature flag, or adapter.
4. Require the supplied resource type to equal the descriptor's resource type.
   A mismatch returns `resource_denied`, exactly like step 6.
5. Revalidate membership, registered-client consent, and MCP session/token
   authority in `per_call` mode before any resource lookup. Adapter exceptions,
   any non-active result, and stale or future evidence return `revoked`. This
   prevents a revoked principal from using denial codes or adapter timing to
   probe which opaque resources exist or belong to it.
6. Ask the provider-neutral resource adapter for an opaque allow/deny decision.
   Adapter exceptions collapse to the same resource denial as missing,
   foreign-tenant, nonexistent, malformed-relation, or ungranted resources.
7. For a high-risk tool only, revalidate again in `synchronous_high_risk` mode
   after resource authorization and immediately before allow. Adapter
   exceptions, non-active results, stale/future evidence, or any source other
   than explicit `live` return `revoked`. Cached evidence cannot authorize a
   high-risk call.
8. Return the immutable allowed decision. Any future executable composition
   must invoke this point immediately before dispatch and must not cache or
   replay the returned value.

The revocation adapter's active result means the verified user membership,
registered client consent, and MCP session/token authority are still active for
the tenant. The package does not query an identity provider or invent provider
claims. The mode tells an adapter whether a current bounded snapshot is
permitted or a live check is mandatory.

This order avoids provider or resource work for malformed and unscoped calls,
prevents revoked principals from reaching the resource adapter, keeps the
second high-risk revalidation closest to a future dispatch boundary, and
ensures no adapter can create a permission grant.

## Provider-neutral revocation port

Define `DeveloperMcpRevocationAdapter` with one method receiving only the
bounded verified principal, required slug, and mode:

- `per_call` for every supported tool; or
- `synchronous_high_risk` as an additional final check for high risk.

It returns either a generic revoked result or an active result with
`checkedAtMs` and `source: "live" | "cache"`. The public result does not name
WorkOS, Clerk, a provider event, a token, a group, or a raw reason. The gate
validates freshness independently instead of trusting adapter cache policy.

Every otherwise-authorizable attempt calls this adapter once in `per_call`
mode. High-risk attempts call it a second time in `synchronous_high_risk` mode
after resource authorization. Tests use a stateful fake to prove that a later
call is denied after membership, consent, or session revocation without
changing the still-fresh authority-source snapshot.

The `source` value is adapter evidence, not independent proof that a provider
was contacted. This pure slice cannot close the live-provider part of `TM-007`.
Every future concrete adapter needs its own conformance proof that
`synchronous_high_risk` bypasses caches and performs the documented current-
state check; self-reporting `source: "live"` alone is insufficient route-
enablement evidence.

## Provider-neutral resource port

Define `DeveloperMcpResourceAuthorizationAdapter` with one method receiving
the bounded verified principal, exact descriptor slug, and resource reference.
It returns only `allowed` or `denied`. It cannot return a slug, tenant, role,
profile, or widened authority, and the enforcement point never accepts such
fields.

Also provide a dependency-free immutable local-snapshot reference adapter for
conformance tests and local composition. Its inputs are bounded server-owned
records and grants:

- `module_project`: opaque ID plus tenant ID;
- `module_workspace`: opaque ID, tenant ID, and parent project ID; and
- a user grant: user ID, exact resource reference, and a closed set of
  assignable slugs.

An exact resource grant may authorize that resource. A project grant may
authorize a child workspace only when the stored parent relation and tenant
both match. No inheritance crosses tenant, parent, user, resource type, or
slug. Client authority remains controlled by the existing consent
intersection; the local resource relation is user/resource-scoped.

The reference adapter validates and defensively copies its trusted snapshot at
construction, rejects duplicate `(resourceType, resourceId)` keys, dangling or
cross-tenant parent links, unknown/unassignable grant slugs, duplicate grants,
and excessive collections, and never mutates afterward. Its runtime response is deliberately
indistinguishable for nonexistent, foreign, ungranted, and malformed targets.
It is not a persistent workspace store and is not represented as production
FGA evidence. A future PostgreSQL or WorkOS FGA implementation must conform to
the same port; provider object names never become the canonical vocabulary.

## Closed denial semantics

Internal denial codes are exactly:

- `invalid_context`;
- `unknown_tool`;
- `authority_missing`;
- `resource_denied`; and
- `revoked`.

These values support deterministic tests and later audit outcome selection.
They are not a protocol error body. In particular, all resource lookup and
ownership failures, including descriptor/resource-type mismatch before adapter
dispatch, use the identical `resource_denied` decision, preserving the authority
freeze's requirement that an identifier not become an ownership oracle.

## Required tests

Add focused package tests that prove:

- every frozen descriptor can be evaluated only with its descriptor-derived
  slug, risk, and resource type;
- a stale, future, or malformed authority-source snapshot denies, while a fresh
  snapshot is recomputed inside the gate and cannot inject a pre-built
  `AuthorityDecision`;
- a profile or scope narrowing becomes effective once the prior source snapshot
  reaches the 60-second bound, even if revocation remains active;
- an assigned profile without the exact effective slug denies, while a matching
  authority cannot bypass membership or resource checks;
- a revoked user/client/session denies a subsequent call even when the caller
  reuses the same still-fresh authority-source snapshot;
- a revoked principal receives the identical `revoked` decision for an owned
  and an unowned resource, and the resource adapter is not invoked in either
  case;
- low/medium calls request one `per_call` check; high-risk calls request
  `per_call` before resource authorization and `synchronous_high_risk` after it,
  and reject cached evidence at the second check;
- stale, future, malformed, thrown, and revoked revocation results fail closed;
- adapter exceptions are bounded and never enter decisions;
- resource-type mismatch before adapter dispatch and ownership mismatch inside
  the adapter produce bit-for-bit identical `resource_denied` decisions;
- exact resource grants and valid same-tenant project-to-workspace inheritance
  allow, while wrong tenant, user, parent, resource type, slug, unknown ID, and
  prefix-confusion cases deny identically;
- two different resource types may use the same opaque ID without collision;
  all records and grants are keyed by `(resourceType, resourceId)`;
- invalid or duplicate local snapshots fail at construction without retaining
  mutable caller objects;
- all returned decisions, resource records, grant lists, and nested collections
  are defensively copied and frozen;
- no allowed decision contains a handler, token, callback, provider, raw
  adapter result, tenant-supplied metadata, or executable value; and
- the application route-surface proof stays green: `apps/platform` still does
  not import the package and no successful Developer MCP route or `tools/call`
  path exists.

## Documentation and product truth

On completion:

- update `docs/HANDOFF.md` and `docs/SHIPLOG.md` with exact evidence and limits;
- move this slice from README's next-safe list to available foundations and
  name the next bounded prerequisite without implying route readiness;
- leave `OWNER-DEVELOPER-MCP-02` pending and do not edit its acceptance
  criteria; and
- classify marketing impact as `truth`, because Developer MCP foundation and
  verification facts change while public maturity remains `foundation-only`
  and successful tool routes remain zero.

## Explicit exclusions

This slice adds no MCP SDK, HTTP handler, Next.js route, `tools/call` parser,
tool handler registry, successful tool response, workspace persistence,
database migration, provider SDK or API call, protected-resource metadata,
OAuth challenge, feature flag, rate/quota/spend control, job lifetime,
idempotency, audit append, sandbox operation, preview exchange, output
redaction, publication path, deployment, or genuine tenant data. It does not
close `TM-001`, `TM-009`, or the other route-enablement prerequisites.

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
