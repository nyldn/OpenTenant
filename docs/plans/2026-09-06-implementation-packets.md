# OpenTenant implementation task packets

Date: 2026-09-06. Read the [program](2026-09-06-implementation-program.md) and
[source review](2026-09-06-code-review.md) first. These packets are proposed work,
not new ready entries in `unattended-backlog.json`.

Every worker reads its named sources before editing, uses a focused behavior
check for the reported defect, implements only owned paths, runs the package
checks below and submits the diff with evidence. The coordinator runs full gates
and obtains Astra review. New paths below are planned files, not existing APIs.

## OT-P01. Reconcile product truth and register this program

Owner: Sol high for ledger decisions; Luna high may apply the settled prose.
Milestone: G0. Dependencies: none. Marketing impact: `truth`.

Read `docs/HANDOFF.md`, `docs/OWNER-TASKS.md`, the current backlog, the original
paths/commits recorded in the review, and all requirement rows that remain
partial or deferred. Modify the current status sections in `docs/CODEX-HANDOFF.md`,
`docs/product/ai-support-agent.md`, `docs/product/brand-and-voice-documents.md` and
`docs/plans/2026-08-03-developer-mcp-route-enablement.md`. Add a current requirement
ledger at `docs/plans/product-requirements-status.md`.

- [ ] Give every Developer MCP FR-001 through FR-015, Lab FR-001 through FR-011,
  Support Agent phase P0-P4, and accepted brand/voice deliverable a status and
  source/test reference. Use `implemented locally`, `foundation`, `partial`,
  `deferred` or `owner-gated`; do not infer percentages.
- [ ] Preserve historical rejected-run evidence and accepted policy text. Correct
  present-tense claims, including Lab phase 0's committed status and the missing
  application brand upload. Keep the full Support Agent distinct from OPS-12.
- [ ] Register accepted repair/integration tasks using the current backlog schema,
  exact allowed paths, dependencies and check commands. Owner gates remain gates.
  Design-only/deferred work must not become an automatically executable code task.
- [ ] Record Sol/Luna/Astra assignments in the coordination ledger. Do not invent
  unsupported model fields in the controller backlog schema.
- [ ] Correct the unsupported `pnpm db:test` command and document a portable way
  to select the required Node version. Preserve unrelated handoff facts.
- [ ] Run `pnpm unattended:status` and the unattended package tests after any
  backlog edit. Astra checks every status against the corresponding source.

Rollback: revert only these status/registration changes. This task creates no
application availability claim and triggers no marketing acknowledgement.

## OT-R01. Enforce Assessment access at page and API boundaries

Owner: Sol high. Milestone: M1. Finding: R1. Marketing impact: `truth`.

Modify `apps/platform/lib/module-access.ts`,
`apps/platform/app/assessment/layout.tsx`,
`apps/platform/app/api/assessment-readout/route.ts` and their tests. Create
`apps/platform/lib/assessment-access.ts` and `assessment-access.test.ts` for the
shared decision if that keeps module-specific logic out of the generic helper.
Read `tenant-admin.ts`, `module-registry.ts` and the passcode route before choosing
how to load the enabled-module state.

- [ ] Define one trusted result carrying tenant identity, access mode and the
  authorized identity or passcode principal. Disabled or missing entitlement is
  unavailable. Identity mode requires a session bound to that tenant; passcode
  mode requires the valid signed tenant/module grant. Preserve the existing
  policy default and sensitive managed-support restrictions.
- [ ] Have the page translate denials to its existing redirects/unavailable UI.
  Have the API translate denials to bounded 401/403/404 responses with no-store.
  Complete the decision before admission, credentials or provider work.
- [ ] Validate the readout request as an unknown JSON value. Reject invalid
  structure/types with 400 and over-limit content with 413 before inference.
  Bound actual bytes read; a declared Content-Length is not the only limit.
- [ ] Add behavior coverage for permitted identity and passcode flows, revoked
  or disabled access and safe malformed-input handling. Check downstream call
  counts so rejection cannot still incur model work.
- [ ] Run `pnpm --filter @opentenant/platform test`, then full gates. Use the
  synthetic local app to verify login/passcode entry, Assessment display and
  denied readout behavior without real model calls.

Do not make the feature identity-only to simplify the implementation. Rollback is
the task revert; no schema changes should be needed.

## OT-R02. Make telemetry canonical and server-attributed

Owner: Luna high. Milestone: M1. Finding: R2. Marketing impact: `truth`.

Modify `packages/observability/src/index.ts`, its tests,
`apps/platform/app/api/telemetry/route.ts` and its tests. Read
`apps/platform/app/assessment/assessment-mount.tsx` for the current sender.

- [ ] Freeze the exact top-level input field set already described by
  `TelemetryEvent`. Validate object shape, bounded identities, event/module
  consistency, timestamp and event-specific property value types.
- [ ] Return a newly constructed canonical value containing only permitted
  fields. Build the emitted record from it and replace tenant attribution with
  the server-resolved tenant. Browser telemetry remains observational data.
- [ ] Retain the current null-tenant sender format for compatibility; it is not
  an authority input. No raw content or arbitrary fields may reach logs or errors.
- [ ] Verify the actual emitted record's keys and trusted tenant. Exercise valid
  page/export events and rejected invalid shapes using synthetic values only.
  Keep admission/replay behavior and content-free rejection messages intact.
- [ ] Run observability and platform tests, then full gates.

No persistent schema is needed. Do not add ticket text, answers or model prompts
to explain rejected telemetry. Rollback is a task revert.

## OT-R03. Preserve respondent identity and evidence through edits

Owner: Luna high. Milestone: M1. Finding: R3. Marketing impact: `content`.

Modify `modules/assessment/src/store.tsx`, `assessment-shell.tsx`,
`respondents.ts` and `respondents.test.ts`. Create a focused store/edit behavior
test if the current pure helpers cannot cover the real transition.

- [ ] Introduce an explicit edit operation that carries the saved respondent ID,
  scores, evidence and editable client fields. Do not use a score-only load to
  represent editing an existing respondent.
- [ ] Save edits against the original ID. New respondent creation retains its
  current duplicate-identity behavior unless the existing tests specify otherwise.
  Reset editing identity on new assessment, removal and switching demo state.
- [ ] Verify that a role/name/company change updates one respondent and preserves
  notes. Verify reload, cancel/new assessment and demo isolation. Include the
  exported respondent's evidence in the assertion.
- [ ] Run `pnpm --filter @opentenant/assessment test` and full gates. In the browser,
  create a synthetic response with a note, edit it, save and reload. Inspect the
  JSON download and visible response count.

Keep scoring and consolidation unchanged. Rollback is a code revert; retain the
stored respondent IDs and do not rewrite the existing roster on mount.

## OT-R04. Disable development tenant fallback in production

Owner: Sol high. Milestone: M1. Finding: R4. Marketing impact: `truth`.

Modify `apps/platform/lib/tenant.ts` and `tenant.test.ts`; extend
`apps/platform/middleware.test.ts` where needed. Read the architecture's tenant
resolution contract and `packages/domains/src/` normalization behavior.

- [ ] Check runtime mode at the fallback boundary itself. Production resolves
  verified active domains only and ignores development cookies, suffixes and
  default-tenant settings. Keep the verified-domain path first in every mode.
- [ ] Constrain configured development suffix matching to hostname-label
  boundaries. Preserve explicitly supported local development behavior.
- [ ] Verify the production/local distinction through synthetic resolver and
  middleware tests, including an accidentally retained development setting.
  No identity or database privilege changes belong in this packet.
- [ ] Run platform tests and full gates. Document this as a routing correction,
  not proof of a prior session or RLS failure.

Rollback is a code revert. This task does not edit hosted environment values.

## OT-R05. Restore both dependency audit gates

Owner: Sol high. Milestone: M1. Finding: R5. Marketing impact: `truth`.
Own all dependency manifests and both lockfiles until complete.

Read root `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/platform/package.json`,
the standalone starter manifests/lockfile and `.github/workflows/ci.yml`.
Apply `repo-delivery` for this dependency change.

- [ ] Rerun root and standalone production audits. Confirm current advisory
  fixes from primary maintainer/advisory sources and inspect reverse dependencies.
- [ ] Update the smallest compatible upstream dependency set. Use scoped
  overrides only when needed and document the compatibility basis. Do not force
  nanoid 3 consumers to version 5 or upgrade the entire framework opportunistically.
- [ ] Regenerate root and standalone lockfiles with pnpm 11.13.1. Verify fresh
  locked installation in a disposable consumer of `templates/tenant-module-nextjs`.
- [ ] Run both production audits at high severity, root full gates and the
  standalone starter build. Expected: audit exits 0; report remaining moderate
  findings explicitly rather than claiming the whole dependency tree is clear.
- [ ] Retain licence/provenance rules and record the delivered dependency versions.

Rollback: restore this task's manifest and lockfile versions together. No package
publication, provider spending or runtime enablement is included.

## OT-R06. Execute database store proofs in normal CI

Owner: Sol high. Milestone: M1. Dependencies: OT-R05. Finding: R6.
Marketing impact: `none`. Controller/proof edits require supervised execution.

Modify `.github/workflows/ci.yml`, `tooling/ci/create-integration-databases.mjs`,
and the relevant CI package scripts. Create
`tooling/ci/run-database-store-tests.mjs` with its tests. Read the current
integration guards and `tooling/ci/run-local-postgres-proof.mjs`; do not call that
helper directly without its controller-owned cluster metadata.

- [ ] Inventory every `packages/database/src/*.integration.test.ts` suite and its
  required database shape. Give each schema-resetting suite a separate disposable
  database or a serialized, fully recreated lifecycle. Never share one database
  across concurrently running destructive fixtures.
- [ ] Add a Linux CI job with PostgreSQL 17/pgvector, explicit synthetic database
  setup and exact suite commands. Include admission and usage store tests, not
  just their migrations. Keep restricted-role/RLS proof as a separate job.
- [ ] Collect structured test reports and require every named suite to execute
  with zero skipped tests. Missing URLs/tools or a missing suite must fail the
  job. Validate report counts against actual assertion results.
- [ ] Wire the existing quality-matrix assertion into the delivery check if the
  21-package/63-task rule remains the accepted contract. Do not invent additional
  package requirements merely to preserve a historic count.
- [ ] Run the CI helper tests, actual local database job, migrations and RLS.
  The new job is incomplete until PostgreSQL execution evidence exists. If this
  host still lacks PostgreSQL/Docker, retain the task as blocked on verification.

Rollback: revert CI/helper changes. Cluster cleanup may remove only databases
created for the current proof run; preserve application databases and credentials.

## OT-I01. Persist and extend the model policy contract for streaming

Owner: Sol high. Milestone: M2. Dependencies: M1. Finding: R7.
Marketing impact: `truth`.

Read `docs/architecture/adr-006-model-selection-and-residency.md`,
`packages/platform-core/src/model-routing.ts`,
`packages/database/src/model-credential-broker.ts`, and the existing model-routing
migration. Create `packages/database/src/model-routing-store.ts` and its tests.
Extend the model-routing contracts/tests and public exports without breaking
existing `resolve`/`complete` consumers.

The new database integration file also becomes part of OT-R06's exhaustive store
inventory. Extend the guarded database creator, store runner and CI environment
with one isolated model-routing database, and update their focused tests. Keep the
existing six suites and their evidence intact.

- [ ] Implement every existing `ModelRoutingStore` method over the accepted
  schema. Use tenant-bound policy, selection, consent, allowlist versions and
  attribution. If a field is missing, add a forward migration rather than editing
  migration history. Pin the schema/API mapping in the task's design before coding.
- [ ] Add a brokered streaming method that performs the existing policy and
  credential checks, records resolved metadata and forwards cancellation to an
  injected adapter. Secrets remain inside the adapter boundary. Expose only
  content chunks and safe completion/error state to the route.
- [ ] Define audit meaning for a resolved attempt separately from completion or
  failure. Keep content out of metadata. Do not emit billable usage from arbitrary
  client values or introduce billing policy.
- [ ] Verify same-tenant policy reads, allowlist/consent changes, residency and
  retention refusal, missing broker behavior, audit failure, cancellation and
  terminal-state cleanup using deterministic synthetic adapters.
- [ ] Run platform-core/database tests, the non-skipped store job and full gates.
  Astra reviews the policy/store/stream contract before OT-I02 starts.

No real endpoint claim or provider call is required. Rollback uses code reverts
and a separately reviewed forward recovery for any new schema; retain audit rows.

## OT-I02. Compose Assessment readouts through model policy

Owner: Sol high. Milestone: M2. Dependencies: OT-I01 and OT-R01.
Marketing impact: `truth`.

Modify `apps/platform/app/api/assessment-readout/route.ts` and tests. Create
`apps/platform/lib/assessment-readout.ts` and tests for composition. Change
`modules/assessment/src/ai.ts` only for the reviewed transport/error contract.

- [ ] Derive tenant and principal from OT-R01. Bind module/use case to server
  constants, then call the brokered streaming contract. Preserve the current SSE
  delta, done and bounded error behavior plus admission idempotency and deadline.
- [ ] Remove request/env provider fallback from this path. Missing accepted model
  policy returns a safe unavailable response. Do not silently move prompts to
  another provider when configuration cannot resolve.
- [ ] Exclude client provider/model hints from authority and normalize the
  idempotency fingerprint around the resolved policy. Decide and test how stale
  policy versions affect retry conflicts without replaying inference.
- [ ] Maintain the valid passcode journey with a server-derived tenant-bound
  principal. Review the ModelRouter boundary comment, which currently assumes
  identity-backed session derivation, and explicitly document this equivalent
  signed-grant authority. Do not source tenant identity from submitted content.
- [ ] Use the synthetic adapter to exercise the route and browser readout, including
  timeout, disconnect, unavailable configuration and exact attribution. Run
  platform/assessment tests and full gates.

Live endpoint activation awaits exact owner-approved configuration and provider
evidence. Keep the synthetic local journey usable without provider credentials.

## OT-I03. Connect brand upload to the existing proposal store

Owner: Sol high. Milestone: M2. Dependencies: OT-R06. Finding: R8.
Marketing impact: `truth`.

Read the accepted brand PRD sections 4, 6, 7, 11 and 13 and
`packages/platform-core/src/brand-document.ts`. Read the upload/provenance schema
in migrations `0020_brand_upload_provenance.sql` and `0022_brand_parser_versions.sql`
and their tests before adding schema. The existing `brand-proposal-store.ts`
handles review/edit/apply but does not create uploaded proposals. Extend it with
the transactional upload operation and its integration tests. Also modify
`apps/platform/lib/brand-proposal-read-model.ts` and create its focused test to
expose a typed, bounded provenance projection for the page. Modify the
brand-proposals API and tests; create
`apps/platform/lib/brand-document-upload.ts` and tests for bounded file handling.
The three new named PostgreSQL behaviors also become part of OT-R06's guarded
store inventory. Extend `tooling/ci/run-database-store-tests.mjs` and its focused
test so the aggregate report fails if any upload proof disappears or skips.

- [ ] Add a distinct upload action with current `brand.proposal.upload` authority
  and same-origin checks. When a different file would replace a live draft,
  require the same tenant session's separate `brand.proposal.supersede` authority
  inside the transaction boundary. Enforce the parser's 256 KiB and 64-key
  ceilings and the accepted encoding/media rules. Bound request bytes before
  materializing the file.
- [ ] Compute provenance from original bytes and use the registered parser version.
  Store the accepted representation through the new transaction method and reuse
  existing proposal review/edit/apply methods; never
  fetch embedded URLs, render uploaded HTML or add an AI parser.
- [ ] Preserve the accepted duplicate/re-upload/superseded semantics, tenant scope,
  immutable digest and transactional audit. Zero recognized values remains a
  visible parser failure, not a successful empty draft.
- [ ] Test successful upload through persistence and review, rejected invalid files,
  duplicate/racing requests, audit rollback and lock handling. Use disposable
  database fixtures. The API must not auto-approve or auto-apply a new upload.
- [ ] Read back source kind, original file digest, immutable parser version and
  upload attribution from the persisted rows through the page read model. Keep
  tenant filters on every join and exclude raw document content. Verify the
  projection against PostgreSQL, including legacy URL-origin proposals.
- [ ] Run platform/core/database checks, the database-store job and full gates.
  Hand Luna the exact form fields, typed provenance projection and bounded
  response states for OT-I04.

Keep URL seeding as its existing separate path. Rollback retains uploaded proposal
and audit records; it does not delete source evidence.

## OT-I04. Deliver the brand upload and review journey

Owner: Luna high. Milestone: M2. Dependencies: OT-I03.
Marketing impact: `content`.

Modify `apps/platform/app/admin/tenants/[tenantId]/brand-proposals/page.tsx` and
its tests. Add a focused client component beside the page only if upload progress
or form error state requires one. Read `brand-proposal-read-model.ts`.

- [ ] Add the accepted file input, constraints and error states using OT-I03's
  form contract. Show source kind, digest/parser provenance, draft status and
  rejected locked fields. Never render raw uploaded prose or HTML.
- [ ] Preserve explicit edit/review/apply/discard actions and reason requirements.
  Apply remains a separate human action after review.
- [ ] Verify keyboard upload, invalid-file recovery, successful draft creation,
  review, apply and resulting tenant branding through the synthetic browser app.
  Check unauthorized roles receive no controls and server denial remains effective.
- [ ] Run platform tests and full gates; attach responsive/browser evidence.

Rollback changes the UI only. Existing proposals and audit history remain intact.

## OT-I05. Unify Assessment save, restore and export

Owner: Luna high after Sol/Astra accept the conversion contract.
Milestone: M2. Dependencies: OT-R03. Finding: R9. Marketing impact: `content`.

Modify `modules/assessment/src/store.tsx`, `persistence/assessment-repository.ts`,
`persistence/engagement-schema.ts`, their tests, `assessment-exports.ts`,
`assessment-shell.tsx`, `assessment-results.tsx`, its behavior tests, `runtime.ts`
and module README. Modify platform Assessment
page/mount only to pass the agreed trusted storage context.

- [ ] First settle the versioned document mapping for client fields, scores,
  evidence, respondents, current progress and readout. Distinguish report JSON
  from a restorable engagement export. Define validation for every field used
  by the UI so persisted malformed data cannot break a later render.
- [ ] Move generated readout from results-only component state into the engagement
  state. Restore it on mount without automatically replacing it. Bind it to the
  assessment inputs used to generate it; changes to client details, scores,
  evidence or respondents mark it stale. Keep stale text recoverable, label it
  as stale, and require explicit regeneration before treating it as current.
- [ ] Use the repository as the live provider's persistence boundary. Preserve
  both legacy blobs until a validated conversion is saved and verified. Do not
  automatically erase corrupt or ambiguous legacy data; provide a recovery path.
- [ ] Scope new storage by server-supplied tenant context. For passcode mode keep
  the documented browser-local ownership; do not invent a durable user identity.
  Ask Astra to settle legacy ownership when no tenant marker exists before migration.
- [ ] Provide an explicit restore/import journey with validation before replacing
  state. Preserve the existing report/export content and label the formats clearly.
- [ ] Verify old-version conversion, reload, import/export round trip, respondent
  evidence, blocked/full storage, demo isolation and switching synthetic tenants
  on the same local origin. Invalid imports leave current data untouched.
- [ ] Verify ResultsScreen renders a restored current readout without a new model
  call, marks it stale after an input edit, and replaces it only after explicit
  successful regeneration. Failed generation preserves the prior recoverable text.
- [ ] Run Assessment/platform tests and full gates. Verify actual downloads and
  restored browser state, not just serialization helper output.

Rollback must keep legacy backups and new documents readable. Do not make a data
migration irreversible merely to simplify localStorage cleanup.

## OT-D01. Reconcile Developer MCP readiness without exposing it

Owner: Sol high. Milestone: M3. Dependencies: M2 and current owner-gate ledger.
Marketing impact: `truth`. Deliverable: a reviewed design/task breakdown.

Modify the current-status portions of the Developer MCP route plan and add
`docs/plans/developer-mcp-pre-exposure-contract.md`. Read the authority freeze,
threat model, protocol ADR, `call-authorization.ts`, `audit.ts`, sandbox contracts
and `developer-mcp-surface.test.ts`.

- [ ] Map every criterion in `OWNER-DEVELOPER-MCP-02` to existing proof, missing
  composition or an exact owner dependency. Credit completed audit/admission work;
  do not infer execution durability from an in-memory contract.
- [ ] Split remaining local work into persistent resource records, audit/admission
  composition, job authority lifetime, kill switch, protected-resource identity,
  preview mediation and client/output contracts. Name one owner and exact allowed
  paths per follow-on packet, with denied-by-default behavior and evidence.
- [ ] Preserve the no-application-route boundary. Publication, tenant credentials,
  brokered external access and hosted sandbox operations stay separately scoped.
- [ ] Astra reviews the assembled launch checklist and the authority boundary.
  The deliverable is complete when every criterion has an executable local task
  or named owner dependency, not when the route is reachable.

No application or sandbox code changes belong in this design packet.

## OT-D02. Specify persistent review-only Support AI and inert voice fields

Owner: Sol high for the contract; Luna high for the review UI specification.
Milestone: M3. Dependencies: model-policy M2 work. Marketing impact: `truth`.

Create `docs/plans/support-ai-review-composition.md`. Read the accepted support
boundary, `support-ai-service.ts`, `support-ai-types.ts`, voice profile stores and
the latest brand/voice ruling.

- [ ] Specify an authorized suggestion request and a separate human review UI.
  Pin one immutable voice version/digest and apply only permitted banned-word
  refusal. Preferred words, examples and style fields remain inert.
- [ ] Define persistence for request, consent, policy, suggestion and safe audit
  metadata, with tenant reauthorization at each read. Reuse model-routing policy.
- [ ] Name cancellation, stale consent, provider failure and unsupported-request
  outcomes. Suggestions may not send replies, change ticket state or release code.
- [ ] Reconcile Support Agent P0's dependency ambiguity in the accepted PRD.
  Produce a decision record for a ticket-only classification phase if appropriate.
  Later autonomous repository reproduction, repair and release remain deferred;
  do not add executable workflows for them in this packet.
- [ ] Split the accepted review-only implementation into Sol store/API and Luna UI
  tasks, with Astra's review of attribution, consent and the absence of action
  authority. Record any unsettled product decision explicitly.

Completion means the review-only implementation has a concrete contract. It does
not mean the autonomous Support Agent or live voice conditioning has shipped.

## OT-D03. Specify durable quality-contract binding

Owner: Sol high. Milestone: M3. Dependencies: OT-P01. Marketing impact: `truth`.

Create `docs/plans/quality-contract-persistence.md`. Read the Lab PRD,
`packages/quality-contract/src/contract.ts`, `evaluate.ts`, schemas and module
ownership/version stores.

- [ ] Credit the committed phase 0 schemas/evaluator. Specify immutable contract
  and evaluation records bound to the same tenant/module/version/artifact digest.
- [ ] Define same-transaction audit, stable reference integrity, read permissions
  and forward migration/retention behavior. Keep evaluation evidence immutable.
- [ ] Specify non-skipped database acceptance for tenant binding, version mismatch,
  duplicate submission, append-only history and baseline comparison.
- [ ] Split schema/store and application readback into follow-on packets. Observe
  ingestion needs separate consent/signal decisions; Propose, Experiment and
  cross-tenant reuse remain out of this implementation design.
- [ ] Astra reviews ownership and evidence lineage before code tasks are registered.

No model execution, experimentation or module publication belongs in this packet.
