# Support AI reviewed-suggestion composition

Date: 2026-09-07

Status: design contract for `OT-D02`. This document authorizes no provider call,
route, workflow, ticket mutation, deployment, or production use.

Owners: Sol high for the durable store and API composition. Luna high for the
human-review interface. Astra reviews each fixed revision and the integrated
result.

Marketing classification: `truth`. The contract changes the recorded maturity
and implementation sequence. It does not make Support AI available to users.

## Outcome

The next Support AI slice is one tenant-scoped request for a reviewed suggestion,
followed by a separate human-review step. It may suggest category, priority, and
reply text. It may not apply any of them.

The suggestion is an application artifact, not an action. The only way to send
a reply remains the existing support reply route after a person has reviewed the
text and deliberately submitted the reply form. The suggestion route cannot call
`addMessage`, `setStatus`, `setPriority`, `assignTicket`, any release function,
or any publication function.

This slice uses the accepted model-routing policy. It does not select a provider,
weaken residency or retention rules, or make a credential available outside the
router. Local tests may use the synthetic adapter. A live provider remains
blocked on the owner task recorded under "Before support AI assistance" in
`docs/OWNER-TASKS.md`.

## Source decisions and precedence

This contract follows these decisions, in order:

1. `docs/product/support-ai-boundary.md` is the authority for allowed ticket
   fields, knowledge scope, containment, failure behavior, and human review.
2. `docs/architecture/adr-006-model-selection-and-residency.md` owns provider
   selection, residency, retention, cross-border consent, credentials, and
   model-resolution evidence.
3. The August 3 voice ruling in the support boundary and
   `docs/product/brand-and-voice-documents.md` keeps `preferredWords`,
   `exampleRewrites`, `readingLevel`, `formality`, `person`, `tense`, and
   `sentenceLength` out of generation and review behavior.
4. `modules/support/src/support-ai-service.ts` and
   `support-ai-types.ts` are the current provider-neutral behavior. They are a
   tested in-memory foundation, not an application journey.
5. The immutable profile version and digest from
   `PgTenantVoiceProfileStore` identify the applied voice evidence. Only its
   validated `bannedWords` projection participates in this slice.

The accepted support boundary says raw prompt and completion payloads are not
persisted. This contract preserves that rule. A schema-valid, containment-checked
`review_required` result becomes a tenant application artifact because a person
must be able to review it after a reload. The raw adapter response, rejected
schema output, and assembled prompt are not that artifact and do not enter the
normal suggestion tables. Rejected raw output follows the separate quarantine
rule described under product gates below.

## Current foundation and missing composition

| Concern | Current source | Work still required |
| --- | --- | --- |
| Allowed ticket shape | `SupportAiTicketInput` excludes internal notes and requester identity | Assemble it from a freshly authorized canonical ticket read |
| Suggestion containment | `SupportAiService.validDraft` checks citations, whole sentences, scaffold ids, and rendered text | Preserve the checks before any durable suggestion insert |
| Voice refusal | `containsBannedWord` checks the rendered reply | Load one immutable applied version and pass only `bannedWords`, version, and digest |
| Model policy | `ModelRouter` and `PgModelRoutingStore` enforce allowlist, residency, retention, consent, credentials, and attempt evidence | Expose a content-free policy and consent reference that the support request can pin |
| Durable voice evidence | `PgTenantVoiceProfileStore` verifies normalized content against its digest | Read the applied version for the request tenant and refuse any digest mismatch |
| Durable review state | None | Add tenant-bound request, policy, suggestion, terminal, review, and audit records |
| Application route | None | Add a narrow same-origin route that derives tenant and actor from the session |
| Human review | None | Add a review panel separate from the existing reply form |

## Authorization boundary

### First supported actor

The first slice is available only in the tenant support detail page. The request
boundary must re-run `supportContext()` and require all of the following:

- the support module is enabled for the resolved tenant;
- the session is current and bound to that tenant;
- the actor has `support.ticket.read_tenant`;
- the actor has `support.ticket.reply`;
- the canonical ticket exists in the same tenant database.

The conjunction matters. Read authority alone must not spend model budget or
create a draft, and requester-only reply authority must not expose tenant
knowledge. `support.ticket.manage` is neither sufficient nor required.

The same checks run before every request read, suggestion read, and review write.
RLS remains a second control, not a substitute for application authorization.
The request body cannot carry a tenant id, installation id, actor id, permission,
provider, model, region, retention posture, consent reference, voice version, or
knowledge scope.

Requester accounts are excluded. Installation-owner and managed-support review
are also excluded from this first UI because their current detail path uses a
different authority and active-support-session contract. Adding that path needs a
separate packet that rechecks `owner.support.customer_data.read`, the exact active
managed-support session, its reason and expiry, and the tenant's support policy.
It must not reuse the tenant route by manufacturing a tenant session.

### API request shape

The Sol packet adds `POST /api/support/ai/suggestions` with an exact JSON object:

```ts
interface CreateSupportSuggestionRequest {
  ticketId: string;
  expectedTicketVersion: number;
  idempotencyKey: string;
}
```

Unknown keys fail with `400`. `ticketId` must be a UUID. The version must be a
positive PostgreSQL integer. The idempotency key is bounded opaque text and is
unique for `(tenant, actor, ticket, ticketVersion)`. Replaying the same key returns
the existing request and must not call the model again. Reusing it for different
input returns `409`.

The route loads ticket subject, body, public replies, category, priority, status,
tags, and attachment metadata from canonical tenant state. It never accepts those
fields from the caller. Internal notes and requester identity have no field in the
assembler. The route rejects a ticket-version mismatch before policy resolution
or provider work.

The first implementation reads published tenant-private material from the
tenant's existing `support.knowledge_articles` table. The reader binds the tenant
through `withTenantDb`, deterministically chunks the stored content, and identifies
each source version by its content digest. The request pins the chunks it used by
id and digest. An edit creates a different source version for a later request; it
does not change an existing suggestion.

The existing table does not represent platform or installation-owner shared
knowledge with the accepted publication and revocation evidence. SAI-01 must not
pretend that it does. Those two retrieval scopes need their own persistent
knowledge packet before this route can use them. Their absence returns
`no_knowledge` when the tenant has no eligible tenant-private article. It never
widens retrieval or falls back to another tenant.

`GET /api/support/ai/suggestions?ticketId=<uuid>` returns the authorized ticket's
latest request and reviewed suggestions. It uses `Cache-Control: no-store` and
does not accept tenant, actor, or installation selectors.

`POST /api/support/ai/suggestions/<suggestionId>/reviews` accepts exactly:

```ts
interface ReviewSupportSuggestionRequest {
  decision: "reviewed" | "dismissed";
  expectedTicketVersion: number;
}
```

This records the human decision about the suggestion. It does not accept edited
reply text and cannot mutate the ticket. A person may copy the draft into the
normal reply editor and edit it there. Sending remains a second, existing POST to
`/api/support/tickets`.

### HTTP and durable outcome split

Anonymous, wrong-tenant, missing-ticket, and revoked-permission requests expose
no suggestion. The route returns the same concealment behavior as the ticket
detail page. Invalid request syntax returns `400`, an idempotency conflict returns
`409`, and authorization failures create no Support AI request row.

Once an authorized request row exists, expected model and policy failures become
durable terminal outcomes and a successful HTTP response. They do not turn the
support workflow into an error path.

## Request lifecycle

There is no queue, worker, scheduled task, retry loop, or unattended workflow in
this slice. The route performs one bounded request inline. The browser may cancel
the fetch with an `AbortSignal`; the route forwards that signal to the model
stream and attempts the terminal write independently of whether the response
socket remains open.

The durable lifecycle is derived from immutable records:

| Step | Durable write | Rule |
| --- | --- | --- |
| Authorized | Request plus `requested` audit event | Written before model policy resolution |
| Policy resolved | Policy snapshot plus `policy_resolved` event | Must refer to the router's recorded resolution attempt |
| Provider admitted | Attempt link plus `provider_started` event | Must join the preparation to the router's recorded stream execution before the first event is consumed |
| Provider running | No prompt or partial output write | Content remains in process memory |
| Review result | Validated suggestion, terminal row, and `suggestion_created` event in one transaction | Only `review_required` may insert a suggestion |
| Safe failure | Terminal row plus outcome event in one transaction | No suggestion row |
| Human review | Review row plus `reviewed` or `dismissed` event in one transaction | Does not update the ticket |

Each request has a server-owned `execution_deadline`. It may have zero or one
terminal row: zero is durable evidence that the process stopped before it could
record an outcome. Database uniqueness decides completion and cancellation
races. The loser reads the recorded terminal state and performs no second write.
A completion transaction locks the request and refuses a terminal or suggestion
after its deadline. A cancelled request cannot later acquire a suggestion.

An authorized read presents a request with no terminal after its deadline as
`interrupted`, without mutating it or rerunning the provider. Repeated reads are
idempotent. A person may start a new request with a new idempotency key. If a
late completion races the deadline, only a terminal committed while the locked
request was still current can win; otherwise the incomplete request remains
`interrupted` and no suggestion is stored.

The service has no automatic retry. A person may make a new request with a new
idempotency key after a failure. That new request gets a new policy, consent,
ticket, and voice snapshot.

## Persistent records

The request, suggestion, review, and support-specific audit records live in the
tenant support database under forced RLS. Model resolution and stream-terminal
evidence remain in the control plane, where `PgModelRoutingStore` already writes
them. No cross-database foreign key is implied. Both sides share opaque request
and resolution references, and the application verifies the reference pair.

The planned migration paths are
`tooling/migrations/sql/tenant-support/<reserved-prefix>_support_ai_review.sql`
and
`tooling/migrations/sql/control-plane/<reserved-prefix>_model_resolution_consent_basis.sql`.
Immediately before SAI-01 starts, the coordinator reads both live catalogs,
reserves the next unused prefix in each, replaces both placeholders in this
contract with exact paths, and records the reservation in task evidence. M3
migration packets are serialized. Existing migration files are never edited or
renumbered.

### `support.ai_suggestion_requests`

One immutable row per authorized request:

- request id, tenant id, ticket id, and exact ticket version;
- requesting actor kind and stable actor id;
- bounded idempotency key and request timestamp;
- server-owned execution deadline;
- input watermark and SHA-256 input digest, with no ticket or knowledge content;
- `support` module id, `reviewed-suggestion` use case, and `primary` slot;
- prompt-template version, scaffold version, and their digest inputs;
- applied voice-profile version and digest, both nullable as one pair;
- correlation id and request schema version.

The row contains no subject, body, reply, internal note, requester identity,
provider credential, prompt, or provider response.

### `support.ai_suggestion_policy_snapshots`

One immutable row per request after successful preparation:

- request id and preparation-resolution id;
- provider and model identifiers;
- region served, retention posture, allowlist version, and resolution source;
- processing basis, either `tenant_region` or `cross_border_consent`;
- consent id and consent-policy version when the basis is cross-border;
- provider, region, and retention tuple covered by that consent.

The consent fields are all null for `tenant_region` and all present for
`cross_border_consent`. The router, not the support route, determines the basis.
The support route must not repeat policy filtering or infer consent from region
strings.

### `support.ai_suggestion_attempts`

One immutable row links a prepared policy to the provider attempt that actually
ran:

- request id, preparation-resolution id, and execution-resolution id;
- provider, model, region, retention, allowlist version, and actual credential
  origin from the execution record;
- attempt timestamp and stream-terminal reference.

Preparation uses operation kind `resolve` and records credential origin `none`.
Execution uses operation kind `stream` and carries the real tenant or
installation credential origin. The implementation must not copy the
preparation origin into the attempt.

SAI-01 extends the router's prepared-stream contract into one linked lifecycle.
`prepareStream` returns its preparation-resolution id. Starting the stream
brokers the credential and records the execution row before the adapter can
produce a byte, then returns an opaque execution-resolution id and the event
stream. The execution record carries the preparation id as its parent; no
credential value leaves the router. Completed, failed, and cancelled terminal
events identify that same execution id.

Before a suggestion transaction, the support service reads both control-plane
records and the stream terminal. It requires the preparation parent, execution
child, tenant, module, use case, provider, model, region, retention and allowlist
to match the request and policy snapshot; the execution must have one completed
terminal. A missing or mismatched preparation, execution, parent, credential
origin or terminal produces `audit_failure` and no suggestion. The tenant-side
attempt row stores only the verified opaque references and content-free fields.

The control-plane migration extends model-resolution evidence with the same
content-free basis and the execution-to-preparation parent reference.
`ModelRouter` returns the recorded preparation reference and basis as part of
its prepared policy, then exposes only the execution reference and terminal
state described above. Before the first provider byte, the router re-resolves
policy. Withdrawal, changed consent wording, changed pair coverage, allowlist
change, residency change, or retention change fails closed.

### `support.ai_suggestions`

One content-bearing row for a `review_required` terminal result:

- suggestion id and request id;
- suggested category and priority;
- rendered reply;
- validated claims, segments, citations, chunk ids, source references, source
  versions, and character spans needed by the reviewer;
- suggestion schema version and SHA-256 artifact digest;
- creation time.

The store accepts this row only from the service's validated domain result. It
recomputes the artifact digest and checks the closed category, priority, claim,
segment, and citation shapes. It never stores the adapter's raw response.

Suggestion content follows the ticket's support-retention period and purge. A
privileged retention function may remove the content-bearing row after its
retention deadline. The application role cannot update, delete, or truncate it.
Content-free terminal and audit evidence keeps the suggestion digest after
content deletion, matching the accepted rule that model-decision evidence may
outlive ticket content without pretending to reconstruct it.

### `support.ai_suggestion_terminals`

One immutable terminal row per request:

- terminal kind and reason code;
- suggestion id and artifact digest only for `review_required`;
- model-resolution reference when policy resolution reached that stage;
- completion time.

Database checks require the suggestion reference for `review_required`, forbid
it for every other outcome, and prevent a terminal from being replaced.

### `support.ai_suggestion_reviews`

An append-only record of the human review:

- review id, tenant id, request id, and suggestion id;
- reviewer actor kind and stable actor id;
- `reviewed` or `dismissed` decision;
- ticket version observed at review time;
- review timestamp.

Each suggestion accepts one terminal review decision. Database uniqueness rejects
a second `reviewed` or `dismissed` write by any actor. If the ticket version
changed, the UI marks the suggestion stale and the review endpoint returns `409`
until the reviewer reloads. Reloading does not make the stale suggestion current;
the person must request a new one if they still want assistance.

### `support.ai_suggestion_audit_events`

This append-only table carries content-free event evidence. Each row contains
tenant, request, ticket, actor, action, outcome or reason, policy reference,
voice version and digest, suggestion digest, correlation id, and timestamp. It
must never contain ticket text, message text, reply text, claim text, citation
text, knowledge text, prompt text, raw completion text, a credential, or a
provider error.

Request, terminal, suggestion, review, and their corresponding audit event use
one checked-out tenant client and commit or roll back together. Model-resolution
evidence remains the router's prerequisite. If the router cannot record its own
attempt or terminal evidence, the support request records `audit_failure` and
does not expose a suggestion.

All new tenant tables use forced RLS on `tenant_id`. Direct cross-tenant ids,
missing `app.tenant_id`, wrong-ticket links, update, delete, and truncate must
fail in PostgreSQL tests. The migration adds the tables to the RLS inventory and
updates the support module schema version.

## Voice-profile rule

The application loads the current profile only after tenant and ticket
authorization. It verifies the stored normalized profile against its immutable
digest, then builds exactly this projection:

```ts
interface AppliedSupportVoiceProfile {
  bannedWords: readonly string[];
  version: number;
  digest: string;
}
```

No other profile field enters the adapter input, system prompt, user prompt,
knowledge query, suggestion schema, or rendering code. The adapter cannot infer
the stored fields because its type does not carry them. `bannedWords` is applied
after rendering as whole-token refusal. A match refuses the entire suggestion
with `invalid_output`; it never strips or rewrites the word.

The request pins the profile version and digest that were current when the
authorized request was created. A later profile publication does not rewrite
that evidence. A digest mismatch fails before provider work. A profile with no
current version pins null for both fields and uses an empty ban list.

The full profile does not cross the provider boundary in this slice. The existing
cross-border wording question for brand or voice content therefore does not need
an answer for this request. Ticket and retrieved knowledge content still require
the model router's normal consent decision.

Any future use of `preferredWords`, examples, or style fields is a new accepted
contract. It cannot enter as a small edit to this packet.

## Terminal outcomes

The API maps provider and policy details to a closed product vocabulary. Raw
provider messages never reach the response or audit trail.

| Kind | Reason | Required behavior |
| --- | --- | --- |
| `review_required` | none | Persist the validated suggestion for human review |
| `abstained` | `low_confidence`, `insufficient_information` | Show that no draft was produced |
| `unavailable` | `disabled`, `budget_exhausted`, `no_knowledge`, `invalid_output`, `no_route`, `model_not_allowed`, `residency_mismatch`, `retention_mismatch`, `adapter_region_mismatch` | Leave the deterministic support flow untouched |
| `cancelled` | `user_cancelled`, `client_disconnected` | Abort the model stream, persist one terminal, and discard partial output |
| `interrupted` | `execution_deadline` | Present a past-deadline request with no terminal as incomplete; do not rerun it or store a suggestion |
| `consent_stale` | `policy_version_changed`, `consent_withdrawn`, `pair_no_longer_covered`, `prepared_policy_changed`, `consent_missing` | Call no provider after the failed recheck and ask the administrator to review model settings |
| `provider_failure` | `adapter_unavailable`, `adapter_error` | Preserve existing suggestions and offer a new manual request |
| `policy_unavailable` | `credential_unavailable`, `credential_broker_unavailable`, `credential_broker_failed`, `policy_store_unavailable`, `policy_unpinned`, `policy_mismatch`, `invalid_lifecycle`, `internal_error` | Fail closed without exposing provider details |
| `unsupported_request` | `ticket_state`, `capability_disabled` | Perform no policy resolution or provider work |
| `ticket_stale` | `version_changed` | Require a reload before another request |
| `audit_failure` | `resolution_evidence`, `terminal_evidence`, `support_evidence` | Fail closed and expose no suggestion |

SAI-01 owns one exhaustive, table-driven mapping from every current
`ModelResolutionErrorCode` and `ModelStreamFailureCode`:

| Router code | Product outcome |
| --- | --- |
| `CALLER_RESIDENCY_FORBIDDEN`, `TENANT_POLICY_MISMATCH` | `policy_unavailable / policy_mismatch` |
| `NOT_ALLOWLISTED` | `unavailable / model_not_allowed` |
| `ROUTER_POLICY_UNPINNED` | `policy_unavailable / policy_unpinned` |
| `RESIDENCY_MISMATCH` | `unavailable / residency_mismatch` |
| `RETENTION_MISMATCH` | `unavailable / retention_mismatch` |
| `UNRESOLVABLE_SLOT` | `unavailable / no_route` |
| `CREDENTIAL_UNAVAILABLE` | `policy_unavailable / credential_unavailable` |
| `CREDENTIAL_BROKER_UNAVAILABLE` | `policy_unavailable / credential_broker_unavailable` |
| `CREDENTIAL_BROKER_FAILED` | `policy_unavailable / credential_broker_failed` |
| `POLICY_STORE_UNAVAILABLE` | `policy_unavailable / policy_store_unavailable` |
| `ADAPTER_UNAVAILABLE` | `provider_failure / adapter_unavailable` |
| `ADAPTER_REGION_MISMATCH` | `unavailable / adapter_region_mismatch` |
| `PREPARED_POLICY_STALE` | `consent_stale / prepared_policy_changed` |
| `PREPARED_STREAM_CONSUMED` | `policy_unavailable / invalid_lifecycle` |
| `CONSENT_POLICY_STALE` | `consent_stale / policy_version_changed` |
| `CONSENT_PAIRS_EMPTY` | `consent_stale / consent_missing` |
| `AUDIT_RECORDING_FAILED`, stream `AUDIT_ERROR` | `audit_failure`, using the failed evidence stage |
| stream `ADAPTER_ERROR` | `provider_failure / adapter_error` |

An unexpected internal error maps only to
`policy_unavailable / internal_error`; its message is not stored or returned.
The test enumerates the exported code unions so adding a router code without a
product mapping fails. Cancellation remains an explicit signal outcome, not an
exception-message mapping.

`resolved` and `closed` tickets are unsupported for a new reviewed reply
suggestion. Existing suggestions remain readable while retained, but the UI
marks them historical. A new public reply, ticket update, permission change,
module disablement, or consent change never deletes earlier evidence.

Provider failure and cancellation do not erase a prior valid suggestion. The UI
may show the prior artifact as historical, with its ticket version and policy
metadata, but it may not describe it as current.

## Separate human-review interface

The Luna packet adds one review panel to the tenant ticket detail page. It stays
visually and structurally separate from the existing reply form.

The panel must show:

- `Review required` before the draft;
- the ticket version used and a stale label when the current version differs;
- suggested category and priority as read-only values;
- the draft reply;
- each claim with its source reference, source version, and citation span;
- the prompt template, scaffold, model policy, retention, and voice-profile
  version used, without exposing credentials or raw provider errors;
- clear abstained, unavailable, cancelled, stale-consent, provider-failure,
  unsupported, and audit-failure states.

The available controls are `Request suggestion`, `Cancel`, `Copy draft`,
`Mark reviewed`, and `Dismiss`. `Copy draft` writes only to the browser clipboard.
It does not fill or submit the reply form. The user pastes and edits in the normal
reply editor, then uses the existing `Send` button as a separate deliberate act.

There are no `Apply category`, `Apply priority`, `Send`, `Resolve`, `Close`,
`Create ticket`, `Publish`, `Release`, `Retry automatically`, or hidden automatic
controls in this panel. The panel must not call the ticket mutation route.

The UI omits deferred voice fields entirely. If a later interface displays them,
it must label each inert field as not used for suggestions. Saving a setting that
silently does nothing is not acceptable.

The panel needs keyboard-visible focus, live status text that does not steal
focus, semantic source disclosure, a cancellation announcement, narrow-screen
layout without document overflow, and disabled controls while the matching write
is pending. A reload must show the same persisted request, terminal, suggestion,
and review state after fresh authorization.

## Decision record for Support Agent P0

Decision: ticket-only P0 classification is an appropriate separate phase and is
not blocked by Developer MCP routes or module publication.

The first line of `docs/product/ai-support-agent.md` says the workstream is hard
blocked on those capabilities. Its P0 table says something different: P0 has no
repository access anywhere in the feature, no tools, no reproduction, no patch,
and no release. The current dependency section also lists the persistent P0
classification journey separately from later Developer MCP and publication work.

For implementation sequencing, the hard block applies to P1 through P4. P0 may
proceed after its own prerequisites are ready:

- a closed, bounded ticket-only classification schema with explicit abstention;
- tenant-bound authorization and durable classification evidence;
- model-routing, consent, retention, budget, opt-out, kill-switch, and rate-limit
  composition;
- injection-attempt telemetry;
- the accepted red-team fixture set and evaluation method.

P0 triage receives the ticket allowlist only. It does not retrieve knowledge and
does not reuse the reviewed-reply prompt. Its output is a classification record,
not a suggestion that can mutate category or priority. Human application remains
separate.

This `OT-D02` implementation is not P0 completion. It is the narrower reviewed
suggestion journey from the accepted support boundary. Register ticket-only P0
later as its own Sol packet. P1 reproduction, P2 repair, P3 staging, and P4
release remain deferred in phase order. No repository, sandbox, Developer MCP,
patch, release, or ticket-resolution workflow belongs in either follow-on below.

## Follow-on packet SAI-01, durable store and API composition

Owner: Sol high. Dependency: accepted `OT-D02` contract and completed model-policy
M2 work. Marketing impact: `truth` after verified behavior ships.

Allowed paths:

- `modules/support/src/support-ai-types.ts`
- `modules/support/src/support-ai-policy.ts`
- `modules/support/src/support-ai-service.ts`
- `modules/support/src/support-ai-adapters.ts`
- `modules/support/src/support-ai-review-store.ts`
- the matching `modules/support/src/*.test.ts` files and `src/index.ts`
- `packages/platform-core/src/model-routing.ts` and its test
- `packages/database/src/model-routing-store.ts`
- `packages/database/src/support-ai-review-store.ts`
- the matching database tests and `packages/database/src/index.ts`
- `apps/platform/lib/support-ai.ts` and its test
- `apps/platform/app/api/support/ai/suggestions/route.ts` and its test
- `apps/platform/app/api/support/ai/suggestions/[suggestionId]/reviews/route.ts`
- the matching route test
- `tooling/migrations/sql/tenant-support/<reserved-prefix>_support_ai_review.sql`
- `tooling/migrations/sql/control-plane/<reserved-prefix>_model_resolution_consent_basis.sql`
- `tooling/migrations/src/tenant-support-ai-review.integration.test.ts`
- `tooling/migrations/src/control-plane-model-routing-store.integration.test.ts`
- `tooling/ci/rls-proof.mjs` and `tooling/ci/rls-inventory.test.mjs`
- `tooling/ci/run-database-store-tests.mjs`
- `tooling/ci/run-database-store-tests.test.mjs`
- `tooling/ci/create-integration-databases.mjs`
- `tooling/ci/create-integration-databases.test.mjs`
- `.github/workflows/ci.yml`

The shared database-CI files are exclusive to SAI-01 while it runs. The packet
must register every new database-store integration file in the exhaustive
runner, add fixed guarded databases and URLs to the fixture creator, test both
inventories, and wire the URLs into the canonical `database-store-proof` job.
The aggregate `pnpm database:store-proof` run must execute every registered
suite with zero skips. The packet may not edit a prior migration, support pages,
the existing ticket
mutation route, Developer MCP, sandbox, publication, deployment, or provider
adapter code.

Build in this order:

1. Add failing domain tests for the fixed request shape, authority conjunction,
   ticket assembly exclusions, voice projection, closed outcomes, cancellation,
   stale consent, and no action authority.
2. Add failing PostgreSQL tests for RLS, tenant and ticket binding, append-only
   records, exact terminal cardinality, idempotency, atomic suggestion plus audit,
   safe retention deletion, and content-free evidence survival.
3. Extend model-resolution evidence with the router-owned consent basis and
   linked preparation and execution references. Prove withdrawal and stale
   policy fail before provider output. Add cross-database tests for a missing or
   mismatched parent, execution, credential origin, and stream terminal.
4. Implement the store and application composition. The provider adapter sees
   no internal notes, requester identity, deferred voice fields, credentials, or
   caller-selected policy.
   The tenant knowledge reader uses only published rows from the authorized
   tenant's `support.knowledge_articles` table and pins their content digests.
5. Add route tests that revoke permission or disable the module between requests
   and prove every read reauthorizes. Prove cross-tenant ids return no data.
   Prove a process interruption leaves zero terminals, authorized reads present
   the same `interrupted` outcome after the deadline, a new request can start,
   and a late completion cannot beat deadline locking or add a suggestion.
6. Use a table-driven test to cover every exported router and stream failure
   code, plus unexpected internal failure, without exposing raw messages.
7. Use spies or dependency fakes to prove every terminal branch makes zero calls
   to ticket, knowledge-publication, Developer MCP, sandbox, and release mutators.
8. Run focused unit, platform, migration, database-store, and RLS checks under
   Node 22 and PostgreSQL 17. Then run the repository delivery contract and
   `git diff --check`.

Acceptance evidence must include a real PostgreSQL run. A skipped integration
suite is not evidence. The local synthetic adapter is sufficient. This packet
does not authorize a live provider.

## Follow-on packet SAI-02, reviewed-suggestion interface

Owner: Luna high. Dependency: accepted SAI-01 API and a fresh Astra review of its
authority, consent, attribution, and no-action proofs. Marketing impact: `truth`
after browser acceptance.

Allowed paths:

- `apps/platform/app/support/[id]/page.tsx`
- `apps/platform/app/support/[id]/support-ai-review-panel.tsx`
- `apps/platform/app/support/[id]/support-ai-review-panel.test.tsx`
- a narrowly named ticket-page test under `apps/platform/app/support/[id]/`

The packet may consume the SAI-01 API contract. It may not edit API routes,
stores, permission vocabulary, the normal reply mutation route, model policy,
voice storage, ticket mutators, admin helpdesk, Developer MCP, sandbox,
publication, or release code.

Build in this order:

1. Add failing component tests for every outcome and for current, stale,
   reviewed, and dismissed suggestions.
2. Add failing interaction tests showing that request and cancel call only the
   suggestion API, review calls only the review API, and copy writes only to the
   clipboard.
3. Add a negative test that the panel has no submit control targeting
   `/api/support/tickets` and no action label or API payload for category,
   priority, status, assignment, reply sending, publication, or release.
4. Implement the panel and integrate it into the authorized tenant ticket page.
   Keep the existing reply form separate and unchanged.
5. Verify with BrowserOS Neo in a named agent-owned tab. Cover reload persistence,
   permission loss, tenant switching, ticket-version staleness, cancellation,
   failure recovery, clipboard copy, keyboard use, and widths 375, 768, and 1440.
6. Run platform tests, typecheck, lint, build, the full repository delivery
   contract, and `git diff --check` under Node 22.

Browser evidence must show that clicking any review-panel control cannot create a
message or alter category, priority, status, assignment, knowledge, code, or a
release. A successful copy is not a successful send.

## Astra review gates

A fresh Astra reviewer examines each fixed revision after deterministic checks.
The reviewer must answer these questions from source and evidence:

1. Does every request, read, and review derive tenant and actor from current
   authority and recheck both required permissions?
2. Can any caller select another tenant, actor, provider, model, consent, voice
   profile, ticket content, knowledge scope, or policy field?
3. Does the router own the recorded consent basis, and do stale wording,
   withdrawal, and pair mismatch stop the provider call?
4. Can the evidence chain join request, ticket version, actor, model resolution,
   policy, consent, voice version, suggestion digest, terminal, and human review
   without storing prompt or raw provider output?
5. Is `bannedWords` the only voice behavior, with every other stored field absent
   from adapter and renderer types?
6. Can any service, route, or panel path send a reply, mutate ticket state,
   publish knowledge, touch a repository, call Developer MCP, start a sandbox, or
   release code?
7. Do real PostgreSQL tests prove RLS, append-only evidence, terminal races,
   atomic audit, retention, and cross-tenant denial?
8. Does browser evidence prove a separate review step, persistent readback,
   staleness, cancellation, keyboard access, and no hidden action authority?

Unsupported findings must be rejected with source evidence. A passing unit suite
without database and browser proof does not clear the integrated gate.

## Product gates that remain

These decisions or external authorities are outside both implementation packets:

- The installation owner must select and approve the first live model provider,
  region, retention posture, development data boundary, and spend. Synthetic
  local proof does not satisfy that task.
- The accepted boundary requires short-lived owner-only quarantine for rejected
  raw completions but does not set the exact TTL, encryption key, incident-access
  permission, or deletion evidence. The owner must freeze those values before a
  live provider processes ticket content. SAI-01 may define the interface and
  synthetic tests, but it must fail closed rather than invent production values.
- Golden-set sourcing for non-adversarial evaluation remains unsettled. It does
  not block deterministic local route and store work, but it blocks any quality
  claim based on the 500-item evaluation contract.
- ADR-006's current consent question names ticket content, while reviewed
  suggestions can also send retrieved support knowledge. Before any out-of-region
  live call, the owner must publish consent wording that names both content
  classes and make it the current consent-policy version. SAI-01 tests this with
  synthetic policy versions and fails closed on the older wording.
- Platform and installation-owner shared knowledge still need a persistent,
  versioned publication and revocation store. The tenant-private first slice does
  not satisfy those accepted scopes.
- Managed-support review needs its own active-session composition packet.
- Any use of preferred words, example rewrites, or style fields needs a new
  accepted containment contract and evidence.
- Any P1 through P4 work needs its phase prerequisites. No part of this contract
  supplies repository, sandbox, publication, staging, production, or automatic
  ticket authority.

Completion of `OT-D02` means this design and its two packets have passed Astra's
contract review. It does not mean SAI-01, SAI-02, Support Agent P0, live model
processing, or voice-conditioned writing has shipped.
