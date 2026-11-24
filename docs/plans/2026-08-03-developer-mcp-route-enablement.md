# Plan: Developer MCP route enablement

Date: 2026-08-03. Sequences the eleven technical criteria on
`OWNER-DEVELOPER-MCP-02` after the four gating decisions were settled the same
day. Source of criteria:
`docs/product/developer-mcp-authority-freeze.md` §9. Owner decisions:
`docs/OWNER-TASKS.md`, "Open Developer MCP decisions".

This is a sequencing plan, not a design document. Each criterion's design is
already frozen in the authority document; what was missing was an honest account
of which are built and what order the rest must be built in.

## 1. What the four decisions removed from scope

Recorded first because it changes the shape of the remaining work more than any
implementation choice would.

- **No brokered capabilities in v1.** Nothing legitimately egresses. The
  connect-time egress criterion stops being release-blocking. It is not closed:
  the sandbox still advertises a deny-all posture that connect-time address
  checking does not enforce, and `validateHost` refusing forbidden *names* does
  nothing about a permitted name resolving to a forbidden *address*. That claim
  remains false in the document and closing it is the first criterion of the
  brokering project, not of this one.
- **OpenTenant-managed repositories only.** No tenant Git credential is
  brokered and no third-party host is reached.
- **No publisher profile.** `developer.builder@1` holds no `publish` slug, so
  nothing can publish. TM-005's preview exchange is still required, because
  builders open previews; TM-004 was already deferred to the publication design
  and stays there.
- **Two-value publication policy enum.** `always` and
  `first_publication_only`, defaulting to `always`, installation-owner-set,
  audited as an authority change. Designed now, unreachable until a publisher
  profile exists.

## 2. Current state, audited rather than assumed

### Current status, reviewed 2026-09-07

The table below is the August 4 audit that shaped the sequence. It remains as
historical evidence, not current status. The current package has the closed v2
audit union and a serialized append contract. `authorizeDeveloperMcpCall`
awaits one validated pre-execution append before returning any decision. Its
local resource adapter checks the exact tenant, user, resource type, full opaque
resource ID and slug. Tests cover cross-tenant denial, changed-ID prefix
confusion, bounded authority freshness and a second live check for high-risk
calls.

These are package-level foundations. The append adapter and resource records are
in memory. The durable admission and audit stores are not composed with the
Developer MCP authorization path, and there is no durable job authority,
independent kill switch, protected-resource composition, client confirmation,
preview mediator or output contract. The application still does not import
`@opentenant/developer-mcp`; its only MCP route is the separate Brain route.

The current proof map and seven follow-on implementation packets are in
[`developer-mcp-pre-exposure-contract.md`](developer-mcp-pre-exposure-contract.md).
No packet exposes an application route. Publication, tenant credentials,
brokered access and hosted sandbox operations remain separately gated. The exact
FR-001 through FR-015 status is in
[`product-requirements-status.md`](product-requirements-status.md).

### Historical audit, read 2026-08-04

`packages/developer-mcp/src` already contains `authority`, `call-authorization`,
`audit`, `protocol`, `slugs`, `tools`, `catalog`, `profiles`, `revocation` and
`conformance`, with test files beside most of them. The table below was first
built by grepping for each criterion's vocabulary and then corrected by reading
the modules; the corrections are set out beneath it.

| Criterion | Verified state, read 2026-08-04 | Assessment |
| --- | --- | --- |
| TM-007 per-call recheck, revocation bound | `revocation.ts` exports `MAX_AUTHORITY_STALENESS_MS = 60_000` and `requiresSynchronousRevocationCheck`, which fails closed on an unknown slug. `authorizeDeveloperMcpCall` consumes both | **partly built.** Bound and high-risk rule exist. Capped *job* authority lifetime does not |
| Per-call resource ownership incl. workspace | `authorizeDeveloperMcpCall` at `call-authorization.ts:134` is the named enforcement point and takes a `resourceAuthorizationAdapter`. The local adapter compares `target.tenantId` against `principal.tenantId`, treats `module_workspace` as a first-class resource, and inherits a grant from the parent project only when the parent's tenant matches | **built.** This row was wrong in the pre-audit table |
| TM-009 atomic audit append, closed vocabulary | `audit.ts` freezes a 16-field vocabulary, rejects unexpected or non-enumerable keys and non-`Object.prototype` prototypes, and enforces cross-field invariants: an allow needs a `profileVersion`, a deny needs a denied outcome, a high-risk allow needs passed revocation evidence. `priorDigest`/`currentDigest` describe a hash chain | **half built, and the missing half is the criterion.** The closed vocabulary is done and done well. There is no append: grep for append, persist or store across `audit.ts` and `protocol.ts` returns nothing, so nothing writes a record and nothing is atomic with the authorization decision. The chain fields are declared and unproduced |
| TM-002 prefix-confusion and cross-tenant conformance | `conformance.ts` carries protocol-layer forgery fixtures, including `extraEnvelopeMember` setting `authority: "tenant-forged"` and `extraMetadataMember` setting `_meta.tenantId: "tenant-forged"`, plus a tenant-invariant catalogue assertion | **partly built.** Cross-tenant forgery is covered at the envelope and metadata layer. Nothing addresses tool-name prefix confusion |
| No ambient credentials, asserted by test | No test asserts it. Nothing in the package references an Authorization header, bearer token or credential at all | **not built.** Note the criterion's own wording: it must be asserted positively by a conformance test, not inferred from an absent field, and absence is exactly what the code currently offers |
| TM-001 protected-resource metadata, token never forwarded | No protected-resource metadata, no resource-URL binding, no token-forwarding prohibition anywhere in the package | **not built** |
| TM-008 limits and idempotency | No concurrency, spend, rate, size or idempotency vocabulary | **not built** |
| TM-005 preview exchange, frame protections | `preview.open` exists as a permission slug and appears in `tools.ts`. No one-time exchange, CSP, frame-ancestors or revoke-on-terminate | **slug only** |
| TM-011 client confirmation, untrusted labelling | No reference to untrusted labelling | **not built** |
| FR-015 kill switch independent of module health | No kill switch or feature flag | **not built** |

**Step 0 ran on 2026-08-04 and this table is read rather than grepped.** Two of
the four unverified rows changed materially, which is the whole argument for
having done it.

**Per-call resource ownership is already built**, including workspace as a
first-class resource with tenant-matched inheritance from its parent project.
Specifying it as work would have produced a second implementation of a property
that already holds.

**TM-009 is half built and the built half is not the criterion.** The closed
field vocabulary is thorough, including prototype and property-descriptor checks
most validators skip. But nothing appends a record anywhere, so "atomic audit
append on the tool-call path" is entirely unmet, and the `priorDigest` and
`currentDigest` chain fields are declared with no producer. A reader of
`audit.ts` alone would reasonably conclude auditing was finished.

Also corrected: TM-002 is partly built, covering cross-tenant forgery at the
envelope and metadata layer but nothing about tool-name prefix confusion. And
the no-ambient-credentials criterion is not merely untested; it explicitly
requires a positive assertion rather than an inference from absence, and absence
is all the code currently provides.

## 3. Sequence

Ordered by what blocks what, not by criterion number.

**Step 0. Verification pass. Done 2026-08-04.** Findings folded into the table
above. One criterion was found already satisfied and dropped from the build set;
one was found half built in a way that reads as complete.

**Step 1. TM-009, audit on the call path.** Everything after this needs to record
what it decided. An audit append that is not atomic with the authorization
decision produces call records that disagree with what happened, which is worse
than no record because it is trusted. Nothing else should be built on top of an
audit path that has not been proven atomic.

**Step 2. TM-001, resource identity and token handling.** Publish
protected-resource metadata, bind the resource URL exactly, and prove the
incoming token is never forwarded onward. This is the criterion with no evidence
of existing work and the one that defines what a route *is*, so it precedes any
route-shaped work.

**Step 3. TM-007 completion: capped job authority lifetime.** Narrowed by step 0.
The staleness bound and high-risk synchronous rule exist, and per-call resource
ownership is already built, so the only remaining piece is the capped lifetime for
job authority. Smaller than planned, and it still touches
`authorizeDeveloperMcpCall`, so it must not run concurrently with step 1.

**Step 4. FR-015, kill switch.** Small, independent, and stated as never able to
satisfy an authorization check. Worth doing before the first route is reachable
rather than after, because its value is entirely in existing before it is needed.

**Step 5. TM-008, limits and idempotency.** Concurrency, duration, spend, rate,
size, idempotency keys. Independent of the above and can run in parallel with
step 4 if worked by a different session.

**Step 6. TM-011, confirmation and untrusted labelling.** Client confirmation for
consequential calls, and tool and resource output labelled untrusted. Depends on
the tool-call path being settled by steps 1 to 3.

**Step 7. TM-005, preview exchange.** One-time exchange, CSP and frame-ancestors,
revoke-on-terminate, raw origin never revealed. The slug exists; the mechanism is
a self-contained piece of work with no dependency on the others.

**Step 8. TM-002 prefix confusion, and the no-ambient-credentials test.** Last,
because conformance tests should run against a finished call path rather than a
moving one. Narrowed by step 0: cross-tenant forgery fixtures already exist at
the envelope and metadata layer, so this step adds tool-name prefix confusion
only. The ambient-credential test must assert absence positively; the criterion
says so, and inferring it from a missing field is what it forbids.

## 3a. Step 1 run 1, rejected 2026-08-04

Recorded because the defect is the exact one this step was sequenced first to
prevent, and because that is worth a paragraph rather than a line.

The controller produced a working append with a digest chain, and the full sweep
passed 63/63. The blocking work review rejected it. Codex and Fable found the
same headline defect independently: **denial records fabricated tool identity.**
For `unknown_tool` and `invalid_context` denials, where no descriptor resolves,
the implementation borrowed a real tool's name, slug, risk class and resource
type from a fallback map keyed on resource type, so a denial for an unknown tool
was logged as a denial of an actual tool.

That is not a cosmetic problem. Step 1's rationale in this plan says an audit
record that disagrees with what happened is worse than no record because it is
trusted, and run 1 built precisely that. The cause is understandable: the closed
16-field vocabulary requires a tool name, slug, risk class and resource type, and
a descriptor-less denial has none of them, so the validator cannot be satisfied
honestly. Faced with that, the implementation invented values instead of
reporting the conflict. **The requeued task now forbids the invention and
instructs a stop-and-report if the vocabulary genuinely cannot represent a
descriptor-less denial**, which may mean TM-009 needs an owner-approved
vocabulary amendment rather than more code.

Three further findings, all real: a defensive check became a `TypeError` so
malformed input throws instead of returning `invalid_context`; the concurrency
test accepted an implementation that fails both racing calls; and the digest test
compared the builder's output to itself rather than reading the record back from
the adapter.

Four criteria were added and the task requeued. The rejected work is preserved on
the `rejected/tm009-run1-fabricated-identity` branch in the worktree rather than
discarded.

## 3b. Step 1 run 2, rejected 2026-08-06

The schema conflict from run 1 was resolved first: the staged v2 audit union
passed the full 63-task repository profile and blocking review, then merged
separately in PR 58. Retrying the append on top of that schema also passed all
63 tasks, but the blocking review correctly rejected the implementation before
push.

The append interface accepted a record and returned `void`, while only the
in-memory implementation assigned the hash chain. That made the claimed chain
an adapter accident rather than part of the port contract. The authorization
boundary also required the adapter to be a plain object, rejecting valid class
implementations of the exported interface, and it could inspect accessor-backed
properties before it had established a safe input shape. The digest's literal
hash was derived from the same implementation it purported to test, and the
tamper test changed only one field, so neither independently pinned the complete
preimage. Finally, the prior schema task's evidence paragraph made a moving
"current tree" consumer claim that adding the required append tests immediately
falsified.

The requeued contract now makes the adapter own a single linearizable operation:
it receives a validated record with null chain fields and resolves with the exact
committed, chained record. It specifies the digest preimage as ordered
`[fieldName, value]` pairs, requires a literal preimage and independent
`node:crypto` oracle, covers every included field, accepts class adapters without
invoking accessors during validation, and time-scopes the schema checkpoint's
consumer evidence. The cleared schema work remains on main; the rejected run-2
append commits remain only as evidence on the unpushed feature branch.

## 4. Constraints on how this gets built

- **One step per task.** Steps 3 and 5 aside, no task should touch a file another
  open task is editing. Step 0 exists to make that possible.
- **Assert behaviour by executing it.** The same rule that migrations live under.
  A conformance test that greps source text proves nothing; `0018` shipped
  invalid SQL behind twenty passing substring assertions.
- **No criterion is closed by a document.** Each step ends with a test that fails
  when the property is removed. The pattern is to disable the guard and confirm
  exactly the intended test fails.
- **Egress stays out.** No step here opens an outbound path. If a step appears to
  need one, that is a signal the no-capabilities decision is being eroded and it
  should stop and report instead.

## 5. What this plan does not cover

TM-004 registry integrity and SBOM, deferred to the publication design. TM-006
output redaction, already handled by §3.1 of the authority document rather than
being a route prerequisite. The publisher profile and the publication approver
mechanism, designed but unreachable in v1. Brokered capabilities and the
connect-time egress work, which is its own gated project whose first criterion is
the DNS-rebinding hole named in §1 above.
