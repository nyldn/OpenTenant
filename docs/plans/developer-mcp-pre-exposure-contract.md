# Developer MCP pre-exposure contract

Date: 2026-09-07

Status: design ready for Astra review. No Developer MCP application route is
authorized or present.

## Purpose

This contract turns `OWNER-DEVELOPER-MCP-02` into bounded implementation work.
It credits current source and tests, names what is still missing, and reserves
the exact files for each follow-on packet. Completing these packets prepares the
owner gate. It does not open the route or satisfy the gate by itself.

The accepted authority freeze controls when an older plan or PRD is broader.
The first route targets MCP `2026-07-28`, has no publication authority, uses no
tenant Git credential, brokers no tenant data or external API, and sends no
genuine tenant data to a sandbox.

## Sources read

- [`developer-mcp-authority-freeze.md`](../product/developer-mcp-authority-freeze.md),
  especially sections 6 through 10
- [`developer-mcp-threat-model.md`](../security/developer-mcp-threat-model.md)
- [`adr-006-developer-mcp-protocol-baseline.md`](../architecture/adr-006-developer-mcp-protocol-baseline.md)
- `packages/developer-mcp/src/call-authorization.ts`
- `packages/developer-mcp/src/audit.ts`
- `packages/sandbox/src/contracts.ts`, `policy.ts`, `orchestrator.ts`, and
  `testing/conformance.ts`
- `apps/platform/app/api/mcp/developer-mcp-surface.test.ts`
- `packages/platform-core/src/admission.ts`
- `packages/database/src/admission-store.ts` and `audit-store.ts`

## Boundary that every packet must preserve

1. No packet may add a file below `apps/platform/app/api/mcp/`, import
   `@opentenant/developer-mcp` from `apps/platform`, or weaken
   `developer-mcp-surface.test.ts`.
2. A policy, admission lease, feature flag, cache entry, client confirmation or
   sandbox response can only deny or narrow authority. None can add a slug.
3. Tenant, user, registered client, profile version, token scope, consent scope,
   tool descriptor, resource identity, limits and template policy come from
   trusted server state. Tool arguments cannot supply or override them.
4. Unknown, foreign, expired, disabled, malformed and unavailable states deny.
   Denials do not reveal whether a resource exists or belongs to another tenant.
5. No token, provider credential, control-plane credential, raw preview origin,
   source bytes, process output or provider error enters an authorization audit
   record.
6. The three unassignable slugs remain unassignable in code and in PostgreSQL.
   Publication and infrastructure approval stay unreachable.
7. Every database test uses a fresh loopback database whose name starts with
   `opentenant_it_`. A skipped named integration suite is not evidence.

## `OWNER-DEVELOPER-MCP-02` proof map

`Built locally` below means the named property has direct source and test proof.
It does not mean it is composed into an application route.

| Gate criterion | Existing proof | Missing composition or proof | Packet or owner dependency |
| --- | --- | --- | --- |
| `TM-001`: protected-resource metadata, exact resource URL and no token forwarding | `packages/auth/src/developer-mcp.ts` gives the bearer token only to the verifier and binds its principal to a host-resolved expected tenant. The WorkOS verifier tests exact audience validation. ADR-006 fixes one configured resource URL. | There is no metadata builder, configured-URL validator, route-independent authentication composition or positive forwarding test. Nothing is published. | `DMP-05` builds and tests the local contract. Publishing metadata at the exact owner-approved route remains `OWNER-DEVELOPER-MCP-02`. |
| `TM-007`: per-call recheck, 60-second freshness, synchronous high-risk recheck and capped job authority | `revocation.ts`, `call-authorization.ts` and their tests enforce the 60-second source/evidence limit and repeat a live check for high-risk slugs. | No persistent revocation resolver is composed. A returned allow decision has no job expiry or cancellation handle. | `DMP-03`; persistent resolution is composed in `DMP-02`. |
| `TM-009`: atomic audit append on the tool-call path | `audit.ts` defines the closed v2 union and deterministic chain. `call-authorization.ts` awaits exactly one append for allow and deny. Tests cover serialized append, append rejection and complete decision-code coverage. | The current adapter is in memory. There is no checked-out-client adapter, durable Developer MCP record, tool mutation or transaction that commits decision, admission and mutation together. | `DMP-02`. |
| Sandbox egress denial at connect time, including DNS rebinding and metadata addresses; v1 templates pin deny-all | `policy.ts` rejects IP literals, single-label names and internal suffixes. The Vercel adapter maps `deny_all` to the provider's deny-all setting. | The synthetic template is not either frozen v1 template. Callers still choose network policy. No local test proves a process cannot connect under deny-all, and no provider probe proves the address actually dialled is refused. | `DMP-01` pins deny-all and adds the executable conformance probe. A provider operator may run the exact ephemeral hosted probe only after the installation owner approves its provider, region, spend and cleanup scope. |
| No ambient credentials, proved positively | `SandboxCreateRequest` has no environment field and the orchestrator sends no credential value. | Field absence is not proof. No canary test starts a workspace with host credentials present and verifies that the workspace cannot read them. | `DMP-01` adds the local conformance probe. Any hosted-adapter proof has the same owner scope as the egress probe. |
| Per-call ownership at one named enforcement point, comparing workspace and tenant | `authorizeDeveloperMcpCall` calls `DeveloperMcpResourceAuthorizationAdapter.authorize` after revocation and before allow. The local adapter uses a compound resource-type/full-ID key, checks target tenant, user and slug, and permits workspace inheritance only from its tenant-matched parent project. Tests cover foreign tenant, user, slug, unknown ID and changed-ID prefix confusion. | Records and grants are snapshots in memory. There is no PostgreSQL lookup locked to the same transaction as a state change. | `DMP-01` persists the records and grants; `DMP-02` composes the store at the named call boundary. |
| `TM-008`: concurrency, duration, spend, rate, size and idempotency | `AdmissionPolicy`, `PgAdmissionStore`, migration `0026` and tests provide persistent request rate, concurrency, lease duration, input size and idempotency controls. Sandbox policy separately bounds workspace duration, commands, output and files. | Admission is used by telemetry, not Developer MCP. It has no MCP policy table or spend circuit breaker. A lease is not tied to a job, tool, resource or audit transaction. | `DMP-02` composes durable admission and spend denial. `DMP-03` binds the lease to job lifetime. The installation owner must set the initial local and hosted spend ceilings before route approval. |
| `TM-005`: one-time preview exchange, browser protections, revoke on termination and no raw origin disclosure | Sandbox contracts require authenticated HTTPS previews with bounded expiry. The Vercel adapter fails closed without an injected preview protector and returns the protector's URL instead of its provider origin. | There is no protector service, one-time browser exchange, tenant/user/client binding, CSP, `frame-ancestors`, or revocation record. | `DMP-07`. Hosted browser proof remains part of the owner-approved first-route and provider scope. |
| `TM-002`: prefix-confusion and cross-tenant conformance | Protocol fixtures reject caller-injected tenant metadata. Call-authorization tests deny unknown or whitespace-prefixed tool names. Local resource tests deny foreign tenants and a full ID changed only at its final character. | Those tests use local objects. The persistent store and composed call path need the same cases, including indistinguishable nonexistent and foreign-resource responses. | `DMP-01` and `DMP-02`. |
| `TM-011`: confirmation for consequential calls and untrusted output labels | High-risk slugs are classified in the frozen descriptor catalogue. ADR-006 refuses MCP `input_required` and says hostile output cannot author a question. | No server-issued confirmation record binds a human decision to the client, user, tenant, tool, resource and input digest. Returned tool/resource data has no closed trust label or common redaction boundary. | `DMP-06`. |
| FR-015: kill switch independent of module health and unable to grant | Revocation and module disable behavior exist as separate foundations. | There is no Developer MCP installation or tenant kill switch, durable state, audit event or check before authorization. Module health cannot substitute for it. | `DMP-04`. |

## Follow-on packet order

| Order | Packet | Owner | Depends on | Result |
| --- | --- | --- | --- | --- |
| 1 | `DMP-01` persistent resource records and execution policy | Sol high | accepted contract | Durable tenant-bound project, workspace, grant and template records; local probe definitions and adapter mapping |
| 2 | `DMP-05` protected-resource identity | Sol high | accepted contract | Runtime package scaffold, exact configured resource identity and token-custody contract, still without a route |
| 3 | `DMP-02` audit and admission composition | Sol high | `DMP-01`, `DMP-05` | Route-independent transactional call service backed by PostgreSQL |
| 4 | `DMP-03` job authority lifetime | Sol high | `DMP-02` | Capped authority lease and cancellation behavior |
| 5 | `DMP-04` independent kill switch | Sol high | `DMP-02` | Durable fail-closed installation and tenant disable checks |
| 6 | `DMP-06` client confirmation and output contracts | Sol high | `DMP-02`, `DMP-03`, `DMP-04` | One-time consequential-call confirmation and bounded untrusted output |
| 7 | `DMP-07` preview mediation | Sol high | `DMP-01`, `DMP-03`, `DMP-04`, `DMP-06` | One-time tenant-bound preview exchange with revocation |

The owner of each packet is the only implementation worker for its allowed
paths. The coordinator owns shared backlog status, task evidence, Graphify and
commits. A fresh Astra high review follows each accepted packet and the assembled
checklist.

Every command below runs through `fnm exec --using=22 --`. Each packet first runs
its named tests, then `pnpm check`,
`pnpm turbo build --filter=@opentenant/platform`, and `git diff --check`.
Database packets also run `pnpm --filter @opentenant/migrations test` and the
named integration file with zero skips. The coordinator records the exact
revision, command, exit code, test count and skip count.

### Shared migration and database-CI ownership

Migration-owning packets are serialized across M3. Immediately before one
starts, the coordinator reads both migration catalogs, reserves the next unused
numeric prefix in the affected catalog, replaces the packet's `<reserved-prefix>`
path below with that exact path, and records the reservation in its evidence.
No worker may assume that the prefixes visible when this design was accepted are
still free, and no packet may edit or renumber an existing migration.

Every database-bearing DMP packet also owns these shared delivery files while it
is active:

- `tooling/ci/run-database-store-tests.mjs`
- `tooling/ci/run-database-store-tests.test.mjs`
- `tooling/ci/create-integration-databases.mjs`
- `tooling/ci/create-integration-databases.test.mjs`
- `.github/workflows/ci.yml`

That ownership is exclusive and serialized. The packet must register every new
database integration file in the exhaustive store inventory, add a fixed guarded
database and URL to the fixture creator, test both changes, and wire the URL into
the canonical `database-store-proof` CI job. Its acceptance run executes the
aggregate `pnpm database:store-proof` command with every registered suite present
and zero skips; a focused integration command alone is not sufficient.

## `DMP-01`: persistent resource records and execution policy

Owner: Sol high.

Allowed paths:

- `tooling/migrations/sql/control-plane/<reserved-prefix>_developer_mcp_resources.sql`
- `packages/database/src/developer-mcp-resource-store.ts`
- `packages/database/src/developer-mcp-resource-store.test.ts`
- `packages/database/src/developer-mcp-resource-store.integration.test.ts`
- `packages/database/src/index.ts`
- `packages/developer-mcp/src/template-registry.ts`
- `packages/developer-mcp/src/template-registry.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/sandbox/src/template.ts`
- `packages/sandbox/src/template.test.ts`
- `packages/sandbox/src/index.ts`
- `packages/sandbox/src/testing/security-conformance.ts`
- `packages/sandbox/src/testing/security-conformance.test.ts`
- `packages/sandbox/src/testing/index.ts`
- `packages/sandbox/src/providers/vercel/adapter.test.ts`

Implement immutable project and workspace identities, parent linkage, tenant
ownership, explicit profile-version grants, lifecycle state and the frozen
template identifier/digest. Persist only `deny_all` for both v1 templates. The
database rejects unknown profiles, unassignable slugs, cross-tenant parents,
mutable template identities and duplicate opaque IDs.

Default denial evidence:

- Unknown, foreign, archived or mismatched resources return the same denial.
- Project-to-workspace inheritance succeeds only when tenant, user and slug all
  match the persistent grant.
- A concurrent create cannot produce two records for one idempotency key or
  reuse an opaque ID under another resource type.
- Local tests define the credential-canary and IPv4, IPv6, DNS-name and
  provider-metadata probes, verify the frozen requests, and prove the Vercel
  adapter maps `deny_all` to its provider contract. The in-memory adapter is not
  a process-isolation boundary, so these tests are probe-definition and mock
  evidence only.
- Actual credential absence and connect-time denial must be demonstrated by
  the owner-approved ephemeral hosted sandbox probe. Until that readback is
  attached, the corresponding launch-checklist rows remain incomplete.

Evidence:

- `pnpm --filter @opentenant/developer-mcp test`
- `pnpm --filter @opentenant/sandbox test`
- `pnpm --filter @opentenant/migrations test`
- With `OPENTENANT_LOCAL_POSTGRES_PROOF=developer-mcp-resources` and a fresh
  `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, run
  `pnpm --filter @opentenant/database test -- developer-mcp-resource-store.integration.test.ts`.
  Zero skipped tests is required.

## `DMP-02`: audit and admission composition

Owner: Sol high.

Allowed paths:

- `tooling/migrations/sql/control-plane/<reserved-prefix>_developer_mcp_execution.sql`
- `packages/database/src/developer-mcp-audit-store.ts`
- `packages/database/src/developer-mcp-audit-store.test.ts`
- `packages/database/src/developer-mcp-audit-store.integration.test.ts`
- `packages/database/src/developer-mcp-policy-store.ts`
- `packages/database/src/developer-mcp-policy-store.test.ts`
- `packages/database/src/developer-mcp-policy-store.integration.test.ts`
- `packages/database/src/admission-store.ts`
- `packages/database/src/admission-store.test.ts`
- `packages/database/src/admission-store.integration.test.ts`
- `packages/database/src/index.ts`
- `packages/developer-mcp-runtime/src/call-service.ts`
- `packages/developer-mcp-runtime/src/call-service.test.ts`
- `packages/developer-mcp-runtime/src/call-service.integration.test.ts`

Add a checked-out-client Developer MCP audit adapter and checked-out-client
admission operations. The route-independent call service resolves persistent
authority and resources, admits the request, calls
`authorizeDeveloperMcpCall`, runs one injected local handler and commits the
state change with its authorization record in one PostgreSQL transaction. A
denial may commit its own audit record but never a lease or mutation. Audit or
admission failure prevents handler execution.

The MCP policy must cover tenant and user concurrency, job duration, request and
response size, request rate, idempotency retention and a spend ceiling. The
spend ceiling defaults to zero until the installation owner records a bounded
policy. Generic admission evidence is reused, not relabelled as authorization or
billing.

Default denial evidence:

- Missing policy, profile assignment, consent, resource, audit adapter or
  database availability denies before a handler runs.
- Same idempotency key and fingerprint replays one result. A changed fingerprint
  conflicts. Concurrent calls cannot exceed the stored policy.
- Rollback tests inject failure after the audit append and after the mutation;
  neither leaves partial state, an active lease or a committed audit record.
- Persistent prefix-confusion and cross-tenant cases return the same external
  denial and append only their truthful resolved identity stage.
- `developer-mcp-surface.test.ts` still reports only the Brain MCP route and no
  application import of `@opentenant/developer-mcp`.

Evidence:

- `pnpm --filter @opentenant/developer-mcp-runtime test`
- With `OPENTENANT_LOCAL_POSTGRES_PROOF=developer-mcp-call` and a fresh
  `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, run the Developer MCP audit,
  admission and call-service integration files. Zero skipped tests is required.
- `pnpm --filter @opentenant/platform test -- developer-mcp-surface.test.ts`

## `DMP-03`: capped job authority lifetime

Owner: Sol high.

Allowed paths:

- `packages/developer-mcp/src/job-authority.ts`
- `packages/developer-mcp/src/job-authority.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/developer-mcp-runtime/src/job-runner.ts`
- `packages/developer-mcp-runtime/src/job-runner.test.ts`
- `packages/developer-mcp-runtime/src/index.ts`

Represent job authority as an opaque, non-transferable lease bound to tenant,
user, registered client, tool, slug, resource, profile version, admission lease
and input digest. Its expiry is the earliest of token expiry, admission expiry
and 60 seconds after the last live authority check. No cache or requested
duration may extend it. Long work must stop or obtain a new per-call decision;
renewal creates a new audit correlation, never a silent extension.

Default denial evidence covers expiry at each bound, backward or invalid clocks,
revocation while work is running, changed resource/input, reused job handles and
failure to release admission. The runner cancels the injected job and revokes
its preview on any failed check.

Evidence:

- `pnpm --filter @opentenant/developer-mcp test -- job-authority.test.ts`
- `pnpm --filter @opentenant/developer-mcp-runtime test -- job-runner.test.ts`

## `DMP-04`: independent kill switch

Owner: Sol high.

Allowed paths:

- `tooling/migrations/sql/control-plane/<reserved-prefix>_developer_mcp_kill_switch.sql`
- `packages/database/src/developer-mcp-kill-switch-store.ts`
- `packages/database/src/developer-mcp-kill-switch-store.test.ts`
- `packages/database/src/developer-mcp-kill-switch-store.integration.test.ts`
- `packages/database/src/index.ts`
- `packages/developer-mcp/src/kill-switch.ts`
- `packages/developer-mcp/src/kill-switch.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/developer-mcp-runtime/src/call-service.ts`
- `packages/developer-mcp-runtime/src/call-service.test.ts`
- `packages/developer-mcp-runtime/src/catalog-service.ts`
- `packages/developer-mcp-runtime/src/catalog-service.test.ts`

Store installation and tenant switch state separately from module catalog,
module assignment, sandbox health and provider health. Missing, malformed,
unreadable or disabled state denies. The switch check runs before tool listing,
admission and per-call authorization. Its return type can only be `enabled` or a
denial code. It carries no profile, slug or allow decision.

Switch changes require installation-owner authority and a same-transaction
audit event with the old state, new state, reason and actor. A tenant can be more
restrictive than the installation state, never less restrictive.

Evidence includes PostgreSQL tests for missing state, tenant disable,
installation disable, concurrent change, audit rollback and attempts to use the
switch result as authority. Run the named integration file with a fresh guarded
database and require zero skips.

Evidence:

- `pnpm --filter @opentenant/developer-mcp test -- kill-switch.test.ts`
- `pnpm --filter @opentenant/developer-mcp-runtime test -- call-service.test.ts catalog-service.test.ts`
- With `OPENTENANT_LOCAL_POSTGRES_PROOF=developer-mcp-kill-switch` and a fresh
  `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, run
  `pnpm --filter @opentenant/database test -- developer-mcp-kill-switch-store.integration.test.ts`.
  Zero skipped tests is required.

## `DMP-05`: protected-resource identity and token custody

Owner: Sol high.

Allowed paths:

- `packages/developer-mcp/src/protected-resource.ts`
- `packages/developer-mcp/src/protected-resource.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/auth/src/developer-mcp.ts`
- `packages/auth/src/developer-mcp.test.ts`
- `packages/auth/src/workos/developer-mcp.ts`
- `packages/auth/src/workos/developer-mcp.test.ts`
- `packages/auth/src/index.ts`
- `packages/developer-mcp-runtime/package.json`
- `packages/developer-mcp-runtime/tsconfig.json`
- `packages/developer-mcp-runtime/src/resource-identity.ts`
- `packages/developer-mcp-runtime/src/resource-identity.test.ts`
- `packages/developer-mcp-runtime/src/index.ts`
- `scripts/assert-quality-pipeline.mjs`
- `docs/DELIVERY.md`
- `pnpm-lock.yaml`

Create the route-independent runtime package before adding its identity service.
Build protected-resource metadata from one configured HTTPS URL. Startup fails
if it is missing, has credentials or a fragment, is not canonical, or differs
from the verifier audience. Request host and forwarded headers cannot change it.
The route-independent authenticator owns the bearer string only long enough to
call the verifier. Downstream authority, audit, admission, resource and sandbox
ports receive a copied principal with no header or token field.

Positive token-custody tests use a unique canary token and spies at every
downstream port. The verifier sees it once. No other call, result, exception,
log fixture or serialized record contains it. Wrong resource, multi-audience,
unregistered client and provider failure all produce the same bounded denial.

Evidence:

- `pnpm --filter @opentenant/auth test -- developer-mcp.test.ts`
- `pnpm --filter @opentenant/developer-mcp test -- protected-resource.test.ts`
- `pnpm --filter @opentenant/developer-mcp-runtime test -- resource-identity.test.ts`

The runtime command must name and pass at least one test. A successful filter
with `No projects matched` or zero executed tests fails this packet.
Because the runtime package is a new workspace, this packet must also update the
delivery assertion and its documented contract from 21 workspaces and 63 tasks
to 22 workspaces and 66 tasks. `pnpm quality:matrix` must report exactly 22 lint,
22 typecheck and 22 test tasks, including one nonempty task of each kind for
`@opentenant/developer-mcp-runtime`.

## `DMP-06`: client confirmation and output contracts

Owner: Sol high.

Allowed paths:

- `tooling/migrations/sql/control-plane/<reserved-prefix>_developer_mcp_confirmations.sql`
- `packages/database/src/developer-mcp-confirmation-store.ts`
- `packages/database/src/developer-mcp-confirmation-store.test.ts`
- `packages/database/src/developer-mcp-confirmation-store.integration.test.ts`
- `packages/database/src/index.ts`
- `packages/developer-mcp/src/confirmation.ts`
- `packages/developer-mcp/src/confirmation.test.ts`
- `packages/developer-mcp/src/output.ts`
- `packages/developer-mcp/src/output.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/developer-mcp-runtime/src/client-contract.ts`
- `packages/developer-mcp-runtime/src/client-contract.test.ts`
- `packages/developer-mcp-runtime/src/index.ts`

A server-issued confirmation binds one human decision to the registered client,
user, tenant, exact tool, resource, input digest and short expiry. It is consumed
once in the same transaction as admission and authorization. Confirmation is
required for the exact consequential set: `workspace.create`,
`workspace.resume`, `workspace.snapshot`, `workspace.archive`, `build.run` and
`preview.open`. This includes the medium-risk workspace mutations as well as
the high-risk build and preview calls. The read-only workspace, contract and
evidence list/get tools do not require confirmation. Unassignable publication
and infrastructure tools remain absent rather than entering this map. A tool
result, model response, sandbox output or MCP `_meta` value cannot issue or
satisfy confirmation. MCP `input_required` stays unsupported.

Every tool and resource result uses a closed envelope with `trust: "untrusted"`,
content type, byte count, digest and redacted bounded content. Provider errors,
environment-shaped values and token-shaped strings are removed before the
envelope is built. Truncation is explicit. Unknown output fields fail validation.

Default denial evidence covers stale, replayed, cancelled, cross-client,
cross-user, cross-tenant, wrong-tool, wrong-resource and changed-input
confirmations. PostgreSQL races may consume a confirmation once, not twice.
Tests must also prove every named consequential medium- and high-risk tool is
denied without confirmation and every named read-only tool remains governed by
ordinary authorization without acquiring confirmation authority. Redaction
tests use canaries and prove that neither content nor metadata retains them.

Evidence:

- `pnpm --filter @opentenant/developer-mcp test -- confirmation.test.ts output.test.ts`
- `pnpm --filter @opentenant/developer-mcp-runtime test -- client-contract.test.ts`
- With `OPENTENANT_LOCAL_POSTGRES_PROOF=developer-mcp-confirmation` and a fresh
  `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, run
  `pnpm --filter @opentenant/database test -- developer-mcp-confirmation-store.integration.test.ts`.
  Zero skipped tests is required.

## `DMP-07`: preview mediation

Owner: Sol high.

Allowed paths:

- `tooling/migrations/sql/control-plane/<reserved-prefix>_developer_mcp_previews.sql`
- `packages/database/src/developer-mcp-preview-store.ts`
- `packages/database/src/developer-mcp-preview-store.test.ts`
- `packages/database/src/developer-mcp-preview-store.integration.test.ts`
- `packages/database/src/index.ts`
- `packages/developer-mcp/src/preview.ts`
- `packages/developer-mcp/src/preview.test.ts`
- `packages/developer-mcp/src/index.ts`
- `packages/developer-mcp-runtime/src/preview-mediator.ts`
- `packages/developer-mcp-runtime/src/preview-mediator.test.ts`
- `packages/developer-mcp-runtime/src/index.ts`

Store the raw provider origin only in the trusted server record. Return a
one-time opaque exchange handle that is bound to tenant, user, registered client,
workspace, job authority and expiry. A successful exchange rotates the handle
and returns only mediated content with a fixed CSP, restrictive
`frame-ancestors`, `nosniff`, no-referrer and no-store policy. The raw origin
never appears in a client result, redirect, error, audit detail or log fixture.

Workspace stop, restore, archive, job cancellation, kill-switch disable,
membership revocation and expiry revoke every related handle before teardown
reports success. Unknown, foreign, consumed, expired and revoked handles have an
identical response. Database tests cover consume and revoke races with zero
skips.

This packet builds the mediator service and response contract only. The browser
endpoint, public URL and hosted provider check remain absent until
`OWNER-DEVELOPER-MCP-02` authorizes the exact route.

Evidence:

- `pnpm --filter @opentenant/developer-mcp test -- preview.test.ts`
- `pnpm --filter @opentenant/developer-mcp-runtime test -- preview-mediator.test.ts`
- With `OPENTENANT_LOCAL_POSTGRES_PROOF=developer-mcp-preview` and a fresh
  `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, run
  `pnpm --filter @opentenant/database test -- developer-mcp-preview-store.integration.test.ts`.
  Zero skipped tests is required.

## Owner dependencies after local acceptance

The local packets stop with the application route still absent. The following
actions need named owner scope:

| Dependency | Responsible owner | Required decision or evidence |
| --- | --- | --- |
| Initial spend policy | Chris, as installation owner | Maximum local and hosted spend, provider scope and region. A missing value keeps the circuit breaker at zero. |
| Hosted sandbox security proof | Chris, then the nominated provider operator | Exact ephemeral provider project, frozen v1 template, region, credential-canary method, deny-all network probe, cost ceiling and teardown evidence. |
| First callable route | Chris through `OWNER-DEVELOPER-MCP-02` | Exact URL, first exposed tool subset, pilot tenants and client registrations after all local and hosted evidence links are complete. The current verifier supports WorkOS only; choosing Clerk requires a separate verifier packet. |
| Publication | Chris plus a separately accepted `TM-010` design | Publisher profile, proposal/approval separation, immutable artifact evidence and rollback. No current packet starts this work. |
| Brokered tenant data, external API or tenant repository | Chris through a later capability freeze | Destination, methods, credential custody, consent, revocation, connect-time address control and genuine-data scope. No current packet starts this work. |
| Production or genuine tenant data | Chris | Deployment, identity, database, retention, restore, incident, domain and data scope. Local acceptance grants none of these. |

## Launch checklist for Astra and the owner

Astra reviews the assembled packet evidence at one fixed revision. The review
must reject route readiness if any answer below lacks a direct test or approved
external readback.

- Does `developer-mcp-surface.test.ts` still prove there is no application
  route or application import?
- Does every gate row above link to a passing local test, or to the exact owner
  decision and provider evidence it needs?
- Can audit, admission, resource mutation and confirmation consumption commit or
  roll back as one transaction?
- Can any missing store, policy, switch, confirmation, membership check or
  revocation check produce an allow?
- Can any cache, lease, job or preview remain authoritative for more than 60
  seconds without a new live check?
- Can a foreign tenant, changed opaque ID, prefixed tool name, stale handle or
  changed input produce a distinguishable response?
- Can the sandbox read an ambient credential or make any connection under the
  pinned v1 deny-all policy?
- Can the client see a raw preview origin, trusted label on hostile content,
  provider error, token-shaped value or environment-shaped secret?
- Do the three unassignable slugs remain blocked by both code and database
  constraints?
- Did every named PostgreSQL suite run with zero skips against a fresh guarded
  database?

Only after Astra accepts this checklist may the installation owner consider
`OWNER-DEVELOPER-MCP-02`. Owner approval then authorizes only the exact route and
tool subset written into that decision. It does not authorize publication,
brokered access, hosted expansion, production or genuine tenant data.
