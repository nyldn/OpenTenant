# Developer MCP authority vocabulary freeze, v3.1

Status: **Accepted 2026-07-31.** Satisfies `OWNER-DEVELOPER-MCP-01`.

This document freezes vocabulary, schemas, profiles, templates, and the initial
owner decisions. Route enablement is a separate gate,
`OWNER-DEVELOPER-MCP-02`, defined in section 9 and not satisfiable today.

Date: 2026-07-31

Revision: v3.1, after protocol research and two adversarial reviews. Sections
11 through 13 record what changed and why.

Decision owner: Chris

## 0. What this freezes, and what it deliberately does not

Freezes now, because WorkOS treats permission slugs as immutable contracts and
the decision must precede configuration:

- permission slugs (section 1)
- versioned profiles and group mapping (section 2)
- tool schemas with complete field lists (section 3)
- template registry (section 4)
- identity and consent model (section 5)

The owner settled four decisions on 2026-07-31:

- developer eligibility alone grants no profile or slug;
- active authority may be cached for at most 60 seconds, while high-risk calls
  synchronously recheck revocation immediately before execution;
- the two-template registry in section 4 remains the complete v1 registry; and
- resource authorization launches behind a provider-neutral local adapter with
  a documented migration path to WorkOS FGA.

Still **not** decided here, each naming where it belongs:

| Undecided | Belongs to |
| --- | --- |
| Repository ownership model | PRD open decision 1 |
| Any brokered tenant-data capability | A later capability freeze, after the `TM-003` probe |
| Publication approver separation | Undesigned; `TM-010` remains unmitigated |

The first review of this document claimed to satisfy the whole gate while three
of four preconditions were unmet. That coupling was the defect: accepting a
vocabulary freeze would have retired the gate that blocks route exposure while
`TM-001` and `TM-007`, both High, stayed open. Hence the split.

## 1. Permission slugs, frozen

Immutable once frozen. A capability change is a new slug, never a redefinition.

| Slug | Grants | Risk |
| --- | --- | --- |
| `module.dev.workspace.read` | List and read own tenant-bound workspaces | low |
| `module.dev.workspace.create` | Create a workspace from an approved template | **medium** |
| `module.dev.workspace.lifecycle` | Resume, snapshot, archive an owned workspace | **medium** |
| `module.dev.contract.read` | Read platform contracts reachable by the caller's own slugs | low |
| `module.dev.build.execute` | Run the template's fixed command set in the sandbox | **high** |
| `module.dev.preview.open` | Open an authenticated, tenant-bound, expiring preview | **high** |
| `module.dev.evidence.read` | Read validation and build evidence for owned workspaces | low |
| `module.dev.publish.propose` | Submit a version for human publication review | medium, **unassignable in v1** |
| `module.dev.publish` | Approve a publication proposal | high, **unassignable in v1** |
| `module.dev.infrastructure.approve` | Approve a declarative infrastructure request | high, **unassignable in v1** |

### 1.1 Risk class is a control, not a label

The previous revision classed every tool medium or low, which silently detached
PRD FR-001's requirement that "high-risk tools synchronously validate revocation
state before execution" from every tool. `build.execute` is the primitive
`TM-003` and `TM-004` hang on and `preview.open` is `TM-005`; all are High in the
threat model, so both slugs are now high.

High risk buys, and is defined as: synchronous revocation validation before
execution, an audit record with the full field set from section 6, and client
confirmation for the call.

### 1.2 Unassignable slugs

`module.dev.publish.propose`, `module.dev.publish`, and
`module.dev.infrastructure.approve` are named so the authorization layer can
deny and log them explicitly. An unnamed authority gets invented ad hoc later;
a named one can be refused.

Because no v1 tool requires any of them, the denial path would otherwise ship
unexercised. Therefore:

- all three are marked unassignable in v1 and refused by the provider-neutral
  authority package;
- the future persistent assignment boundary must repeat that denial as a
  **database constraint**, not convention;
- the profile map is the **only** grant path. No admin API, seed script or
  migration may attach a slug outside it;
- a negative test asserts that granting any one of them fails closed.

Publication is disabled. **Approver separation is undesigned and `TM-010`
remains unmitigated.** The earlier claim that "no profile can approve its own
proposal" was vacuous, since nothing can approve anything, and it would have
misled a future editor into thinking separation of duties already existed.

## 2. Profiles, versioned and immutable

Slug immutability is worthless if profiles are mutable, because authority is
granted by profile. Editing `developer.builder` to include `publish` would break
no stated rule and would quietly falsify section 1.2.

Therefore profiles are **versioned immutable objects**. This approval freezes
`@1` of each. Any content change is a new version requiring the same owner
approval; assignments name a version; and every audit record carries the profile
version that authorized the call.

| Profile | Slugs | Holder |
| --- | --- | --- |
| `developer.readonly@1` | `workspace.read`, `contract.read`, `evidence.read` | Explicit assignment only; eligibility alone grants nothing |
| `developer.builder@1` | readonly, plus `workspace.create`, `workspace.lifecycle`, `build.execute`, `preview.open` | A named tenant developer |

`developer.proposer` is a reserved profile name with no frozen version. Its
first version requires owner approval and cannot precede a publication approver
design that closes `TM-010`.

Group mapping is keyed on the **stable IdP group identifier**, never the group
name, which is what makes the rename-safety claim true rather than aspirational.
A group maps to exactly one profile version. Grant and mapping changes are
audited, not only calls.

Where an IdP group controls an assignment, the platform records it as
IdP-controlled and does not promise a conflicting manual assignment persists.

## 3. Tool schemas, with field lists

The previous revision froze nine names and five rules and claimed to freeze
schemas. It froze nothing versionable. Concretely, `SandboxCreateRequest`
(`packages/sandbox/src/contracts.ts:56`) accepts `limits` and `network` from its
caller, so an unwritten `workspace.create` schema decided whether
`workspace.create` silently carried egress-policy and spend authority. That is
infrastructure mutation in the only sense that matters, inside a document whose
section 8 disclaims it.

**Universal rules, server-enforced:**

- No tool accepts a tenant identifier. Tenant derives from the verified token and
  the trusted host binding, per `authenticateDeveloperMcpRequest`
  (`packages/auth/src/developer-mcp.ts:126`). This is the `TM-002` mitigation.
- `limits` and `network` are **template-pinned and server-derived**. They are
  not arguments on any tool.
- Identifiers are **128-bit CSPRNG opaque globals**. Unauthorized and
  nonexistent return an **identical** response, so no tool is an ownership
  oracle. Every identifier-bearing tool is rate limited per tenant.
- Every string has a maximum length, every array a maximum length, every enum is
  closed. An unbounded typed field is a decoding channel.
- Discovery returns only tools whose slug the caller currently holds.
- Schema version is explicit; the server accepts exactly one version per release.

| Tool | Slug | Request fields | Resource |
| --- | --- | --- | --- |
| `workspace.list` | `workspace.read` | `cursor?: string(≤128)`, `limit?: int(1..50)` | module_project |
| `workspace.get` | `workspace.read` | `workspaceId: opaque(32 hex)` | module_workspace |
| `workspace.create` | `workspace.create` | `templateId: enum(section 4)`, `label: string(≤64)` | module_project |
| `workspace.resume` | `workspace.lifecycle` | `workspaceId: opaque(32 hex)` | module_workspace |
| `workspace.snapshot` | `workspace.lifecycle` | `workspaceId: opaque(32 hex)`, `label: string(≤64)` | module_workspace |
| `workspace.archive` | `workspace.lifecycle` | `workspaceId: opaque(32 hex)` | module_workspace |
| `contract.list` | `contract.read` | `cursor?: string(≤128)`, `limit?: int(1..50)` | module_project |
| `contract.get` | `contract.read` | `contractId: enum(server catalogue)` | module_project |
| `build.run` | `build.execute` | `workspaceId: opaque(32 hex)`, `command: enum(template's fixed set)` | module_workspace |
| `preview.open` | `preview.open` | `workspaceId: opaque(32 hex)` | module_workspace |
| `evidence.list` | `evidence.read` | `workspaceId: opaque(32 hex)`, `cursor?: string(≤128)` | module_workspace |
| `evidence.get` | `evidence.read` | `evidenceId: opaque(32 hex)` | module_workspace |

**Authority-surface invariant (v1).** Every slug in section 1 is exactly one of
assignable or unassignable. There is no third category, and no slug is exempt as
"future-only." Each of the seven assignable slugs is required by at least one
of the twelve tools in this section, and every tool requires exactly one
assignable slug. The relation is a total surjection from tools onto assignable
slugs, not a bijection: `workspace.read`, `workspace.lifecycle`,
`contract.read`, and `evidence.read` each back more than one tool by design. The
three unassignable slugs have no tool, appear in no frozen profile version, and
are refused at the assignment boundary.

**Resource types align with PRD 6.4's immutable FGA hierarchy**
(`module_project` → `module_workspace`, `module_version`). The previous
`tenant`/`workspace`/`contract` vocabulary could not express phase 3, where
publication and preview authorization must hang off `module_version`.
`module_version` is reserved here and unused until publication is designed.

### 3.1 Response bounding

`build.run` and `evidence.get` are the only channels by which sandbox output
reaches a caller. Both cap response bytes, and both pass output through
redaction before return: token-shaped strings, provider error bodies and
environment-looking values are removed at the boundary. This is `TM-006`, which
the previous revision did not mention at all.

## 4. Template registry, frozen

Server-owned identifiers. A workspace may only originate from a registry entry;
an arbitrary repository or URL is not a template.

| Identifier | Contents |
| --- | --- |
| `opentenant/module-ui-next@1` | Next.js starter, Tailwind v4, semantic tenant-brand tokens, official shadcn/ui namespace only |
| `opentenant/module-service@1` | Headless module service on the module SDK, no UI |

Each pins SDK, runtime, lint, test and manifest versions, a frozen lockfile, and
the fixed command set `build.run` selects from. Install scripts denied by
default. Studio and private registries absent from the distributable baseline.

Templates are **never mutated in place**, because a mutated template
retroactively changes what past evidence attested to. A change is a new
identifier.

## 5. Identity, consent, and effective authority

The previous revision assigned authority to users through profiles and never
mentioned the MCP client, although the actor holding these tools is an agent
client and PRD 6.1 requires per-client, per-user consent.

**Effective authority is the intersection of three sets:** the profile version's
slugs, the OAuth token's granted scope, and the client's consented scope. A slug
absent from the token scope is denied even when the profile carries it.

This matters because `packages/auth/src/workos/developer-mcp.ts:41` deliberately
drops scopes with the note that "OAuth scopes and provider roles do not become
capability grants here." Read alone, an implementer concludes scope is ignored
and a narrowly consented token exercises the full profile. Intersection, not
substitution.

Client identity is a first-class principal: it appears in every audit record,
consent is per client, and revocation can target a client without touching the
user.

Request-scoped MCP `_meta` is hostile client input. Its `clientInfo` value may
describe client software for protocol interoperability, but it never establishes
the client principal, changes effective authority, or enters the audit record.
Authorization and audit client identity derive only from the verified,
pre-registered client claim.

## 6. Audit vocabulary

`TM-009` names `PgAuditStore.appendWithClient` serializing arbitrary caller
values as a required composition-boundary control. Developer MCP authorization
audit schema v2 therefore has one **closed field allowlist**: the original tool
name, schema version, slug, profile version, client id, user id, tenant id,
resource type and id, risk class, authorization decision, revocation-check
result, outcome, correlation id, and prior/current digest fields, plus
`contextResolution` and `decisionCode`. No caller-supplied field enters the
record. Version 1 records are not accepted as version 2.

`contextResolution` records the progressive trust boundary. `unresolved` is
only `invalid_context`: all named tool, profile, actor, resource, and risk
identity is null. `principal` retains the validated client, user, tenant, and
requested resource for timestamp-invalid `invalid_context`, `unknown_tool`, or
pre-descriptor stale `authority_missing`, while tool, slug, profile, and risk
remain null. `complete` retains the validated actor/resource identity and the
resolved descriptor's tool, slug, and risk for `allowed`, `authority_missing`,
`resource_denied`, or `revoked`. Null means that the named identity was not
validated at that decision stage; it never means an unknown, default, or
fallback tenant.

The v2 decision vocabulary is exactly `allowed`, `invalid_context`,
`unknown_tool`, `authority_missing`, `resource_denied`, and `revoked`. An allow
requires a known profile, `allow`, passed revocation, descriptor-matched
requested resource type, and outcome `authorized`. Complete
`authority_missing` permits a null or known profile and a matching or
mismatching requested resource type, but requires `deny`, `not_required`, and
`denied`. Complete `resource_denied` requires a known profile: descriptor
matching means revocation passed before the adapter denied, while descriptor
mismatch means revocation was not required. `revoked` requires a known profile,
descriptor match, `deny`, failed revocation, and `denied`. V2 outcomes are only
`authorized` and `denied`; later execution evidence is a separate event.

The immutable baseline is seed commit
`83eee2fa6537d1659359b8555f5f38638977ab6d`. The unattended controller's first
mechanically checked command established the seed's exact sixteen-field v1
type/field shape, its direct symbol consumers, its sole denial-code consumer,
and its empty runtime dependency sections. A separate Git inspection pinned to
the schema-v2 checkpoint `b23f20c30fd7ab1db6b2038b12e0f819ef4846d8`
established direct `DeveloperMcpAuditRecord` and
`assertDeveloperMcpAuditRecord` consumers as only `audit.ts` and
`contracts.test.ts`; denial-code consumers as only `call-authorization.ts` and
`call-authorization.test.ts`; and no non-empty `dependencies`,
`optionalDependencies`, `peerDependencies`, or `bundledDependencies` in that
checkpoint's package manifest. This evidence is limited to those exact symbol,
type/field, and manifest checks; it does not make a moving claim about later
consumers or every imaginable structural persistence mechanism.

At this schema checkpoint, TM-009 append remains pending. This section claims
neither atomic persistence nor transactionality with a later tool mutation.

## 7. Deferred controls, named rather than omitted

The previous revision omitted these silently. Each is now either a
`OWNER-DEVELOPER-MCP-02` prerequisite or an explicit deferral.

| Threat | Control | Status |
| --- | --- | --- |
| `TM-008` | Per-tenant and per-user concurrency caps, duration ceiling, spend budget with circuit breaker, endpoint rate and size limits, idempotency keys | **Prerequisite** |
| `TM-006` | Output redaction and classification at the response boundary | Section 3.1 |
| `TM-005` | One-time preview exchange, CSP and frame-ancestors, revoke-on-terminate, raw origin never revealed | **Prerequisite** |
| `TM-004` | Registry pinning, integrity verification, SBOM, licence and vulnerability scan, independent artifact digest | **Deferred** to the publication design |
| `TM-002` | Prefix-confusion and cross-tenant conformance tests | **Prerequisite** |
| `TM-001` | Protected-resource metadata; token never forwarded | **Prerequisite** |
| `TM-011` | Client confirmation for consequential calls; tool and resource output labelled untrusted | **Prerequisite** |
| FR-015 | Kill switch and feature flag, independent of module health, that can never satisfy an authorization check | **Prerequisite** |

## 8. What this freeze does not authorize

Stated so silence cannot be read as permission: no publication path; no genuine
tenant data in any sandbox; no provider credentials in agent or sandbox context;
no infrastructure mutation, including via `network` or `limits`, which are not
tool arguments; no Clerk Developer MCP route, the verifier being WorkOS-only; no
cross-tenant read of any kind including aggregate.

## 9. `OWNER-DEVELOPER-MCP-02`: route enablement

A separate gate. Not satisfiable until every item below is verified with linked
evidence, not asserted in prose.

1. **`TM-001`** — protected-resource metadata published, configured resource URL
   bound exactly, token never forwarded. *Not implemented.*
2. **`TM-007`** — per-call membership recheck with a maximum stale-authority
   window of **60 seconds**, synchronous recheck for high-risk calls, and job
   authority capped in duration. *Decision settled; enforcement not implemented.*
3. **`TM-009`** — atomic audit append on the tool-call path, using section 6's
   closed vocabulary. Chain exists; integration does not.
4. **Sandbox egress denial.** Policy validation now rejects IP literals,
   single-label hosts, and internal or metadata-oriented suffixes, including
   the former `169.254.169.254` regression. The remaining gate is still real:
   callers can choose `deny_all` or `allowlist`, neither v1 template pins the
   former in an executable registry yet, and adapters do not prove connect-time
   denial against the resolved address. DNS rebinding and a permitted name
   resolving to a private, loopback, link-local, or provider-metadata address
   therefore remain unclosed.
5. **No ambient credentials**, asserted by a conformance test rather than
   inferred from `SandboxCreateRequest` having no env field. Absence of a field
   is not a contract.
6. **Per-call resource ownership authorization** at a named enforcement point.
   The in-memory adapter compares `checkpoint.tenantId` on restore
   (`in-memory-adapter.ts:225`) but does not compare `workspaceId`.
7. `TM-008`, `TM-005`, `TM-002` and `TM-011` prerequisites from section 7.

## 10. Resolved owner decisions

1. **Eligibility grants nothing.** `developer.readonly@1` is explicit, not an
   automatic side effect of developer eligibility.
2. **Revocation bound is 60 seconds.** High-risk calls synchronously recheck;
   no cache, discovery result, or job authority may widen that bound.
3. **The two-template registry is the v1 registry.** Widening requires a new
   immutable template identifier and owner review.
4. **Launch behind a provider-neutral local adapter.** Keep the resource model
   provider-neutral and document a later WorkOS FGA migration; do not let
   provider groups or FGA objects become the canonical authority vocabulary.

## 11. What changed in v2, and why

Adversarial review found four blocking defects and ten serious ones. The
substantive changes:

- **Split the gate.** v1 claimed to satisfy `OWNER-DEVELOPER-MCP-01` while three
  preconditions were unmet, which would have retired the gate blocking route
  exposure. Vocabulary freeze and route enablement are now separate.
- **Wrote the field lists.** v1 claimed to freeze versioned schemas and
  contained no field list, leaving `limits` and `network` free to become
  arguments.
- **Versioned the profiles.** v1's slug immutability was defeated by mutable
  profiles.
- **Reclassified `build.execute` and `preview.open` as high**, reconnecting
  FR-001's synchronous revocation requirement to the tools that need it.
- **Corrected a false security claim.** v1 stated sandbox egress denial was
  "already contracted." It is not, and `validateHost` admits metadata endpoints.
- **Corrected a wrong citation.** v1 cited
  `model-routing.ts`'s `CALLER_RESIDENCY_FORBIDDEN` as the precedent for
  deriving tenant server-side. That check bans a caller-supplied *residency*
  field; `ResolveInput` accepts `tenantId` as a caller argument. Not the same
  rule, not the `TM-002` mitigation. Replaced with the real precedent.
- **Fixed the slug-tool bijection**, adding `evidence.list`, `evidence.get` and
  `workspace.snapshot`, and splitting `workspace.write`.
- **Filtered `contract.*` by the caller's slugs.** v1 closed the discovery leak
  at the tool layer and left it open at the content layer, so `readonly` could
  read the map of everything it could not do.
- **Specified opaque identifiers**: 128-bit CSPRNG, identical denial response,
  per-tenant rate limits.
- **Added the audit vocabulary, output redaction, client identity, and scope
  intersection**, none of which v1 mentioned.
- **Named eight deferred control sets** instead of omitting them.
- Renamed `preview.read` to `preview.open`, since it creates an
  internet-reachable origin and consumes compute rather than reading anything.

## 12. What changed in v3, and why

- Resolved the four owner decisions in section 10 without retiring the separate
  route-enablement gate.
- Removed the automatic readonly grant, so an eligible identity with no explicit
  assignment has an empty authority set.
- Bound all cached authority and future permission-filtered discovery to 60
  seconds, while retaining synchronous rechecks for high-risk calls.
- Selected the provider-neutral local resource-authorization adapter and kept
  WorkOS FGA as a migration option rather than a canonical dependency.
- Corrected the stale sandbox statement: host-policy denials exist, while
  template pinning and connect-time resolved-address enforcement remain open.
- Recorded that MCP request `_meta` describes protocol peers but never proves
  the registered client identity used for consent or audit.

## 13. What changed in v3.1, and why

- Corrected the false slug/tool "bijection" claim. The actual invariant is a
  total surjection from twelve tools onto seven assignable slugs.
- Marked `module.dev.publish.propose` unassignable in v1 and reserved, rather
  than freezing an authority with no tool and no publication-approval design.
- Reserved `developer.proposer` without freezing an `@1` profile identical to
  the builder profile. No slug was removed or redefined and no capability was
  added; v1 authority only narrowed.
