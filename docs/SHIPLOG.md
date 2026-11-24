# OpenTenant ship log

## 2026-11-24 — clean contribution checkout

- Prepared a clean-history import with local development files ignored.
- Added staged and history privacy checks to Git hooks and CI.
- Publication requires an approved destination and the owner review in
  [Owner tasks](OWNER-TASKS.md).

## 2026-11-17: Local UAT provisioning and export controls

Added worktree/run/process and disposable-container guards for operator-only
provisioning failure/clear/status and tenant export expiry. The real worker
fails naturally on a fixture migration table and succeeds through product
retry; expired downloads use the existing denial path. Reset removes control
state and restores private brand assets. No production hooks or hosted service
changes. See [Q1 verification](reviews/2026-11-17-wave7-q1-controls.md).
Marketing impact: none.

## 2026-11-17: E11 documentation reconciliation

Reconciled README, capability/requirement status, handoffs, owner gates and
tooling guides against committed wave-5/6 receipts. The
[E11 ledger](plans/2026-11-17-e11-reconciliation.md) distinguishes real local
MCP route proof, Support review UI, Brain unavailable UI, synthetic provider
adapters, collection counts and frozen production budgets. UAT-015 remains open;
wave-7 UAT/ECS results await integrator receipts. Hosted Actions remains
billing-blocked and KVM CI owner-gated. Historical review files are unchanged.
Marketing impact: none, existing evidence corrections only. No public npm,
licence, production or release gate changes.

## 2026-11-14: Persistent synthetic UAT

Added `uat:serve` and `uat:down`, production worker provisioning, seeded
journeys and personas, private manifests and SSH tunnel instructions. The
runner shares e2e fixtures and loopback controls and cleans up on signals.
[Guide](tooling/uat.md). Marketing impact: none.

## 2026-11-14: Real local sandbox and SMTP proofs

Added required Docker/KVM microsandbox lifecycle and isolation proof plus
Mailpit SMTP application paths. Local proofs pass with zero skips: VM boot
0.447 s, complete microVM command 3.906 s; four SMTP tests in 18.612 s.
Fixed consumed exec exit status and stopped VM records left by teardown.
Added digest-pinned containers and Ubuntu CI jobs, pending first CI execution
and owner confirmation of runner KVM. No push, PR or production activation.
[Verification](reviews/2026-11-14-real-sandbox-smtp-proofs.md).
Marketing impact: truth.

## 2026-11-11: runtime environment lint families

Closed computed process access, ambient global aliases and reflection,
module-loader imports, nonliteral dynamic imports and common code-generation
escapes across all three runtime source roots. Moved legitimate global access
behind narrow helpers and retained lazy optional SMTP loading. Added all
fourteen grader regressions, further evasions and explicit residual tests.
See [local verification](reviews/2026-11-11-env-lint-families.md). Marketing impact: none.

## 2026-11-11: ECS wave 5 local verification

Closed environment lint bypasses, separated the legacy upgrade fixture from
canonical fresh provisioning, added generated SQL cache restoration proof, and
fixed E2E listing. Added a CI-backed local Verdaccio publication/install proof
for all 23 public packages. Public provenance still requires the owner-gated
GitHub OIDC release. See [measured verification and retries](reviews/2026-11-11-ecs-wave5.md).

## 2026-11-11: integration wave 4b

Integrated isolated database CI and production-provisioned browser fixtures with
the built-package and module-registry framework. Brain owns its real tool route
through its manifest. Developer MCP now has canonical migrations, global startup
validation, exact-count CI, local/Better Auth PKCE metadata and browser mutation
confirmation. Production activation remains owner-gated; no real VM isolation
claim is made. Better Auth signup, invitation acceptance, login and logout have
rendered browser regression coverage.

Added the unpublished `create-opentenant` package and original minimal-host
templates. Clean Node 22 proofs measure 40.463 seconds for local identity and
41.278 seconds for Better Auth, below ten minutes, with migrations, one synthetic
tenant, typecheck, home 200 and real identity-session checks. All nineteen browser
cases, 23 public-package checks, the zero-special-case module audit, 139 database
sequence tests, 166 MCP/Brain tests and 314 RLS checks pass. Restore loses zero
synthetic rows with measured RTO 14.574 seconds. Non-default-port smoke passes.
The final forced gate passes 112 tasks and 2,044 tests with zero failures and
75 skips. Dedicated database proofs cover 73 skips; real SMTP and microsandbox
remain unverified. See [the full record](reviews/2026-11-11-integration-wave4b.md)
for every command, skip and failed development run. No push, PR, npm publication
or production enablement occurred. Marketing impact: truth.


## 2026-11-11: integration wave 4a

Integrated package/release maturity, the module registry and restore/adopter
tooling. Modules ship built entrypoints and SQL; installation and fleet planning
use registry catalogs. Module-owned routes and contributions replace native
branches in the host and shared packages. A CI proof installs packed Hello with
one composition-line change and no core edits. Runtime env lint is an error
across apps, packages and modules.

The final gate passes 108/108 tasks, 2,027 tests and zero failures; 50 of its 52
skips pass in dedicated database proofs. Real SMTP and microsandbox integration
remain unverified. Package checks pass 22 packages, browser e2e passes 11 cases,
and local deployment smoke passes on non-default ports. Restore loses zero
synthetic rows with measured RTO 37.116 seconds. See [the integration evidence](reviews/2026-11-11-integration-wave4a.md).
No push, PR, publication or production operation was performed. Marketing impact: truth.
## 2026-11-11: fix-wave-4 local Developer MCP and Brain tools

Added the disabled Developer MCP route, one synthetic sandbox scaffold tool,
durable guards and static preview exchange. Brain now executes its tools against
forced-RLS PostgreSQL and pgvector with tenant-approved local embedding routing.
OWNER-DEVELOPER-MCP-02 remains pending; no deployment was enabled. Shared startup,
migration/CI wiring and production proofs remain integrator work listed in the
[runbook](runbooks/developer-mcp.md). The final local run passed 81 quality tasks,
148 focused tests with zero skips, the platform build and 314 RLS checks.
Trivy still reports two existing critical development dependency advisories.
See [verification](reviews/2026-11-11-fix-wave-4-mcp-brain.md). Marketing impact: truth.

## 2026-11-11: integration round 3

Integrated observability/rate limits, domain/theming browser coverage and Better
Auth. Added tenant spans, installation-owner mutation limits, suspended API
responses, development multi-user identity, shared Better Auth conformance and
optional notification delivery. Self-hosted per-tenant Postgres provisioning
removes the production Neon requirement and supports an operator-declared AP
label. The environment rule now rejects ad hoc reads. All 18 R11 entries have
named regression tests. Exact gate outcomes and remaining limits belong in
[the round-3 record](reviews/2026-11-11-integration-round3.md).
Marketing impact: truth. No push, PR or production operation.


## 2026-11-11: integrate wave 2 locally

Merged the five requested branches in order. Removed obsolete Workflow
build integration, scheduled bounded usage drains, refreshed the eighteen-entry
R11 index, and proved owner elevation through hardened WorkOS and Clerk
gateways. Added tenant-core catalog parity and shared database-runner wiring.
Tenant erase preserves other tenants' export receipts. Exact commands and
verification limits are in [the integration record](reviews/2026-11-11-integration-wave2.md).
Marketing impact: truth.

This log starts with the clean OpenTenant history. It records product
capability rather than provenance from prior private products or tenants.

This is the detailed engineering record. Read the root
[changelog](../CHANGELOG.md) for the shorter product narrative, the
[platform capabilities guide](product/platform-capabilities.md) for present
feature maturity, and [HANDOFF.md](HANDOFF.md) for the exact current state.

## 2026-11-11 - Custom-domain and tenant-theme browser coverage

- Moved the three pending domain/theming cases into the shared Playwright
  harness and removed `tooling/custom-domains-e2e`. Seeded active alpha, beta
  and hostile tenants with separate databases, host-only owner sessions and
  verified platform domains. Hostile policies exercise persisted CSS/HTML
  injection attempts.
- Added a loopback TXT control and test-only server composition. Production
  configuration rejects the e2e flag at build and runtime. Browser verification
  exercises the real store and tenant audit transaction. Fixed preservation of
  original identity/settings paths when Next retains the pre-rewrite URL.
- Verification: 11/11 browser cases pass without skips; 69/69 quality tasks and
  the platform production build pass. The default quality command's 41 skipped
  integration tests are recorded separately, not counted as passing proofs.
  Gitleaks, limited local Semgrep checks and offline Trivy checks are recorded
  in [the verification record](tooling/e2e-verification-2026-11-11.md), including
  earlier failures and reruns. No push, PR or provider operation. Marketing
  impact: none.

## 2026-11-11 — Credential rotation and SMTP delivery

- Added versioned AES-GCM keyring envelopes with authenticated key IDs and
  legacy `k0` reads. The operator rotation command rewrites every durable
  cipher store in audited, resumable batches. Control-plane migration 0045
  records checkpoints; old keys remain necessary for retained backups and
  outstanding browser-held OAuth state.
- Added a provider-neutral notifications package, Nodemailer SMTP adapter,
  React Email templates and tenant-scoped support delivery composition.
  Compose exposes Mailpit on loopback ports 11026/18026. No SaaS adapter or
  durable delivery worker is claimed.
- Added 24 regression cases. Dedicated checks passed 17 cipher/rotation cases,
  8 notification cases using real multipart SMTP, 4 support delivery cases,
  314 RLS checks across 31 tables, 30 store assertions and 148 migration tests.
  Mailpit's HTTP read-back test explicitly skips without a running service
  and has a required CI mode.
- Passed 66 uncached workspace tasks with 1,548 Vitest and 137 Node tests,
  plus the platform production build.
- See [the implementation and verification record](reviews/2026-11-11-wave2-keys-email.md)
  for exact commands, resource-related retries, local security scans and the
  pnpm automatic registry-contact deviation. The disposable Postgres container
  was removed. No push, PR or production operation was performed.
- Marketing impact: truth.
## 2026-11-11 — Authorization port and local OpenFGA adapter

Added `@opentenant/authz` with a shared manifest/role/claim ceiling, in-process
and optional OpenFGA adapters, replayable sync helpers and a real-container
conformance suite. Migration 0063 stores reviewed manifest snapshots and optional
provider IDs. The resolver now denies missing module entitlement and forged
claims for mapped modules; unmapped manifests retain the legacy exception.

The package's 38 tests and resolver's 18 tests pass, as do all 30 database-store
assertions. Full migration verification exposes an older out-of-order 0029
fixture once 0063 is present. See [the verification record](reviews/2026-11-11-authorization.md)
for required gates, commands and limitations. Lifecycle sync wiring and
production enablement remain outside this implementation. Marketing impact: truth.
## 2026-11-11 — Optional sandbox vendors and ledger export

- Added disabled-by-default E2B and local microsandbox SDK adapters. All four
  vendor adapters run shared capability-aware mock conformance. E2B uses verified
  deny-all controls and private preview mediation; local microsandbox disables
  networking and image pulls and refuses previews.
- Added `@opentenant/usage-export`, a minimal OpenMeter CloudEvents sink, an
  atomic development file sink and a bounded worker-callable export job. Forward
  migration 0065 adds receipt-backed durable cursors without changing the ledger.
- The uncached quality run passed 69 tasks and 1717 tests.
  Sandbox checks passed 146 tests with one real microVM lifecycle not run.
  Usage export passed 14 tests, including six real PostgreSQL/mock-HTTP cases.
  The platform build passed and the database-store proof passed seven suites,
  30 assertions and zero skips. A fresh-cluster RLS proof passed 314 checks across
  31 tenant tables.
- The canonical migration run passed 142 tests but blocked six on the existing
  0029 upgrade fixture applying newer migrations first. Its unowned file remains
  unchanged; a prepared one-line patch passed all eight fixture tests in a
  scratch copy. See [commands and integration wiring](../packages/usage-export/VERIFICATION.md).
- No E2B/OpenMeter cloud API, hosted sandbox, billing decision, push or PR.
  Marketing impact: truth.
## 2026-11-11 — Wave 2 observability and mutation limits

- Added opt-in provider-neutral OTLP tracing, pg transaction instrumentation,
  identity and module spans, a content-free pino logger, generic error screens
  and optional Sentry-protocol server error capture with all PII collection off.
- Added migration 0050 and PostgreSQL rate limits through shared mutation gates,
  with an independent one-connection pool and stricter trusted-ingress budgets.
- Added 44 regression tests. The uncached workspace gate passed 63/63 tasks,
  including 1,567 Vitest and 137 Node tests. The platform build passed. Dedicated
  proofs passed 33 observability tests including real pg spans, three limiter
  DB tests, and all 148 migration cases without skips. The final restricted-role
  RLS regression passed 314 checks across 31 tenant tables.
- Production audit: zero high/critical findings, one moderate. Local Gitleaks,
  five-rule Semgrep and cached Trivy scans found no leaks/findings/high-critical
  vulnerabilities within their recorded scope. See the
  [verification record](reviews/2026-11-11-observability-rate-limits.md) for
  exact commands, bounded scan limitations, retries and every wired route.
- Tenant-resolution tracing and tenant creation remain explicit merge steps
  for their owning agents. No cloud, provider, collector or Sentry event was
  contacted. Only npm-registry downloads/metadata/audit requests were allowed.
  Marketing impact: truth; no push or PR.
## 2026-11-11 — Self-hosted Better Auth identity

- Added the optional `@opentenant/auth-better-auth` adapter with pinned MIT
  Better Auth, organization, SSO and SCIM dependencies. Email/password login,
  tenant-bound sessions, member administration and invitation acceptance use the
  existing identity contract and provider-scoped Postgres stores.
- Added forward migrations 0060–0062 for prefixed identity tables and membership
  invariants. Runtime initialization does not migrate the database.
- SSO and SCIM require explicit operator configuration. SCIM links only reviewed
  immutable subjects, creates member-level access and revokes only memberships
  it owns. External IdP interoperability and production email delivery remain
  installation work. Mailpit can use the documented injected email hooks.
- Verification passed 69 uncached quality tasks and 1,679 tests, 13 adapter
  conformance cases, 314 RLS checks and 30 store assertions. The migrations
  suite passed 142 cases with six blocked by an unowned fixture that applies
  migration 0029 after 0062; the integration fix is documented in the runbook.
- See [the adapter design and runbook](architecture/better-auth-adapter.md).
  Work stayed local, without a push, PR or production operation.
- Marketing impact: truth.

## 2026-11-11 — Security and go-live merge proofs

- Resolved environment documentation with empty placeholders, retaining both
  dedicated production signing secrets and the tenant base domain.
- Aligned production-secret test fixtures with complete runtime configuration;
  added three missing/short connection-state secret regression cases.
- Corrected the provisioning integration test's bytea decoding to match the
  application reader and explicitly checked credential preservation on resume.
- Passed 63 uncached quality tasks, 1,664 tests and the platform production build.
  Separate pgvector/Postgres 17 runs passed 314 RLS checks across 31 tables,
  30 store assertions across seven suites, 148 migration tests and one provisioning
  integration case with nine assertions. No database proof was skipped.
- The provisioning proof exercises a support-ticket insert through the actual
  restricted application login, plus missing/wrong tenant context and delete denial.
- See [the merged verification record](reviews/2026-11-11-merge-proofs.md).
  Work stayed local; no push, PR or production operation was performed.
- Marketing impact: truth.
## 2026-11-11 — Local audit checkpoint hardening

- Added forward migrations blocking audit TRUNCATE in control-plane, Brain,
  and Support tables, with an append-only signed-checkpoint receipt store.
- Added Ed25519 signed notes, local filesystem and Git sinks, and the operator
  commands `pnpm audit:anchor` and `pnpm audit:verify`. No new dependency or
  copied third-party implementation was needed.
- Added 46 regression cases for statement guards, signed-note fields and keys,
  external sinks, Git secret isolation, and real-Postgres tampering. Verified
  63/63 quality tasks and 1,643 tests, the platform build with 27 pages, 164
  migration tests, 40 database-store assertions, and 314 RLS checks. Both
  agent-owned Postgres containers were removed.
- See [the verification record](reviews/2026-11-11-audit-checkpoint-hardening.md)
  and [the key management runbook](security/audit-checkpoints.md). Existing
  medium dependency advisories remain. No push, PR, external service,
  production key, scheduler, or deployment was invoked.
- Marketing impact: none.
## 2026-11-11: Reproducible deployment definitions

Added a pinned Node 22 standalone container, a Postgres 17 Compose stack with
one-shot control-plane migration and a disposable deployment smoke in CI.
Added a Vercel REST helper with a network-free dry-run default, explicit
command-line project binding and mocked-fetch tests, plus an optional MIT
Kamal template. The runbook lists runtime names without account identifiers.

Local smoke passed migration, health, registered localhost tenant routing,
unknown-host denial, repeat migration and complete teardown. The platform
build and the full 63-task quality gate passed. See
[deployment verification](reviews/2026-11-11-deployment-definitions.md) for exact
commands, transient failures and existing scanner findings. No cloud resource,
Vercel CLI, push or PR was involved. Hosted paths remain unverified and
owner-gated; health is liveness only. Marketing impact: truth.

## 2026-11-11 — Local security hardening batch

- Verified and fixed all eight static-review findings, including the separate
  copy-out template lockfile. Next and its ESLint plugin resolve to 15.5.29.
- Production audit findings fell from 6 critical, 18 high, 19 moderate and 4 low
  to one moderate `minimatch` advisory. The standalone template fell from
  3 critical, 4 high and 2 moderate findings to zero.
- Added 61 unit regression cases covering proxy policy, redirects, CSRF,
  owner-only identity intents, five-connection lock contention, client-bound
  mapping transactions, audited invitation errors, dedicated production
  secrets, framing and development host boundaries.
- Local verification passed all 63 quality tasks and 1,629 tests, the platform
  production build and 27 generated pages, local security scans and whitespace
  checks. Eighteen database integration suite files remained skipped without
  dedicated test URLs; Docker Compose was not started.
- See [the review evidence](reviews/2026-11-11-security-hardening.md) for exact
  commands and limitations. Nothing was pushed or deployed.

## 2026-11-11 — Local Chromium browser test harness

- Added `tooling/e2e` and `pnpm e2e` with isolated Postgres 17, the canonical
  local migration runner, complete tenant support migrations, a restricted
  tenant database role, synthetic local identity, and a local HTTPS module stub.
- Automated unknown-host rejection, sign-in/out, tenant home and launcher,
  administrator branding/members settings, support list/create, and proxy
  sandbox CSP and cookie stripping. Seven cases passed in both container and
  service modes. The eighth, the proxy cache-policy case, was `test.fixme`
  on its branch and passes after merging the security batch's R11-06 fix.
- Verified service teardown leaves zero run-owned databases or roles. Removed
  every test container and its volumes. No push, pull request, hosted identity,
  provider resource, or deployment operation was part of this work.
- Added a SHA-pinned CI job with a Postgres 17 service on host port 55433,
  Chromium caching, and failure trace/report uploads. The YAML was parsed and
  its action pins and database port checked locally; hosted CI was not run.
- The existing quality matrix passes with 22 workspaces, 66 tasks, and no
  builds. `pnpm turbo typecheck lint test` passed all 66 tasks, and
  `pnpm turbo build --filter=@opentenant/platform` passed. Harness lint,
  typecheck, and two environment/port safety tests pass. `git diff --check`
  and the AST-only Graphify refresh also passed.
- Staged Gitleaks scanning found no secrets. Three local Semgrep rules found
  no issues. Cached offline Trivy scanning reported 56 existing dependency
  findings across the two lockfiles, with zero additions against the base.
  These scans do not establish general security clearance.
- Marketing impact: none.

## 2026-09-29 — Full-repository review: P1 security and correctness fixes

- Closed an open redirect after login: `/\host` and `/<TAB>/host` return
  paths passed the old prefix check. One `safeReturnPath` guard now serves
  every login route and gateway.
- Bound the WorkOS login round trip to the browser with an HttpOnly nonce, so
  a planted authorization code can no longer sign a victim into another
  account. WorkOS membership and invitation lists now read every page.
- Passcode module grants carry a digest of the passcode they were issued
  under; rotating a passcode revokes outstanding grants.
- Remote module responses are served in an opaque CSP sandbox with upstream
  encoding, length, service-worker scope, and policy headers removed. Module
  scripts can no longer call platform APIs with the viewer's session. Remote
  modules stay non-functional until they are served from their own origin.
- The admin overview, audit log, and tenant-creation pages authorize through
  installation permissions; the legacy grant keeps its existing access.
- Bounded the host-resolution cache, request bodies on 13 form routes and the
  module proxy, and concurrent tenant provisioning. An atomic job claim stops
  overlapping runs from creating duplicate Neon projects or storing a rotated
  `tenant_app` password.
- The capability broker resolves the tenant pool before it opens its
  control-plane transaction, which removes a pool-exhaustion deadlock.
- Support AI redactions merge nested ranges before applying them, and the
  quality contract treats non-finite metrics as missing instead of accepted.
- The unattended controller runs its blocking work review before recording a
  task as completed, and reviews the task it actually runs. The Archify
  updater pins its installer, passes a minimal environment, and commits only
  its own paths.

## 2026-09-07 — 15-task correctness and user-journey program

- Closed six correctness and delivery tasks: Assessment authorization,
  server-attributed telemetry, respondent/evidence editing, production fallback,
  dependency audits and normal-CI database store proofs.
- Delivered five local product journeys: tenant-policy Assessment readouts,
  persisted model routing evidence, tenant brand upload/review/apply, and
  restorable Assessment engagements with safe stale-readout behavior.
- Browser acceptance covered tenant switching, reload and restore, invalid
  backups, model unavailability, keyboard use, actual downloads, and widths 375,
  768 and 1440. A narrow-layout overflow found during acceptance was fixed.
- Accepted three implementation-ready designs for Developer MCP pre-exposure,
  human-reviewed Support AI suggestions and durable Quality Contracts. They add
  no route, live provider, autonomous ticket action, experiment, publication or
  production authority.
- Kept the README's `What's new` section limited to end-user-visible outcomes.
  CI, model assignment and review-gate details remain in engineering evidence.
- M1, corrected M2, integrated M3 and GFinal have fresh Astra acceptance. The
  final review verified the brand supersede correction and found no remaining
  P1 or P2 issue. No push, merge,
  deployment, genuine tenant data or provider activation was authorized.

## 2026-08-07 — SIMPLIFY-05: Assessment workflow and operational-doc polish

- Reduced `AssessmentApp` from 941 lines to a 12-line provider/shell
  coordinator. Focused shell, questionnaire, response, result, primitive, and
  export modules preserve scoring, evidence, demo data, respondent CRUD,
  consolidation, AI readout, PDF, CSV, JSON, and sign-out behavior.
- Added one visible completion indicator, one demo banner without the duplicate
  header badge, keyboard-navigable roster/matrix tabs, one PDF action, and one
  CSV/JSON export menu. The date control now has an accessible name.
- Named `agent-browser` verification passed at 375, 768, and 1440 pixels with
  no page-level horizontal overflow. Arrow-key tab activation and WCAG 2A
  checks passed. Real downloads produced a two-page PDF, parseable CSV, and
  parseable JSON containing all five pillar results and both demo respondents.
- Replaced the 1,024-line historical handoff with a 194-line operational resume;
  engineering history stays here and product history stays in the changelog.
- Node 22 verification passes 40 Assessment tests, 251 platform tests, all 63
  monorepo quality tasks, both production builds, and whitespace validation.
  No migration, capability, permission/API vocabulary, provider operation,
  production enablement, or genuine tenant data changed. The README roadmap
  remains unchanged pending separately authorized production verification.
  Marketing classification: `content`.

## 2026-08-07 — SIMPLIFY-04: stable facades over focused modules

- Captured the complete unattended-runner, Support AI, and Support Depth
  runtime exports plus representative outcomes in facade contract tests before
  moving implementations.
- Replaced the 1,264-line unattended runner entrypoint with a 30-line
  compatibility facade over agent/sandbox setup, Git state,
  verification/PostgreSQL proof, and orchestration state. Existing recovery,
  denial, integrity, proof, and process-isolation outcomes remain unchanged.
- Split Support AI and Support Depth into type, pure policy, adapter/store, and
  service layers behind unchanged facades. The facades are 8 and 5 lines; the
  largest service is 450 lines.
- Node 22 verification passes 104 unattended tests, 77 Support tests, all 63
  monorepo quality tasks, both production builds, whitespace validation, and
  the repository-graph freshness check. No migration, feature, permission,
  package API, provider operation, deployment, or genuine tenant data changed.
  Marketing classification: `none`.

## 2026-08-07 — SIMPLIFY-03: explicit HTTP persistence boundaries

- Removed SQL and checked-out-client transaction mechanics from production
  route/page files. Focused tenant-settings, tenant-provisioning, and
  brand-proposal read stores now own the queries; authorization remains visible
  in every route through its explicit permission, gate, and failure response.
- Routed audited control-plane mutations through the shared transaction helper,
  retaining audit-failure rollback, provisioning commit-uncertainty readback,
  identity compensation, status codes, redirects, and managed-support limits.
- Assessment now reuses the hardened shared same-origin check. Tenant admin
  contexts derive one privilege-aware audit actor used by ordinary tenant
  administrators and managed support.
- RED was observed as three focused boundary failures. Node 22 verification
  passes 251 platform tests across 47 files, 92 database tests, all 63
  monorepo quality tasks, both production builds, 314 RLS checks across 31
  tenant tables, whitespace validation, and the repository-graph freshness
  check. Backlog status is `completed`. No migration, permission/API
  vocabulary change, provider operation, deployment, or genuine tenant data
  was introduced. Marketing classification: `none`.

## 2026-08-07 — SIMPLIFY-02: centralized request context and database pools

- Added one observable `globalThis`-backed control-plane pool with maximum
  size five, a 30-second idle timeout, and five-second connection and query
  timeouts. All reusable platform control-plane consumers now share it.
- Added a same-client control-plane transaction helper with begin, commit,
  rollback, original-error propagation, healthy release, and broken-client
  destruction when rollback fails.
- Preserved separate physical pools for tenant RLS access, provisioning's
  one-shot tenant database work, and workflow heartbeat steps. Wrapped the
  stable `currentTenant` and `currentSession` entry points in module-level
  React cache for Server Component render deduplication without changing route
  authorization or mutation order.
- RED was observed as four missing-module contract failures. Node 22
  verification passes 242 platform tests across 47 files, 92 database tests,
  all 63 monorepo quality tasks, both production builds, 314 RLS checks across
  31 tenant tables, whitespace validation, and the repository-graph freshness
  check. The controller's restricted subprocess could not receive the fresh
  RLS database URL or write a macOS build cache; both gates passed when rerun
  directly with a disposable pgvector/PostgreSQL 17 cluster. Backlog status is
  `completed`.
  No migration, persistent cache, permission, package API, provider operation,
  deployment, or genuine tenant data was introduced. Marketing classification:
  `none`.

## 2026-08-07 — SIMPLIFY-01: distinct quality pipeline

- Replaced the 21 workspace lint commands that only repeated compiler or syntax
  checks with one root ESLint flat configuration. JavaScript and TypeScript use
  the recommended non-type-aware rule sets; React files add Hooks rules; the
  platform and module template add Next.js Core Web Vitals rules.
- Retained one explicit `tsc --noEmit` command per workspace, including a real
  checked-JavaScript TypeScript command for the CI workspace. Removed the
  unnecessary upstream-build dependency from Turbo typecheck and test while
  leaving the build graph unchanged.
- Added `scripts/assert-quality-pipeline.mjs`. It proves the dry run contains
  exactly 21 lint, 21 typecheck, and 21 test tasks, no build tasks or build
  dependencies, and no lint command that invokes TypeScript.
- Node 22 verification passes the deterministic assertion, all 63 monorepo
  quality tasks, both production Next.js builds, and whitespace validation.
  No runtime behavior, schema, permission vocabulary, package API, or public
  product claim changed. Marketing classification: `none`.

## 2026-08-06 — autonomous backlog completion: PostgreSQL admission and exact usage

- Completed all 37 non-owner tasks in the 43-task governed backlog, including
  two bounded hardening tasks added after final semantic review. The autonomous
  controller queue is empty. The four owner-controlled entries remain gates for Slack,
  Developer MCP route activation, compliance scope, and commercial billing.
- Added a trust-anchored local PostgreSQL 17 proof path for unattended tasks.
  It uses a restricted role, exact per-task databases and Unix socket,
  deny-network verification, named-test and committed-row corroboration, and
  post-run teardown/boundary checks. The admission profile passes five and the
  usage profile passes four integration tests with zero skipped tests.
- Added migration `0026` and `PgAdmissionStore` for transactional fixed-window,
  concurrency, lease, and idempotency enforcement. Assessment readout,
  telemetry, and module-access routes now share that PostgreSQL adapter with
  trusted tenant, principal, operation, and scope binding; their process-local
  admission maps were removed. Replays never repeat route side effects,
  malformed keys stay 400-class input errors, low-entropy passcode evidence is
  server-keyed, every acquired lease releases, and provider streaming aborts at
  the persisted lease deadline.
- Added migration `0027`, the additive correction-occurrence hardening
  migration `0028`, a closed server-owned usage metric registry, and
  `PgUsageLedger`. Immutable tenant-scoped events distinguish occurrence from
  recording time, serialize idempotent races across store instances, require a
  complete immutable identity for replay, record same-occurrence corrections as
  linked signed deltas, and aggregate exactly once over bounded half-open
  tenant/metric windows.
- Kept admission, exact usage, and commercial entitlements separate. No
  admission outcome becomes usage automatically, and no price, plan,
  entitlement, invoice, checkout, webhook, payment-provider SDK, or public
  billing claim was added.
- Final evidence passes 234 platform tests, all 63 monorepo lint/typecheck/test
  tasks, the 27-page production build, and whitespace validation. Marketing
  classification: `content`.

## 2026-07-31 — DEV-MCP-03: per-call Developer MCP authorization

- Added the named dependency-free `authorizeDeveloperMcpCall` enforcement
  point. It accepts only a closed raw authority snapshot, rejects future or
  more-than-60-second-old readings, recomputes effective authority internally,
  and derives tool slug, risk, and resource type only from frozen descriptors.
- Every otherwise-authorizable call revalidates membership, registered-client
  consent, and session/token authority before resource lookup. High-risk calls
  perform a second check after resource authorization and require fresh live
  evidence immediately before allow; stale, future, malformed, revoked, or
  thrown adapter results fail closed without leaking hostile values.
- Added a provider-neutral allow/deny resource port and immutable local
  reference adapter. Compound type/opaque-ID keys prevent collisions; exact
  grants and same-tenant project-to-workspace inheritance allow, while
  duplicate, dangling, cross-tenant, wrong-user, wrong-parent, wrong-slug,
  unknown, foreign, and prefix-confused cases deny without becoming ownership
  oracles. Decisions and copied snapshots are deeply frozen and contain no
  executable or durable capability.
- RED was observed as 19 missing-API failures. Direct no-cache-write checks pass
  97 package tests, package TypeScript, and the focused platform route-surface
  test. The controller's full profile passes all 183 platform tests, all 60
  monorepo tasks, and the 27-page production build; backlog status is
  `completed`. `OWNER-DEVELOPER-MCP-02` remains pending, maturity remains
  foundation-only, and successful Developer MCP tool routes remain zero.
- No MCP SDK, route, handler registry, workspace persistence, database
  migration, protected-resource metadata, provider call, audit append, sandbox
  operation, deployment, or genuine tenant data was introduced. Marketing
  classification: `truth`.

## 2026-07-31 — DEV-MCP-02: strict modern Developer MCP protocol contract

- Added dependency-free pure validation for the closed MCP `2026-07-28`
  `server/discover` and `tools/list` request surface. It enforces ordered
  duplicate-preserving media and mirrored headers, exact bounded JSON-RPC and
  metadata shapes, frozen first-error precedence, case-sensitive values, and
  bounded structured denials while treating legacy session headers as inert.
- Added byte-stable tenant-invariant public server discovery and renamed the
  existing private authority-filtered discovery contract to the tool list it
  represents. Tool lists are complete, exact-name sorted, empty without
  authority, private, and bounded by the 60-second revocation window.
- Added frozen factual descriptions to all twelve descriptors and projects
  wire tools to only name, description, and explicit self-contained JSON
  Schema 2020-12 input schemas. Internal authority/catalogue fields are absent;
  tools with unresolved empty server-owned enums are omitted.
- Exported deterministic conformance fixtures for valid and malformed requests,
  header precedence/casing/mirroring, unsupported versions and methods, inert
  legacy headers, authority variation, schema projection, and unresolved
  catalogue omission. `tools/call`, input-required/MRTR, and legacy methods
  remain denied.
- RED was observed before implementation. Post-controller comparison with the
  official final schema then produced three focused RED failures before fixing
  reserved metadata keys, direct cache-result members, unsupported-version
  data, literal upstream-shaped fixtures, bounded capabilities and headers,
  immutable normalization, and fail-closed empty-enum projection. The package
  suite passes 68 tests, direct TypeScript checking passes, the platform suite
  passes 183 tests, the forced monorepo matrix passes 60/60 tasks, and the
  27-page production build completes. The controller promoted the backlog to
  `completed`; final `claude -p` review returned `SHIP`.
- No MCP SDK, route, handler, executable tool, provider/auth composition,
  protected-resource metadata, sandbox/provider operation, network I/O,
  deployment, legacy fallback, or genuine tenant data was added. Marketing
  classification: `truth`.

## 2026-07-31 — DEV-MCP-01: executable Developer MCP authority vocabulary

- Added dependency-free `@opentenant/developer-mcp` exports for the exact ten
  frozen permission slugs, their assignable partition and risks, and the two
  immutable explicitly assigned `@1` profiles.
- Effective authority is a fail-closed intersection of profile, token, and
  client-consent scopes. Eligibility alone grants nothing, while unknown and
  unassignable values remain denied in bounded, differentiated decision
  evidence. Unknown profiles return empty authority, and unknown permission
  slugs conservatively require synchronous revalidation.
- Added the 60-second maximum stale-authority policy, synchronous revocation
  checks for both high-risk grants, twelve non-callable bounded descriptors,
  deterministic private permission-filtered discovery, and the closed audit
  field vocabulary. Audit input rejects hidden, symbol, accessor, and extra
  fields, validates bounded values against the frozen authority contracts, and
  returns a frozen defensive copy. The unresolved server contract and
  per-template command catalogues are empty closed enums and grant no value.
- Added a platform route-surface regression proving there is no package import
  and no new Developer MCP route; the existing Brain MCP route is unchanged.
- RED was observed before implementation and as 12, then 23, focused failures
  for the independent review hardening. Focused verification passes 36 tests. The
  forced monorepo matrix passes 60/60 tasks, the platform suite passes 183
  tests, and the 27-page production build completes. `claude -p` review drove
  the fail-closed, audit-value, evidence-bounding, route-scan, and immutability
  hardening; inferred command values were removed. Backlog status is
  `completed`.
- No protocol SDK, route, tool handler, provider call, sandbox execution,
  deployment, genuine tenant data, or external mutation was added. Marketing
  classification: `truth`.

## 2026-07-30 — BRAND-VOICE-04: immutable tenant voice-profile storage

- Added a tenant-scoped mutable head with explicit optimistic revision,
  monotonic version allocation, and a current-version projection.
- Added immutable profile versions with a canonical SHA-256 digest, publishing
  human, reason, and timestamp, plus separate append-only revocation evidence.
- Validation returns the complete normalized structured profile and rejects
  canonical duplicates/overlap, malformed or oversized word tokens, unchanged
  rewrites, and URL, credential, imperative, email, phone, social-handle, or
  contact-solicitation channels.
- Publication and revocation serialize on the tenant head and append one
  canonical tenant audit event in the same transaction. Revocation retains the
  historical version and persistent next-version allocation.
- Added PostgreSQL behavior coverage for exact tenant reads/revocation,
  two-connection publication, direct invalid writes, composite tenant
  references, immutable evidence, retained history, and audit cardinality.
- Focused validation RED was observed with 3 failures; platform-core and
  database are green at 67 and 88 tests. A guarded hostile-locale PostgreSQL 17
  profile executed all 116 migration tests, including 7 live voice-profile
  cases plus full Node/SQL Unicode-table parity for letter-and-mark validation,
  stale revisions, illegal head transitions, immutable evidence, server-owned
  timestamps, and audit-time binding. All disposable database containers were
  removed.
- The forced monorepo matrix passed 57/57 tasks, the platform suite passed 182
  tests, and the 27-page production build completed. `claude -p` review drove
  fixes for validation parity, control/format denial, non-current revocation
  coverage, canonical hashing, timestamp binding, and PostgreSQL integer
  bounds. Backlog status is `completed`.
- No ModelRouter, prompt assembly, provider adapter, generation route,
  customer-facing conditioning, owner decision, provider call, deployment,
  genuine tenant data, or external runtime mutation was added. Marketing
  classification: `truth`.

## 2026-07-30 — BRAND-EDIT-03: provenance-preserving proposal edits

- Added a tenant-operator edit transition for draft and reviewed brand
  proposals, gated by the exact active-tenant `brand.proposal.edit` permission.
- Edits validate existing brand-token values while retaining the proposal
  request, immutable parser version, and every value's original HTTPS or upload
  provenance. A successful edit returns the proposal to draft and clears all
  prior review evidence.
- The transition locks the same proposal row as apply and writes one canonical
  `brand.proposal.edited` audit event with actor and reason. The declared live
  two-connection case proves edit versus apply has one coherent winner and
  never applies an edited, unreviewed value.
- Migration `0023` rejects reviewed-value mutation without the matching
  review-invalidation transition, freezes the populated key/provenance envelope,
  and prevents discarded or superseded value edits. Applied terminality and the
  existing exactly-once apply event remain unchanged.
- Empty drafts may be hydrated once, but edits cannot add or remove token keys,
  rewrite provenance, combine value changes with review, or clear review without
  a semantic value change. JSON-looking text and structured legal links round
  trip through the operator form without false edits.
- RED was observed in the focused domain and route tests. The platform-core,
  database, and platform suites pass 63, 81, and 182 tests respectively. A
  guarded disposable PostgreSQL 17 profile passed all 107 migration tests plus
  7 live store tests, including edit/apply serialization, sibling-draft
  rollback, legal-link no-op rejection, audit cardinality, and provenance
  preservation; both disposable containers were removed afterward.
- The forced monorepo matrix passed 57/57 tasks and the 27-page production
  platform build completed. Multiple `claude -p` reviews found and drove fixes for
  live-draft conflict handling, database provenance enforcement, JSON-looking
  text parsing, validation error classification, and legal-link equality.
- No owner decision, provider call, deployment, genuine tenant data, or
  external mutation occurred. Marketing classification: `truth`.

## 2026-07-30 — BRAND-PARSER-02: immutable brand parser versions

- Added an insert-only control-plane parser registry seeded with
  `brand-md-v1`; later distinct versions may be inserted, but registered rows
  cannot be updated or deleted.
- Upload proposals must persist a registered parser version at creation and
  cannot change it. Empty upload parse results still retain that parser;
  HTTPS proposals store explicit `null`, and unknown versions fail through the
  registry foreign key.
- The deterministic parser returns the exact v1 literal and upload provenance
  remains file-digest based without a fabricated URL.
- Added live PostgreSQL write cases for registry and proposal immutability,
  missing/unknown versions, later-version isolation, exact storage round-trip,
  non-upload null storage, temporary-schema shadowing, origin immutability,
  exact request/value digest identity, legacy mismatch rejection, pipeline
  truncate rejection, and upgrade of an already-applied proposal. These inspect
  behavior, not migration text.
- RED was observed before implementation. The 52-test platform-core suite and
  direct platform-core/migrations TypeScript checks pass. Controller
  verification passed the forced 57/57 monorepo matrix and 27-page production
  build. A trusted guarded PostgreSQL 17 profile passed all 101 migration tests,
  including 23 upload/parser cases, and was removed afterward.
- A `claude -p` security review found and drove fixes for applied-row upgrade,
  temporary-schema shadowing, and mutable request-origin gaps.
- No owner decision, provider call, deployment, genuine tenant data, or
  external mutation occurred. Marketing classification: `truth`.

## 2026-07-30 — BRAND-PERM-01: active-tenant brand proposal permissions

- Added the closed `brand.proposal.upload|review|edit|apply|supersede|revoke`
  vocabulary with exact, pairwise-independent and fail-closed checks.
- Request/upload retry, review, apply, and discard now require verified
  active-tenant owner/admin authority. Platform or installation authority and
  managed support alone remain denied; submitted tenant IDs are only expected
  values for identity-session validation.
- Installation-owner tenant creation now initializes only the empty brand
  policy. A tenant administrator with the upload grant starts or retries the
  independent website proposal from the tenant-bound page.
- Review and discard/revoke now use transactional public store methods carrying
  actor, tenant, and required operator-reason audit evidence. Review and revoke
  use database-authored timestamps; apply retains exactly its existing canonical
  apply event.
- A second source while another draft is live returns an actionable conflict;
  scheme, credential, port, and length source denials are covered on the
  tenant-bound route.
- The four focused package suites pass 446 tests; direct
  auth/database/platform TypeScript checks pass. A guarded loopback PostgreSQL
  17 container passes all four store cases, including cross-tenant no-change,
  database-timestamp review/revoke, and the existing two-connection apply race.
  Status is `not_verified` pending controller recovery.
- No provider call, deployment, genuine tenant data, or non-synthetic external
  mutation occurred. Marketing classification: `truth`.

## 2026-07-29 — BRAND-APPLY-03: isolated brand apply PostgreSQL fixtures

- Replaced shared-table fixture cleanup with separate run-unique synthetic
  tenants for the live apply-race and policy-drift cases. The suite no longer
  attempts to delete pre-existing tenants, their audit evidence, brand state,
  or dependent control-plane records.
- Added a fixture-owned unrelated tenant with an `assessment`
  `tenant_modules` assignment and assert that it survives both live cases.
  Existing transactional assertions remain unchanged: exactly one concurrent
  apply succeeds, one canonical audit row is written, policy state advances
  once, and drift leaves newer policy state untouched with no apply audit.
- The source live PostgreSQL run supplied RED. After fixture isolation, the
  guarded loopback suite passes both live cases, including the two-connection
  race and unrelated-module sentinel. The controller passed the 57/57
  monorepo matrix and promoted the task to `completed`.
- No owner decision, provider boundary, genuine tenant data, deployment, or
  external mutation changed. Marketing classification: `none`.

## 2026-07-29 — BRAND-APPLY-02: enforced reviewed policy-version pin

- Closed the PostgreSQL CHECK null-semantics gap by requiring
  `reviewed_policy_version is not null` in both reviewed and applied proposal
  states while retaining the minimum version and all timestamp/actor rules.
- Extended the existing executed PostgreSQL behavior test to reject an applied
  transition that clears the reviewed pin, then accept the valid applied
  transition with that pin preserved. The draft-to-reviewed null rejection
  remains a database write assertion rather than a migration-text assertion.
- The source live PostgreSQL verification supplied RED. After the fix, the
  guarded loopback migration suite passes 92/92 tests across 11 files,
  including both null-pin rejection writes. The controller promoted the task
  to `completed`.
- No owner decision, provider boundary, genuine tenant data, deployment, or
  external mutation changed. Marketing classification: `none`.

## 2026-07-29 — BRAND-APPLY-01: transactional brand proposal apply

- Added a PostgreSQL store that previews stable per-key
  `locked_by_policy` rejections and atomically applies only unlocked reviewed
  values to `brand_policies.overrides`.
- Review now pins the policy version. Apply locks proposal and policy rows,
  rejects drift or duplicate/concurrent attempts, increments the policy version
  once, updates its timestamp, makes the proposal terminal, and appends exactly
  one canonical audit event carrying actor, reason, and resulting version in
  the same transaction.
- Migration `0021` persists the review version and constrains it to reviewed or
  applied states. Its PostgreSQL integration case proves the constraint by
  attempting invalid state writes; no substring-only migration assertion was
  added.
- RED was observed at the missing store. Ten focused unit/route cases and
  direct database/platform TypeScript checks pass. Final external proof passes
  92/92 migration tests and 2/2 live store tests, including two real
  connections racing the same review. The controller passed the 57/57
  monorepo matrix and 27-page platform build and promoted the task to
  `completed`.
- No permission vocabulary, parser registry, model/provider integration,
  genuine tenant data, deployment, or external mutation was introduced.
  Marketing classification: `truth`.

## 2026-07-28 — OPS-12: scoped support AI contracts

- Added a provider-neutral support suggestion service whose only successful
  output is a human-review draft. It has no send, resolve, close, publish, or
  ticket-mutation operation; disablement, budget exhaustion, empty retrieval,
  low confidence, invalid output, and adapter failure return explicit
  non-blocking outcomes.
- Added tenant-bound installation-shared and tenant-private knowledge
  contracts. Source/version provenance and redaction review are mandatory,
  reviewed spans are removed before storage, publication requires human
  knowledge authority, and private-to-shared promotion creates a new record
  reviewed by a different installation-owner human.
- Retrieval is denied without current ticket-read authority and filters by
  installation plus ambient tenant. Draft validation requires every claim to
  equal an exact span of a chunk returned for that call; uncited, missing,
  cross-span, and extra reply content rejects the entire output.
- Added content-free inference evidence with a SHA-256 prompt digest, prompt
  template version, ticket/reply watermark, ADR-006 policy reference, actor,
  tenant, and outcome. Prompt and completion text are not persisted.
- Added an offline evaluation manifest gate covering privacy, prompt injection,
  tenant denial, human review, failure behavior, schema/citation/containment,
  the accepted 500/150/50/100/100 minimum strata, and the paired category and
  priority regression ceiling of five.
- RED was observed at the missing public module. The full support suite passes
  48 tests across 7 files and the direct package TypeScript check passes. No
  provider SDK, route, credential, external call, genuine tenant data, or
  automatic support action was introduced. The implementation remains
  `not_verified` for the external controller.
- Marketing classification: `truth`. This is local contract maturity, not a
  hosted AI feature or production provider integration.

## 2026-07-28 — OPS-13: model routing and residency contracts

- Added a provider-neutral primary/secondary model resolver for the accepted
  module/use-case cascade. The first configured candidate must pass the
  versioned owner allowlist, tenant-record residency, pair-specific active
  cross-border consent, and owner-plus-tenant retention requirements in that
  order. A failed candidate is never replaced by another slot or default.
- Added pair-specific consent attribution and withdrawal persistence,
  installation and tenant zero-retention policy, encrypted tenant-first then
  installation-fallback credential custody, and append-only resolution
  evidence containing tenant, module, use case, provider, model, key origin,
  served region, retention posture, and allowlist version.
- The resolver rejects caller-supplied residency, treats unverified retention
  as retaining, rejects unpinned OpenRouter policy, and errors on an empty
  cascade. Provider credentials remain inside the platform-owned adapter
  boundary.
- RED was observed for both missing contract modules. Focused GREEN passes 14
  tests across resolver, encrypted credential broker, and static migration
  suites; direct TypeScript checks pass for platform-core, database, and
  migrations.
- Tests use only a synthetic adapter, opaque synthetic secret text, and
  synthetic tenant identifiers. No provider SDK, network call, genuine
  provider credential, or genuine tenant data is included. The implementation
  is `not_verified` until the external controller runs the declared profile.
- Marketing classification: `truth`. This establishes local contract maturity,
  not a hosted model integration or production AI capability.

## 2026-07-28 — OPS-11: compliance evidence export contracts

- Added provider-independent immutable evidence scope versions for either one
  exact tenant or an installation-owner aggregate with an explicit frozen
  tenant allowlist. Scope digests bind consent, connection, tenant membership,
  resource types, allowed fields, purpose, region, aggregation, retention, and
  creation time; a scope never discovers new tenants automatically.
- Added an explicitly authorised and bounded export contract. It clamps exports
  to 100 records and 31 days, rejects cross-tenant and unapproved resource
  records, projects only allowlisted fields, reports omitted field names
  without their values, and binds the manifest to its prior/current SHA-256
  digest for offline tamper verification.
- Added a no-network synthetic adapter with immediate one-way scope revocation,
  payload-bound idempotency, and canonical-checkpoint reconciliation that
  reports lag without inventing exported records or treating adapter state as
  canonical.
- RED was observed as 8 expected failures for the missing public contract.
  Focused GREEN passes all 8 tests. The direct security-package TypeScript
  check passes, and its complete suite passes 42 tests across 4 files.
  Package-script wrappers were sandbox-blocked at child-process spawn, so the
  same package project and suite were run through their direct Node entry
  points without cache writes.
- No provider SDK, endpoint, credential, provider call, genuine tenant data, or
  compliance/audit-readiness claim is included. The existing owner gates for a
  Vanta probe and organisational SOC 2 programme remain open and unchanged.
- Marketing classification: `truth`. This is local contract maturity, not a
  hosted integration or compliance claim.

## 2026-07-28 — OPS-10: provider-independent Slack app contracts

- Added installation-and-tenant-bound local contracts for an app connection
  and workspace, multiple channels, canonical ticket threads, active identity
  mappings, and acknowledge/assign/resolve action receipts.
- Added a synthetic HMAC action verifier with bounded structured payloads.
  Action handling validates the signature and complete
  connection/workspace/channel/thread/user/ticket scope, rejects expiry and
  replay, reloads the canonical ticket version and current mapped authority,
  and applies only explicit tenant-admin ticket permissions. Signed input
  cannot grant requester or operator authority.
- Tenant migration `0005_slack_app_contracts` enforces composite installation,
  tenant, connection, channel, thread, identity, and ticket references under
  forced RLS. Processed action receipts are append-only.
- RED was observed for the missing public contract module and migration.
  Focused GREEN passes 4 contract tests and 2 static migration tests; direct
  support and migration TypeScript checks pass. Package-script typecheck
  wrappers were sandbox-blocked at child-process spawn, so the same package
  projects were checked through the repository TypeScript binary.
- No OAuth exchange, Slack SDK, provider credential, external Slack/network
  call, or genuine tenant data was used. The implementation is `not_verified`
  until the external controller runs the declared full profile.
- Marketing classification: `truth`. This is local development evidence, not
  hosted Slack or production-readiness evidence.

## 2026-07-27 — OPS-09: support depth and delivery contracts

- Added tenant-bound in-app/email preferences and append-only delivery attempts
  with opaque destination references, canonical outbox-version binding,
  deterministic idempotency keys, normalised error classes, and an injected
  no-network synthetic transport. Only transient failures retry, at most three
  total attempts; recovery appends a validated linked attempt and evidence
  without changing the failed attempt.
- Added bounded attachment metadata with a 10 MiB limit and a small media-type
  allowlist; object references remain internal to the service and bytes/URLs
  are excluded. Reads distinguish requester ownership, tenant-admin authority,
  and owner customer-data access through an exact tenant/operator-bound,
  unexpired managed-support session.
- Added deterministic per-priority first-response/resolution SLA state with
  persisted pause accumulation,
  requester-owned one-time CSAT after resolution, and content-free per-tenant
  analytics. Requesters cannot read analytics; owner analytics require the
  sensitive permission and exact managed-support session.
- Tenant migration `0004_support_depth` applies composite tenant/ticket
  and canonical-outbox references, forced RLS, bounded retry-chain validation,
  monotonic SLA state, opaque-reference/value constraints, append-only
  attempts/attachments/CSAT, and a content-free append-only evidence ledger.
- RED was observed when the new public module did not exist. Focused GREEN
  passes all 37 support tests, 30 default migration tests, 41 migration tests
  with the 11-case disposable PostgreSQL integration profile, and direct
  TypeScript checks for support and migrations. The exhaustive RLS harness
  proves 267 checks across all 26 tenant tables. The controller passed all five
  declared commands and promoted `OPS-09` to `completed`.
- No provider or object-store call, external endpoint, credential, attachment
  bytes, or genuine tenant data was used.
- Marketing classification: `truth`. This is development evidence only, not a
  hosted-provider or production-readiness claim.

## 2026-07-27 — OPS-08: local Slack delivery contracts

- Added a one-way local Slack delivery adapter with an explicit safe ticket
  metadata allowlist. Runtime extra fields are discarded, tenant labels and
  references are bounded and escaped, deep links require safe HTTPS structure,
  top-level fallback text is present, and link/media unfurls are disabled.
- Webhooks are encrypted through an injected credential-cipher boundary with
  AAD binding to the exact tenant and connection. Plaintext exists only inside
  the transport operation and is absent from messages, synthetic delivery
  records, results, errors, and health.
- Added idempotent queueing, bounded transient retries, permanent/exhausted
  dead-letter counts, last-success and safe-error-class health, tenant
  substitution denial, and an unmistakably synthetic manual test. The adapter
  receives copied envelopes and exposes no canonical ticket mutation seam.
- RED was observed when the new public module did not exist and again for the
  narrowed credential API and exact tenant/connection isolation. Verification
  passes 8 Slack contract tests, 32 support tests, direct support TypeScript
  checking, the unattended controller's full 57-task monorepo gate, and a
  27-page platform production build.
- No provider endpoint was called and no genuine tenant data or credential was
  used. Hosted Slack remains owner-gated.
- Marketing classification: `truth`. This records development evidence only;
  it is not a production or hosted-provider claim.

## 2026-07-27 — OPS-07: owner and tenant helpdesk experience

- Added an owner Helpdesk with All, Unassigned, Mine, Escalated, and
  priority-based SLA-risk views, metadata filters/search, accessible queue
  tables, and projection delivery-health disclosure. Discovery remains one
  content-free control-plane projection read with
  `owner.helpdesk.queue.read`.
- Added a separate canonical owner detail-open seam. Projected tenant IDs and
  ticket references are validated as untrusted hints; the sensitive
  `owner.support.customer_data.read` permission and an active managed-support
  session bound to the exact tenant are rechecked before opening that tenant
  database and resolving the canonical record by ticket number. The
  queue-discovery compatibility grant alone fails closed, and content is not
  returned unless the control-plane audit chain records the operator, support
  session, tenant, and ticket reference. Projection rows never provide content
  or canonical ticket IDs.
- Replaced the tenant UI's coarse `canAdmin` branching with independently
  derived capabilities for create, own read/reply, tenant read/reply, internal
  notes, assignment, and management. Requesters cannot infer internal-note
  existence or timing; partial tenant-staff grants no longer imply unrelated
  controls.
- Added the tenant **Get help** entry, assignment in ticket lists, semantic
  status/assignment/priority summaries, visible history, and tenant-admin-only
  content-free dead-letter visibility. Actual SLA clocks and provider delivery
  remain excluded for OPS-09.
- RED was observed in the six initial focused tests and again when the
  canonical detail seam was challenged with queue-only authority. Current
  direct verification passes both support/platform TypeScript checks, all 24
  support tests, and all 172 platform tests. The sandbox denied
  pnpm lifecycle spawning, so the installed Vitest and TypeScript executables
  were invoked directly without dependency or cache writes.
- Marketing classification: `truth`. This is development evidence only; the
  downstream marketing truth review follows after the OpenTenant change
  merges.
- The external unattended controller passed the 172-test platform gate, all 57
  forced monorepo typecheck/lint/test tasks, the 27-page platform production
  build, committed-range diff integrity, and Graphify freshness. It promoted
  `OPS-07` to `completed` in `cb8a708`.

## 2026-07-27 — OPS-06: helpdesk core and owner projection

- Added canonical monotonic ticket versions in the tenant data plane; a
  PostgreSQL trigger rejects any update that does not advance the version by
  exactly one.
- Added the `support.outbox_events` transactional outbox
  (`tenant-support/0003_ticket_version_outbox`). Every ticket mutation in
  `@opentenant/support` appends its ticket event and one queue-metadata
  envelope at the new version on the same client, so ticket state, tenant
  event, and outbox row commit or roll back together. Identity and payload
  are append-only by trigger; terminal delivery states cannot reopen;
  consumer claims use `for update skip locked` with stale-claim recovery,
  bounded attempts, explicit permanent-failure dead-lettering, and
  content-free dead-letter visibility. A CHECK constraint structurally denies
  subject, body, description, message, and attachment keys in every envelope.
- Added the control-plane owner projection
  (`control-plane/0016_helpdesk_projection`) and
  `PgHelpdeskProjectionStore`: monotonic idempotent apply (an older canonical
  version never replaces a newer row), per-tenant checkpoint and lag/health
  state, tenant tombstoning, and atomic rebuild from canonical tenant rows.
  Tombstone and rebuild append hash-chained audit evidence in the same
  transaction. The projection has no content columns and is never ticket
  authority.
- Added the approved support permission vocabulary with fail-closed legacy
  alias expansion, enforced it in the support gate and ticket API route
  (create, own/tenant read, own/staff reply, internal notes, assignment, and
  manage checks are now fine-grained), and added the
  `owner.helpdesk.queue.read` installation permission gating the minimal
  owner queue discovery seam (`ownerHelpdeskQueue`). The projection pass
  isolates failures: a projection or control-plane error can only delay
  queue visibility and never mutates ticket state.
- Independent fresh-context review confirmed the content-denial, isolation,
  atomicity, and authorization surfaces and raised two defects that are
  fixed and regression-proven: the rebuild path now upserts under the
  monotonic version guard with checkpoint-bounded removal of vanished rows
  (a concurrently applied newer row is never regressed), and the permission
  vocabulary is wired into real enforcement rather than existing beside the
  legacy coarse checks.
- Verified on Node 22.23.1 / pnpm 11.13.1: 57/57 forced turbo
  lint/typecheck/test tasks (support 23, database unit 73, platform 163,
  auth updated), the 27-page platform production build, live disposable
  PostgreSQL proofs for the tenant migration (8 checks incl. version-jump,
  content-key, duplicate-version, append-only, and terminal-state denials)
  and the projection store (6 checks incl. monotonic replay, tombstone,
  tenant isolation, rebuild, and audit-chain verification), and the full
  fresh-cluster RLS harness now passing 195 checks across 19 tenant tables
  with the outbox delete/rewrite/content denials included.
- Excluded per the accepted design: Slack and email provider calls,
  attachments, SLA/CSAT, AI, Vanta, broad module database access, deployment,
  and helpdesk UI polish. The OPS-05 broker summary contract is unchanged.
- Marketing classification: `truth`. The public capability map gains a
  development-verified helpdesk core; run the marketing drift review after
  this merge reaches `origin/main`.

## 2026-07-27 — SEC-01: production dependency audit restored

- Updated Next.js to 15.5.21 within the supported 15.x line, closing
  GHSA-m99w-x7hq-7vfj (App Router denial of service), GHSA-89xv-2m56-2m9x
  (Server Actions SSRF), and GHSA-p9j2-gv94-2wf4 (rewrites SSRF).
- Raised the workspace `postcss` override to 8.5.18 for GHSA-r28c-9q8g-f849
  and added a `brace-expansion` override at 5.0.8 for GHSA-mh99-v99m-4gvg in
  both the monorepo and the isolated tenant starter. No major upgrade was
  bundled and the `sharp` 0.35.3 pin is unchanged.
- Verified on Node 22.23.1 / pnpm 11.13.1: frozen installs in both graphs,
  `pnpm audit --prod --audit-level high` reporting zero vulnerabilities in the
  monorepo and the starter, 57/57 forced turbo lint/typecheck/test tasks, the
  27-page platform production build, `git diff --check`, and
  `graphify check-update`. The production licence closure is unchanged; the
  only `Unknown` licence record (`@vercel/cli-auth`) predates this change on
  `main`.
- Marketing classification: `truth`. The public security-maintenance fact
  changes (the reproduced high-severity advisories are closed); run the
  marketing drift review after this merge reaches `origin/main`.


## 2026-07-22 — brokered module capabilities (`OPS-05`, verified)

- Added the closed `support.ticket.read` vocabulary and denial-first policy.
  Effective authority intersects the immutable manifest declaration, trusted
  creator ceiling, exact tenant/version grant, active entitlement, ownership
  boundary, and current module-scoped runtime permission.
- Control-plane migration `0015` requires declarations before version
  publication through a deferred exact-version foreign key and blocks later
  insert, update, or delete. Creator ceilings are server-owned records bound to
  the exact publishing identity. Version-bound grants have expiry chronology,
  one active exact grant, immutable history, one-way revocation, and append a
  replacement only after retiring an expired record.
- Signed remote-module context now includes and validates the immutable module
  version plus bounded tenant, identity, permission, brand, and timestamp shapes.
  The broker accepts that context only as strict bearer authorization; reserved
  inbound context headers are ignored while middleware preserves authorization.
- Added one fixed tenant operation: up to 25 ticket-number, category, status,
  priority, and update-time summaries. The route accepts no tenant, capability,
  SQL, field, filter, or limit input and returns no subject, description, UUID,
  person, message, event, database credential, or provider response.
- Grant, use, denial, error, and revocation events use the existing canonical
  hash chain with module version, operation class, count/size class, and server
  correlation ID but no result content or raw failure.
- RED was observed for the SDK policy, signed-version contract, support
  projection, migration schema, public store, and HTTP route. Focused GREEN
  passes 13 module-SDK tests, 34 security tests, 63 database unit tests, 6
  support tests, 155 platform tests, 28 migration unit tests, three live
  PostgreSQL migration cases, and two live public-store cases covering
  grant/use/revoke/deny, canonical audit chains, concurrent publication, and
  expired-grant replacement.
- A fresh isolated PostgreSQL 17 container passed all 183 RLS checks across 18
  tenant tables with the support-summary covering index applied. The forced
  uncached repository gate passed 57/57 tasks, the platform production build
  generated 27 pages, root and starter production dependency audits found no
  known vulnerabilities, the starter frozen lockfile passed policy, and
  `git diff --check` passed. Independent review found no remaining concrete
  issue after creator authority, publication locking, timeout, audit, index,
  version-source, and expiration findings were closed. Local gitleaks was not
  available; the pinned GitHub gitleaks job remains the hosted secret gate.
  Graphify refreshed cleanly to 3,563 nodes, 6,752 edges, and 228 communities.
  Pull request #19 merged the slice into `main` as `99d869a`; hosted run
  `29914040237` passed the main check, production build, Gitleaks, and fresh
  PostgreSQL RLS proof.
- Broad SQL/database capabilities, service grants, grant-management UI,
  provider permission mutation, Developer MCP exposure, publication,
  deployment, and genuine tenant data are not included.

## 2026-07-22 — immutable module ownership (`OPS-04`, verified)

- Added closed platform, installation, and tenant ownership contracts. The
  tenant creation constructor fixes scope to its tenant and installation;
  runtime assignment policy fails closed for unknown scopes or invalid targets.
- Control-plane migration `0014` adds immutable artifact versions, explicit
  entitlement versions, ownership-shape and installation constraints, creator
  attribution, reviewed promotion provenance, and triggers that deny cross-
  tenant private assignment, in-place identity/ownership changes, artifact
  rewrites, and stale/cross-installation source evidence.
- Existing built-in catalog rows receive an explicit `legacy_identity` digest
  label during migration rather than being misrepresented as artifact proof;
  only `sha256_artifact` sources can enter the promotion path.
- Catalog defaults are now platform-only in both PostgreSQL and native runtime
  resolution; installation-owned and tenant-private modules always require an
  explicit tenant entitlement, even if malformed legacy data claims a default.
- Added `PgModuleOwnershipStore` as the insert-only composition boundary.
  Creation, assignment, and promotion commit their hash-chained audit event in
  the same transaction. Promotion requires normalized installation authority
  carrying `owner.module.publish_installation`, a new identity, version, and
  digest, and exact creator/reviewer/publisher attribution.
- Remote module storage and runtime resolution are deny-by-default. They require
  standard HTTPS on an exact `MODULE_REMOTE_HOST_ALLOWLIST` deployment hostname
  and reject local/IP destinations. The proxy rejects decoded origin-changing
  or traversal path segments, follows no redirects, and forwards only a small
  content-negotiation header allowlist plus its newly signed context; platform
  cookies, authorization, proxy authorization, spoofed context, and arbitrary
  inbound headers never reach the module.
- RED was observed first in the platform-core public contract, database store,
  and a fresh PostgreSQL 17 control plane. Focused GREEN currently passes 21
  platform-core tests, 52 database unit tests, 29 migration tests including the
  live ownership case, 53 database tests including the live store case, and 149
  platform tests. Live audit chains for the source tenant, target tenant, and
  installation scope verify as canonical. The final forced Turbo gate completed
  57/57 tasks; the production platform build compiled and generated 27 pages;
  Graphify refreshed to 3,472 nodes, 6,529 edges, and 239 communities; and the
  capped independent security review found no outstanding concrete issue after
  its findings were fixed. Implementation checkpoint: `6fc3209`.
- No public promotion handler, deployment adapter call, marketplace, or
  Developer MCP publication tool was added.

## 2026-07-22 — production dependency audit gate

- Reproduced GitHub's high-severity `sharp`/libvips advisory through the locked
  production graph, then pinned Apache-2.0 `sharp` 0.35.3 at the pnpm workspace
  policy boundary because Next 15's optional range stops below the patched line.
- `pnpm audit --prod --audit-level high` reports no known vulnerabilities and a
  native runtime probe loaded sharp 0.35.3/libvips 8.18.3, encoded a 2x2 PNG,
  and read its metadata back correctly.
- CI now reruns that production audit on every pull request before the full
  repository checks and build, preventing a later lockfile refresh from silently
  restoring a known high-severity dependency.
- The Apache tenant starter now carries its own pnpm 11 workspace policy,
  frozen lockfile, audit instruction, and conditional libvips notice. A clean
  temporary copy passed frozen install, production audit, tests, and build so
  the security fix survives distribution outside the monorepo.

## 2026-07-22 — tenant onboarding and empty-brand path

- Tenant creation now accepts no website and writes empty brand-policy defaults
  and overrides instead of inventing a display brand or CSS theme.
- An optional bounded HTTPS website queues a separate request and inactive draft
  in an independent audited transaction. Enqueue failure cannot roll back the
  tenant, delete its provider organisation, or block provisioning; retries are
  idempotent and may resume a failed request or create a fresh request after a
  terminal discard through an explicit owner-console control.
- Added typed inactive brand proposals with value-level source URL and
  retrieval-time provenance plus explicit draft, reviewed, and discarded
  states. The owner console lists values and provenance; tenant-bound review and
  discard transitions commit their audit evidence atomically. Discard also
  terminalizes the queued request; empty proposals cannot be reviewed but
  remain safely discardable.
- PostgreSQL enforces request/proposal tenant binding, object-shaped values,
  required parseable per-value provenance, credential-free HTTPS authorities,
  one proposal per request, and coherent state timestamps. A disposable
  PostgreSQL 17 database passed migrations twice, valid draft/review/discard
  transitions, and explicit malformed-URL and impossible-timestamp denial
  before being removed.
- RED was observed for the initial onboarding cases, missing lifecycle route and
  page, and the overlong URL denial. Focused green verification passes 34
  tenant-route tests, 6 lifecycle-route tests, 3 owner-page tests, 2 admin-page
  tests, and 4 proposal-state tests; direct no-emit TypeScript checks pass for
  platform and platform-core.
- No website fetcher or external request is included. A queued URL is untrusted
  input, not SSRF clearance; the later fetcher retains every denial requirement
  in the accepted architecture.
- The first sandboxed production-build attempt exposed Browserslist walking
  above the linked worktree into an unreadable operator-home path. Declaring the
  platform's normal `defaults` target in its package boundary fixed the build
  without widening sandbox access.
- The external controller then passed 139 platform tests, all 57 repository
  lint/typecheck/test tasks, the 27-page sandboxed production build, diff
  integrity, and Graphify freshness before promoting `OPS-03` to completed in
  `393ae52`.

## 2026-07-22 — installation-owner permission seam

- Added a provider-neutral installation-owner authority contract and the
  approved initial installation permission vocabulary. The compatibility seam
  maps only an exact existing platform-administrator flag; tenant membership,
  tenant/module permission strings, unknown permissions, and ambiguous runtime
  authority fail closed.
- Tenant creation now checks `owner.tenant.create` through the installation
  guard and records successful and failure lifecycle evidence with an
  `installation_owner` actor. Its existing public route behavior remains under
  direct tests, including denial before provider or database work.
- RED was observed as a missing installation-authority module before production
  changes. Focused green verification passes 34 tests across the auth contract,
  platform guard, and tenant-creation route. The external controller then
  passed all 57 full lint/typecheck/test tasks, the 107-test platform suite, the
  22-page production build, diff integrity, and Graphify freshness before
  promoting `OPS-01` to completed in `9ac1a0e`.

## 2026-07-22 — managed-support context

- Added visible owner-console policy controls and opaque, server-side 30-minute
  sessions bound to a generated installation identity, tenant, real operator,
  reason, optional change reference, allowed action class, activity, expiry,
  and revocation state. Disabling policy revokes active sessions immediately.
- Removed ambient platform-administrator tenant access. Routine branding and
  non-sensitive module/navigation writes now require either real tenant-admin
  membership or a separately validated managed-support context; their audit
  evidence retains the installation-owner actor, support-session ID, and
  reason.
- Added a tenant-host reason/reference entry form and a persistent settings
  banner showing tenant, operator email, reason, elapsed time, and an explicit
  exit action. Tenant identity, operator identity, and support-session identity
  remain separate contracts. Lifecycle state and audit evidence commit or roll
  back in the same database transaction.
- Classified branding, presentation-only module settings, real domain
  labels/notes, and real connection labels/health notes as routine. Customer-
  data reads/exports, credentials, module access modes/passcodes, deletion,
  billing, identity, broader module grants, production-domain activation, and
  integration authorization always require separate authority and fail closed.
- RED was observed for the missing managed-support contract/resolver, exact
  tenant-binding regression, and audit-atomicity failure. Focused green
  verification passes 328 tests across auth, database, migrations, and platform.
  A rollback-only PostgreSQL runtime proof returned true for generated
  installation binding, policy-disable revocation, domain metadata isolation,
  and integration metadata isolation. The external controller then passed the
  declared platform suite, all 57 full lint/typecheck/test tasks, the 26-page
  production build, diff integrity, and Graphify freshness before promoting
  `OPS-02`; pull request #15 passed the repository check and live RLS proof and
  was merged.

## 2026-07-21 — baseline merge and repository hardening

- Added a local-first unattended-development controller after reviewing ten
  high-adoption agent-development projects and GitHub's security-first Agentic
  Workflows model. No upstream code or new runtime dependency was copied or
  installed.
- A versioned backlog now maps the approved multi-tenant operations sequence and
  its dependencies while representing Developer MCP, hosted Slack, compliance,
  provider, and production decisions as unselectable owner gates.
- The controller requires Node 22, exact pnpm 11.13.1, a clean `codex/`
  worktree, current Graphify state, no secret-bearing root environment file,
  declared path scopes and timeouts, an exclusive run lock, deny-by-default
  filesystem access, disabled tool network, controller-owned task and
  completion checkpoints, and deterministic argv-array checks in a sandboxed
  empty-home process.
- RED/GREEN coverage proves schema denial, dependency/owner selection,
  tool/path/time bounds, branch/version/dirty/secret/Graphify preflight,
  NUL-delimited Git path integrity, ephemeral restricted Codex arguments, task
  limits, immutable normal and recovery contracts, empty-home verification,
  ignored-state denial, scope enforcement, and completion gates. Live recovery
  hardening also covers sequential Graphify refresh, non-interactive child
  processes, disabled pnpm self-management, and exact JSONC-aware TypeScript
  incremental-cache permissions. Independent review also closed custom
  cache-path escape, committed whitespace-check, and stale-lock recovery races.
  GitHub CI then exposed a macOS-only child-runtime assumption; sanitized
  processes now retain the active Node directory and resolve Git from the live
  toolchain on both macOS and Linux. The focused controller suite now passes 32
  tests. The forced Node 22
  monorepo run passed all 57 lint/typecheck/test
  tasks; the forced platform build generated all 22 pages, and
  `git diff --check` passed. The same full
  profile passes with source read-only, no tool network, an empty home, and
  writes restricted to ignored build/cache output. Agent source writes are
  restricted to declared task paths, existing ignored dependencies/caches/run
  state are read-only and snapshotted, and Graphify regeneration is
  controller-owned.
- GitHub-hosted agent writes remain deferred. The current private user-owned
  repository lacks the protected merge boundary required for a preview
  compiler, model credentials, and privileged safe-output job; normal CI
  remains the remote verifier.

- Pull request #1 merged the governed OpenTenant baseline into `main` as
  `b78202e`; its pull-request checks passed, and the post-merge main run repeated
  the check and live PostgreSQL RLS-proof jobs.
- Public architecture and Developer MCP documentation now use stable,
  topic-based paths instead of dated or generator-specific URLs.
- GitHub now presents OpenTenant as a reusable template with curated topics,
  automatic merged-branch deletion, update-branch support, and web commit
  signoff.
- Dependency graph alerts, automated security fixes, and Dependabot security
  updates are enabled. Weekly pnpm-workspace and GitHub Actions update checks
  are declared in `.github/dependabot.yml`.
- Actions are restricted to GitHub-owned actions plus the pinned pnpm and
  Gitleaks actions used by CI; workflow tokens remain read-only by default and
  cannot approve pull requests.
- A security- and tenancy-aware pull-request template makes verification and
  durable documentation expectations visible to future contributors.
- GitHub rejected branch protection/rulesets and repository secret scanning for
  this private user-owned repository on its current plan. Local Gitleaks CI
  remains mandatory in the workflow; the external upgrade/publication decision
  is recorded in `OWNER-TASKS.md`.
- Accepted a stable architecture extension for the multi-tenant owner console,
  managed-support context, module ownership/data capabilities, first-class
  helpdesk and staged Slack transport, and SOC 2/Vanta evidence boundaries.
  This records approved intent only; implementation evidence will be added by
  vertical slice.
- Added official shadcn/ui monorepo configuration for the existing Tailwind v4
  design system. CLI inspection resolves the platform app and all installed
  shared primitives without overwriting their OpenTenant customisations.
- Added an Apache-2.0 tenant-module Next.js UI starter with Tailwind v4,
  semantic tenant-brand tokens, official shadcn/ui button/card/table source,
  preserved MIT provenance, a behavioral render test, and a passing standalone
  production build. Studio registries and credentials are absent from the
  reusable release.
- The separately released marketing site uses an owner-supplied licensed
  archive remains ignored and outside the reusable release; its exact hash,
  adaptation boundary, fonts, shadcn/ui source, and technology-mark provenance
  are recorded in the marketing repository. Local and production Playwright
  checks passed on desktop and mobile, including axe accessibility, FAQ
  behavior, metadata endpoints, viewport overflow, and security headers. The
  final live Lighthouse run scored 99 performance and 100 for accessibility,
  best practices, and SEO, with no browser console errors.

## 2026-07-19 — initial OpenTenant baseline

- Provider-neutral multi-tenant shell with tenant resolution, configurable
  branding, module entitlement, tenant administration, and remote-module
  composition.
- Provider-neutral identity gateway with WorkOS and non-production local
  adapters, role/permission normalisation, and tenant-bound sessions.
- Control-plane and tenant-plane PostgreSQL migrations, fail-closed FORCE RLS,
  encrypted tenant connection records, and resumable provisioning boundaries.
- Hash-chained append-only audit, short-lived Ed25519 module context, OAuth
  credential vault, connection consent/revocation boundaries, and support
  workflow primitives.
- Generic assessment, knowledge, and support example modules.
- Approved Tenant Module Developer MCP PRD, provider-neutral sandbox ADR, and
  Module Improvement Lab future PRD.
- Sandbox lifecycle contract, policy validators, deterministic conformance
  harness, sandboxd feasibility adapter, and injected Vercel hosted-adapter
  boundary. No hosted sandbox has been provisioned.
- Immutable synthetic module template and provider-independent orchestration
  proof with capability preflight, structured install/build/test commands,
  authenticated preview evidence, artifact digest, and failure-path teardown.
- Local-first Docker PostgreSQL, migration/seed command, environment template,
  and local identity mode. Hosted development infrastructure is not required.

## 2026-07-20 — repository knowledge and governance

- Tool-neutral documentation map with architecture and plans moved out of the
  generator-specific `docs/superpowers` hierarchy.
- Graphify 0.9.20 repository knowledge graph with local TypeScript,
  JavaScript, shell, JSON, SQL, and Markdown-structure extraction, portable
  graph artifacts, freshness instructions, and no model-token use for the
  baseline.
- Split public licence model: `AGPL-3.0-only` core, `Apache-2.0` module SDK,
  `CC-BY-SA-4.0` documentation, separately reserved trademarks, and an
  explicit commercial-licensing boundary.
- External contribution gate that preserves future dual-licensing rights until
  the legal steward and contributor agreement are approved.
- Initial hosted provider direction selected WorkOS identity, Vercel application
  hosting and sandbox execution, and Neon PostgreSQL data planes. Later work in
  this same iteration added Clerk as a complete WorkOS alternative per
  installation while retaining provider-neutral product contracts and explicit
  production gates.
- CI now enforces the platform production build in addition to lint,
  typecheck, tests, secret scanning, and the PostgreSQL RLS proof.
- Public design-system brand/class helpers now have deterministic coverage,
  and packages with established Vitest suites no longer pass silently when
  all of their test files are missing.
- Added the denial-first Developer MCP authentication prerequisite: exact
  WorkOS issuer/single-audience JWT verification and provider-neutral active
  tenant binding, without granting tools, capabilities, or sandbox access.
- Added a repository-grounded Developer MCP threat model covering WorkOS,
  tenant binding, Neon control state, Vercel Sandbox, previews, dependencies,
  hostile agent context, audit evidence, CI, and pre-exposure security gates.
- Stored passcode verification now rejects malformed parameters, encodings,
  lengths, and non-canonical base64url before invoking scrypt.
- WorkOS membership links now enforce immutable tenant/user ownership through
  one atomic PostgreSQL upsert and reject ambiguous membership identities.
- Approved sandbox templates are content-verified before provider creation;
  verified bytes and metadata are snapshotted against mutation, and the
  synthetic fixture now carries a frozen no-dependency lockfile with Node/pnpm
  pins.
- Tenant database tests directly prove transaction-local RLS context ordering,
  rollback, and destruction of clients whose rollback fails.
- Draft pull request #1 initially published the governed baseline branch for
  review; it was merged on 2026-07-21 after the required checks passed.
- Docker-backed PostgreSQL verification now passes locally: migrations are
  idempotent and all 13 `NOBYPASSRLS` tenant-isolation checks pass.
- An owner-approved Vercel REST probe created an ephemeral Node 22 sandbox with
  deny-all egress requested, executed one synthetic command, stopped it, and
  deleted its empty test project without creating a deployment or persistent
  OpenTenant project. Runtime egress enforcement remains unverified.
- The technical licence/provenance review is complete for the repository and
  installed macOS arm64 closure. An unreferenced unprovenanced social-icon
  sprite was removed, third-party notice requirements are durable, and
  owner/counsel publication gates remain explicit.
- A pnpm workspace override moves every PostCSS consumer to `8.5.15`; the
  production dependency audit now reports no known vulnerabilities.
- The owner-nominated WorkOS development environment now has the established
  `tenant-owner` and `tenant-admin` roles plus the registered localhost AuthKit
  callback. The live OpenTenant login redirect reaches hosted authentication,
  and callback failures remain generic and cookie-free; that initial
  configuration created no user, membership, tenant organisation, permission,
  domain, or production setting.
- Tenant provisioning now creates and compensatingly deletes WorkOS
  organisations through the auth package's narrow provider port. The platform
  no longer imports or directly depends on the WorkOS SDK.
- Hosted AuthKit now has a successful browser-driven synthetic proof: the real
  callback sets the sealed secure cookie, the session resolves an exact active
  `tenant-owner` membership and mapped local tenant, and all temporary provider
  and local objects are removed afterward.
- Plain-localhost default-tenant bootstrap now initializes the control-plane
  pool before querying it; a behavioral regression test covers the HTTP 500
  found during the hosted authentication exercise.
- The real Neon tenant-provisioning path now has a zero-cost US live proof:
  PostgreSQL 17 creation, tenant-core migration, least-privilege application
  role, forced fail-closed RLS, exact tenant context, and deletion all passed.
- Neon connection URIs are normalized to `sslmode=verify-full` on both create
  and resume paths so pg's announced v9 semantics cannot silently weaken
  hostname verification; malformed provider URIs fail without credential
  disclosure.
- Clerk is now a complete per-deployment identity adapter alongside WorkOS:
  exact issuer/authorized-party/audience verification, authoritative active
  session readback, canonical roles and allowlisted permissions, provider-bound
  organization/member persistence, normalized administration, and fail-closed
  tenant ownership checks.
- The Next.js shell composes Clerk middleware after host/header sanitization,
  uses native Clerk browser sessions and sign-in/sign-up/organization/user/
  sign-out controls, keeps WorkOS/local routes unchanged, and clears app-owned
  module access after native sign-out.
- Tenant creation and member settings no longer depend on WorkOS identifiers;
  selected-provider mappings use bound SQL parameters, compensation uses the
  neutral organization port, forms/audits carry internal membership IDs only,
  and mixed-tenant directory results fail closed.
- Local, WorkOS, and Clerk runtime smoke checks pass. A browser snapshot proves
  the Clerk signed-out controls and hosted sign-in modal without creating a
  provider user or organization. The unknown-host home route also now reaches
  the generic not-found boundary without logging a null-tenant exception.
- The technical licence/provenance closure was refreshed for the Clerk SDK
  addition: all four Clerk packages are MIT, the new `fast-sha256` transitive is
  Unlicense, packaged licence files are present, and the production audit has
  no known vulnerabilities.
- Identity-provider organization IDs now stop at the control-plane mapping
  seam. Tenant metadata removes the legacy provider column through additive
  migration `0002`, preserves immutable migration history, and supports retrying
  databases created from the earlier schema. Member administration also counts
  only another active owner when enforcing last-owner protection.
- Pending invitations are idempotent only when the provider role also matches;
  role mismatches fail closed instead of preserving unintended privilege.
  Active-owner removal now serializes its provider snapshot and deletion with
  a tenant-keyed PostgreSQL transaction advisory lock across application
  processes.
- Added an optional Vercel operator MCP runbook for deployment inventory,
  bounded build/runtime logs, approved preview fetches, and read-only Toolbar
  feedback. It keeps operator OAuth outside the template, separates Vercel MCP
  from tenant-bound OpenTenant MCP surfaces, requires confirmation for every
  call, and prohibits unattended CLI, deployment, domain, and purchase
  operations.
- Updated all GitHub Actions pins from deprecated Node 20 implementations to
  verified immutable Node 24 release commits. The replacement pull-request run
  passed lint, typecheck, tests, platform build, secret scan, and PostgreSQL RLS
  proof with zero annotations and no Node 20 compatibility warning.
- Tenant provisioning now fails closed on missing or unsupported regions and
  malformed brand keys before any control-plane, identity-provider, or hosted
  provisioning work.
- Tenant activation and its success evidence now share a guarded control-plane
  transaction; stale lifecycle transitions, audit failures, and secondary
  failure-audit outages retain the resumable pending path.
- Hosted provisioning now runs the canonical, checksum-tracked tenant-core
  migration catalog. Exact untracked legacy schemas baseline safely, malformed
  schemas fail closed, migration `0003` enforces one tenant identity per
  database under FORCE RLS, and the app-local duplicate SQL has been removed.
- Control-plane and Brain hash chains now reject sequence gaps and use
  JSONB-order-independent canonical hashing. New control-plane hashes bind the
  tenant scope while exact legacy digest verification remains available.
- The PostgreSQL CI proof now inventories all 18 tenant-scoped tables, verifies
  exact tenant policy predicates plus ENABLE/FORCE RLS, exercises every table
  under missing/wrong/correct contexts, proves the full immutable/redaction
  matrix, and cleans up its synthetic role. Fresh PG17 runs pass 183 checks.
- PR-head GitHub Actions run `29779458840` passed the full `check` and
  `rls-proof` jobs for this five-slice hardening checkpoint, including platform
  build, secret scan, live PostgreSQL proof, and container teardown.
- Lost tenant-creation and activation commit acknowledgements now reconcile
  against the exact audit sequence/hash and complete row set from the attempted
  transaction. A readback outage never triggers destructive identity-provider
  compensation for an outcome that may have committed, and activation ambiguity
  does not create a contradictory failure audit.
- The assessment readout runs on Node.js with behavioral coverage for
  OpenAI-compatible and Anthropic streaming plus normalized provider/network
  failures; the prior Edge-runtime build warning is removed.
- Audit verification now reports canonical, empty, legacy-unbound, and
  unverified assurance explicitly, rejects canonical-to-legacy format
  downgrades, and preserves every historical hash unchanged.
- Tenant migration preflight diagnoses multiple identity anchors before
  tracking setup on untracked legacy databases. Its transaction retains the
  table lock through baselining and singleton enforcement, preserves FORCE RLS
  and all rows, and links a non-mutating isolated-clone recovery procedure.
- PR-head GitHub Actions run `29782937548` passed `check` and `rls-proof` for
  the residual closure, including all tests, production build, secret scan,
  183 live isolation checks, and PostgreSQL container teardown.
- Added a human-readable product layer across the README, changelog,
  documentation index, and platform-capabilities guide. It distinguishes
  implemented, development-verified, foundation-only, example, and owner-gated
  behavior; explains the WorkOS-or-Clerk deployment choice; and names future
  provider adapters such as Supabase as possible rather than currently
  supported.
- Enriched the GitHub-facing README with project branding, CI/toolchain/licence
  badges, a provider-aware architecture diagram, feature and example-module
  maps, security and Developer MCP boundaries, local routes, repository
  topology, verified proof points, and a now/next/later roadmap. The pre-1.0,
  production, genuine-data, and public-release limits remain prominent.

## 2026-11-11: go-live configuration and migration tooling

Tenant creation uses a validated installation base domain. Production startup
validates server configuration, and `/api/ready` checks the control plane with
bounded timeouts. Provisioning applies core, brain, and support catalogs with
role creation before module grants and verifies catalogs on resume. The RLS
proof shares that production schema path. A separate guarded hosted migration
command supports control-plane and canary-first fleet upgrades.

Local Node 22.23.2 / pnpm 11.13.1 checks and platform build passed. Migration
execution passed 148 tests on isolated Postgres 17. RLS, database-store, and the
new fake-Neon provisioning integration proof could not complete because the
cached local image has no pgvector. No external services were contacted to
obtain it. See [exact evidence](reviews/2026-11-11-go-live-blockers.md).
No hosted deployment, production verification, or genuine tenant-data use is
claimed. Marketing impact: truth.

## 2026-11-11 — local custom-domain verification and tenant tokens

Added owner/admin add, DNS TXT verification and removal with atomic audit
transactions, hashed challenges and expiry in migration 0048. Custom-host
resolution enforces unexpired evidence without caching; identity/settings GETs
redirect to the verified platform subdomain without relaying OAuth codes.
The root layout renders validated resolved tenant color/font CSS variables.
Hosting remains a disabled-by-default dry-run adapter, and the periodic decision
has no worker wiring. Three Playwright-ready specs await the shared harness;
ECS White-label browser proof remains incomplete.

Dedicated proofs passed 57 platform checks, 45 domains-package tests, 314 RLS
checks, 30 store assertions and 148 migration tests. Full-workspace and build
rerun limitations are recorded in the [proof record](reviews/2026-11-11-custom-domains.md).
No push, PR, real provider operation or deployment. Marketing impact: truth.
## 2026-11-11: Durable worker, owner bootstrap and tenant lifecycle

Local implementation adds pinned Graphile Worker, queued provisioning with 202
job IDs and audited retries, per-tenant helpdesk projection scheduling, a
single-use expiring owner claim, audited suspension/resumption, restricted-role
local exports with expiring downloads, and retention-based hard erase. The
operator seed, worker entry point and runbook are included. No hosted operation,
provider API proof, push or PR was performed.

Verification passed 63 uncached quality tasks, 1,534 Vitest tests and 137 Node
tests; platform build 1/1; 314 RLS checks; 30 database-store assertions; 148
migration tests; six worker integration cases; and the provisioning case with
nine assertions. Browser readback confirmed the audited retry transition.
Production dependency audit has zero high/critical and one moderate advisory.
See [the exact commands and limits](reviews/2026-11-11-wave2-worker-proofs.md).

The 423 helper awaits shared-gate wiring at integration; existing APIs deny
suspended access through their current generic paths. Application Workflow use
is gone, but the Next wrapper, its test mock and dependency remain for the
orchestrator to remove. Root ESLint ignores only the three exact generated
Workflow handlers. Control-plane migrations 0040-0044 leave the reserved gap;
tenant-core 0010-0011 were unused. Marketing impact: truth.
