# Plan: starter-inspired platform features

Date: 2026-08-05.

This plan turned the useful product patterns found in two external SaaS
starters into original OpenTenant work. It now records both the reviewed
sequence and the controller-verified completion state; current public maturity
is stated in the README and platform-capabilities guide.

## Research boundary

- [Shipyard](https://github.com/sarmakska/shipyard) was reviewed at commit
  `5505a44d62a5b9e65f43d9db38f975941e2f3a44`. Its MIT-licensed implementation
  suggests useful product shapes: tenant activity, explicit plan/usage
  boundaries, and a membership-driven tenant launcher.
- [saas-multi-tenant-starter](https://github.com/ismailcankaratas/saas-multi-tenant-starter)
  was reviewed at commit `9323dce0e197af01c5b34264817060d84a292aea`.
  It had no root licence in the reviewed tree, and its request-identity pattern
  trusted a caller-controlled `x-user-id` header. It is an idea source only,
  not a source of code or security contracts.
- No source, test, prompt, workflow, asset, schema, or copy from either project
  is copied or vendored. Every task below is specified against OpenTenant's
  existing tenant, identity, audit, and database boundaries.

## Product decisions

1. Repair the Developer MCP audit schema before retrying its append task. A
   denial must never acquire identity merely to satisfy a validator, but it
   must retain actor and resource identity that the authorization path already
   validated so probing remains attributable.
2. Keep admission control, exact usage evidence, and commercial entitlements
   separate. A rate limiter is not a billing ledger, and a billing plan is not
   an authorization decision.
3. Use one provider-neutral admission contract, one deterministic in-memory
   reference adapter, and one atomic PostgreSQL implementation. Do not add a
   speculative Redis/provider matrix.
4. Define tenant-activity visibility and redaction before exposing a UI. The
   first surface is tenant-owner/tenant-admin only and never returns another
   tenant's or platform-scoped events.
5. Build exact usage evidence before selecting prices or a payment provider.
   Stripe wiring remains owner-gated until metrics, replay windows, and
   commercial policy are decided.
6. Derive tenant-launch links from verified identity memberships and active,
   verified domains. A header, cookie, query string, or caller-supplied tenant
   id can never establish the active tenant.
7. Do not add generic custom roles or generic feature flags as part of this
   work. Existing explicit OpenTenant authority remains the boundary.

### Developer MCP audit context decision

The audit union records the authorization path's progressive trust boundary,
not a false all-or-nothing subject. `contextResolution` has three values:

- `unresolved`: malformed top-level context established no reusable identity,
  so every subject field is null and the decision is `invalid_context`;
- `principal`: the principal and requested resource are validated, but no tool
  descriptor is established. This covers timestamp-invalid `invalid_context`,
  `unknown_tool`, and the `authority_missing` decision returned for stale
  authority before tool lookup; actor and resource fields remain attributable
  while tool, slug, risk, and profile are null;
- `complete`: the descriptor is established. Tool, actor, resource, slug, and
  risk are retained. `authority_missing` may have a null or non-null profile
  depending on whether no profile resolved or a resolved profile lacked the
  required effective slug. Because that check precedes descriptor/resource-type
  comparison, its validated requested resource type may differ from the
  descriptor. Later denials require the resolved profile.

This staged shape matches the existing order in `authorizeDeveloperMcpCall`.
It avoids both defects identified in review: fabricating a descriptor for an
early denial and discarding already-validated tenant/client attribution for an
unknown-tool probe.

The staged identity grammar is not looser than authorization. At `principal`
and `complete`, client, user, and tenant identifiers are non-empty, already
trimmed printable ASCII strings of at most 128 code units; `resourceType` is
one of the two frozen resource enums; and `resourceId` is exactly 32 lowercase
hexadecimal characters. Tests reject whitespace padding, non-ASCII actor ids,
and uppercase or wrongly sized resource ids at both stages. Compile-time
assertions cover all nine identity fields at all three stages, and runtime
matrices vary one decision axis at a time from an otherwise valid literal
fixture.

The append records an authorization outcome, not a fictional tool-execution
outcome. Schema v2 therefore accepts `authorized` for an allow and `denied` for
a denial. Later execution success or failure, when a route exists, needs its own
event rather than mutating this chained record or predicting the future.

The audit task's baseline is mechanically reproducible rather than a prose
claim. Its first two controller commands are pinned to seed commit
`83eee2fa6537d1659359b8555f5f38638977ab6d`; they prove the commit exists, the
exact v1 field/type shape, scoped direct symbol consumers at the seed and
current working tree, and the absence of runtime-bearing dependency sections
in both manifests. The trusted controller runs that declared prefix before it
launches the restricted implementation agent and stops without launching when
either premise command fails; the agent receives only the resulting scoped
fact, not authority to re-run source-control subprocesses.

### Admission pre-implementation review

The first `PLATFORM-ADMISSION-09` contract was blocked in review on 2026-08-06
before an implementation agent ran. It named the right boundaries but left
enough policy implicit that a locally green adapter could still oversubscribe,
retain unbounded state, replay across a partial scope, or choose incompatible
window and release semantics. The backlog task was therefore amended rather
than asking implementation tests to invent those decisions.

The amended contract fixes the full tenant, principal, and operation scope;
caller-supplied size and opaque fingerprint rules; fixed half-open windows;
admitted-only idempotency replay; bounded TTL retention; exact evaluation
order; lazy expiry; typed idempotent release; injected asynchronous time and
lease identifiers; and deep-frozen outputs. Its race proof includes an awaited
pre-commit interleaving hook behind per-scope serialization, so removing the
serialization guard demonstrably oversubscribes instead of merely exercising
a synchronous reference adapter. Executable source mutations must likewise
prove that both the serialization and fingerprint guards are load-bearing.
These details describe a deterministic reference contract only: authorization,
an exact usage ledger, PostgreSQL atomicity, route policy, and deployment remain
separate later work.

A second blocking review found that even this detail left observable choices to
the implementation: the fixed-window anchor, policy drift over retained state,
the clock and lease-ID uniqueness domains, inclusive count/size boundaries, and
the precedence of retained release results. The final amendment pins those
semantics and names the reference factory, options, snapshot, and test surface.
Its verifier consumes Vitest's JSON report, inspects the TypeScript syntax tree
for real exported contracts and non-empty required test bodies, rejects focused
or skipped tests and local adapter substitutes, and requires both mutants to run
entirely in memory. This closes the same class of self-confirming test weakness
that previously caused an unattended audit implementation to be rejected.

The final verifier review found that agent-authored tests still could not serve
as the only behavioral oracle, and that the proposed per-package report path was
read-only in the trusted verification sandbox. The plan now ships a controller-
owned verifier outside the implementation task's writable and compile paths. It consumes
the report from the controller's root cache, loads the adapter and both fixed-
token mutants in memory, and independently exercises malformed input, fixed
windows, replay isolation, policy drift, monotonic time, lease collisions,
bounded retention, release precedence, defensive copies, live races, and safe
scope-tail deletion. The implementation agent cannot rewrite that oracle.

## Dependency order

| Order | Backlog task | Outcome |
| ---: | --- | --- |
| 1 | `DEV-MCP-AUDIT-SCHEMA-08` | A versioned audit shape records the exact validated context at every denial stage |
| 2 | `DEV-MCP-TM009-07` | Every Developer MCP decision is appended through the already-planned atomic path |
| 3 | `PLATFORM-ADMISSION-09` | Provider-neutral admission and idempotency contracts, with an executable in-memory reference |
| 4 | `PLATFORM-ADMISSION-PG-10` | Atomic PostgreSQL store, verified by four non-skipped local integration tests |
| 5 | `PLATFORM-ADMISSION-ROUTES-10A` | The three production route maps use the shared verified store |
| 6 | `TENANT-ACTIVITY-11` | Tenant-safe activity projection and redaction policy |
| 7 | `TENANT-ACTIVITY-UI-12` | Admin-only `/settings/activity` surface over the projection |
| 8 | `PLATFORM-USAGE-13` | Append-only exact-usage ledger, verified by four non-skipped local integration tests |
| gate | `OWNER-BILLING-01` | Freeze commercial metrics, plan semantics, replay window, and payment-provider scope |
| 9 | `TENANT-LAUNCHER-14` | Membership-derived launch links to active verified tenant hosts |

Only the edges encoded in the backlog are technical dependencies. Priority
expresses the preferred order for otherwise independent tasks; audit failure
does not make admission, activity, usage, or launching technically dependent
on audit.

The two PostgreSQL tasks originally started as `blocked` because the unattended
verifier denied network access and stripped database environment variables,
while the integration suites skipped without a database URL. The trusted
controller now creates a PostgreSQL 17 cluster with a restricted role and
task-specific Unix-socket access, runs exact named suites inside the deny-network
sandbox, rejects skipped tests, corroborates committed rows independently, then
destroys the cluster and verifies the post-run boundary. The `admission` and
`usage` profiles execute five and four integration tests respectively, with
zero skipped tests.

This order does not replace the route-enablement sequence in
`2026-08-03-developer-mcp-route-enablement.md`. In particular, the shared
admission substrate does not make a Developer MCP route callable and cannot
satisfy `TM-008` until the route-specific duration, spend, concurrency, size,
and idempotency policy is wired after the earlier route gates.

## Stop conditions

- Stop if an audit record can only be made valid by copying identity from a
  different tool, principal, tenant, or resource.
- Stop if admission or usage state is process-local in production, or if a
  concurrent test can oversubscribe a limit.
- Stop if an activity payload needs arbitrary audit `detail` fields rather than
  an explicit allowlist and redaction policy.
- Stop if billing work needs a price, checkout provider, webhook secret, or
  production account before `OWNER-BILLING-01` is settled.
- Stop if the launcher needs an active-tenant header/cookie or emits an
  unverified/inactive domain.

Marketing classification: `truth`. All 37 non-owner tasks, including the two
bounded hardening tasks added by final semantic review, passed the controller.
Public copy must still distinguish implemented foundations from the four
owner-gated activations and from production approval.
