# OpenTenant operational handoff

Use the [developer workspace guide](tooling/local-workspace.md) for local setup
and the repository privacy check. Keep machine-specific evidence in `.local/`.

## Local tenant demo and module bindings, 2026-11-26

Run `pnpm local:demo` from a checkout without platform dotenv files.
The local worker provisions synthetic tenants and writes a private link
that opens Support. Ctrl+C removes the demo resources. See the
[adopter guide](adopters/getting-started.md#try-the-full-platform-locally).

Brain and Support expose typed factories at their existing manifest entry
points. Keep binding implementations in the host composition.

## Public source and documentation, 2026-11-24

Use a checkout of the [public repository](https://github.com/nyldn/OpenTenant)
for new work. Its first commit is the clean import. The development archive
stays private. GitHub secret scanning and push protection are enabled.
Hosted CI failed to start because of billing.

Start with the [README quick start](../README.md#run-it-locally) and
[documentation index](README.md). External contributions, package releases,
and production activation retain their separate [owner gates](OWNER-TASKS.md).

## UAT operator controls, 2026-11-17

`pnpm uat:control` now supports guarded local provisioning conflicts, safe
status/clear, and tenant-scoped export expiry. Disposable-stack proofs exercise
five failed provision attempts, product retry to active, expired download denial,
and reset/restart cleanup. Private Alpha/Beta PNGs survive reset byte for byte.
The controls change fixtures without production hooks. The audit persona
baseline still expects old denial redirects that predate this branch's changes.
See the [operator guide](../tooling/uat/README.md) and
[Q1 verification](reviews/2026-11-17-wave7-q1-controls.md).
No push, hosted resource or production enablement. Marketing impact: none.

## Current reconciliation, 2026-11-17

E11 reconciles documentation against wave-6 baseline `d818389`. The
[receipt ledger](plans/2026-11-17-e11-reconciliation.md) supersedes stale
capability and count summaries below. Earlier dated checkpoints, including the
September delivery summary, describe their own revisions.

- V1 records 17 database-sequence steps and 358 cases with zero skips, 406 RLS
  checks across 41 tables, full migrations 178 passed with zero failures/skips,
  and 115/115 quality tasks. The Developer MCP package receipt records 141 passed.
- `d818389` records browser listing at legacy 16, journeys 41, reset 24 and
  audit 702; production lists separately at 6. Collection is not a fresh browser
  run. V3's historical 114/115 quality run is not silently upgraded to a pass.
- The [real Developer MCP route proof](reviews/2026-11-17-developer-mcp-route.json)
  includes OAuth/PKCE, human confirmation, VM execution/destruction, static
  preview and negative controls. It is separate from the Nov 14 provider proof.
  Production stays disabled behind OWNER-DEVELOPER-MCP-02.
- Support has durable email and review-only suggestion UI/API composition.
  Routed generation and rejected-output quarantine remain unavailable. `/brain`
  renders an unavailable state; its signed knowledge API is separate. Optional
  R5 chat/embedding adapters exist but have no live model-provider validation.
- [V3](reviews/2026-11-17-wave6-v3.md) passes 6/6 frozen budget tests while
  Assessment still misses LCP/CLS and shared shell payload misses its target.
  UAT-015 stays open. Wave-7 UAT
  ([Q1 r1](reviews/uat-2026-11-17/q1-findings-r1.md)) did not pass: 4 pass,
  2 fail, 24 blocked of 30, no P0/P1. UAT-020 and the fixture blocks are fixed
  but not re-run. ECS is **4.25** ([receipt](reviews/2026-11-17-ecs-wave7.md)).
- GitHub Actions is billing-blocked, with no hosted receipts for these waves.
  OWNER-KVM-CI-01 still requires an approved runner and actual KVM receipt.

The legacy controller ledger records 53 completed non-owner tasks and four
pending owner entries; it does not report later UX wave completion. No public
release, npm publication, production or counsel gate is cleared. Marketing
impact: none, reconciliation of already committed evidence only.

## Persistent UAT, 2026-11-14

`pnpm uat:serve` keeps a synthetic loopback stack running until interrupted.
It shares e2e provisioning and the local module/DNS stubs, seeds seven tenants
and ten personas, and writes a private `.uat/manifest.json` with browser URLs
and SSH forwards. `pnpm uat:down` removes only this worktree's labeled resources.
See [the UAT guide](tooling/uat.md) for dev versus built identity behavior.
No push, PR, hosted resource or production enablement. Marketing impact: none.

## Real sandbox and SMTP proofs, 2026-11-14

The local `t3/real-sandbox-smtp-proofs` branch adds required Docker proofs.
Microsandbox 0.7.13 boots with only `/dev/kvm`, passes egress/environment/limit
and destruction checks, and needs no privileged container. The proof fixed
streamed exit-status handling and persisted VM cleanup in the adapter.
The latest boot is 0.447 s and complete command 3.906 s. SMTP passes four real
transport/Support/Better Auth mail tests in 18.612 s with no skips.
See the [verification record](reviews/2026-11-14-real-sandbox-smtp-proofs.md).
New CI jobs have not run; the owner must confirm hosted runner KVM support.
No push, PR or production activation occurred. Marketing impact: truth.

## Runtime environment lint families, 2026-11-11

The local `t3/env-lint-families` branch replaces named environment access checks
with construct-family bans across host, package and module runtime source.
Only the reviewed platform-core runtime-globals helper is newly exempt.
Browser operations use its dedicated export; process singletons retain their
existing symbol keys. SMTP uses an optional, lazy literal Nodemailer import.
The threat model and accepted residuals are recorded in the environment policy.
See [verification and failed attempts](reviews/2026-11-11-env-lint-families.md).
Marketing impact: none.

## ECS wave 5, 2026-11-11

Wave 5 closes the environment destructuring/import lint bypasses, removes legacy
SQL setup from the exhaustive RLS proof, caches generated SQL assets, and makes
E2E listing independent of test execution. The proof passes 316 checks across
31 tenant tables. Legacy schema preservation has its own migration test.

`pnpm release:local-proof` validates and publishes all 23 public packages to a
disposable local Verdaccio registry, compares the served tarballs and exports,
and proves clean-container scaffold/start with tenant home 200. It passed in
229.424 seconds including database setup. This is local publication evidence;
public npm publication and GitHub OIDC provenance remain owner-gated.

The forced quality gate passes 112 tasks with 2,050 passed tests, zero failed
and 75 skipped. Dedicated live proofs, measured durations, initial failures
and reruns are recorded in the [wave-5 evidence](reviews/2026-11-11-ecs-wave5.md).
No push, PR, public publication or production enablement was performed.
Generated Graphify changes remain uncommitted.

## Integration wave 4b, 2026-11-11

Wave 4b integrates isolated CI databases and production-provisioned browser
fixtures, then Developer MCP and real Brain tools. Runtime imports consume built
packages. Brain registers through its manifest and receives scoped host ports;
its declared execution mode prevents local embedding fallback in production.
E2E entitlements derive from the fixture registry. The module audit remains zero,
with one additional explicit generated-host composition exclusion.

Forward MCP migrations, global startup validation, exact-count CI, local/Better
Auth PKCE authorization metadata and browser confirmation are integrated. The
production route remains rejected without OWNER-DEVELOPER-MCP-02 approval, and
real microVM isolation remains unverified. Better Auth browser forms preserve
Origin and logout uses the canonical provider path. Nineteen browser cases pass
without skips, including signup/invitation/sign-in/logout and both MCP journeys.

The unpublished public `create-opentenant` package scaffolds a minimal host from
pnpm tarballs. Final clean Node 22 proofs measure 40.463 seconds for local identity
and 41.278 seconds for Better Auth, including migrations, synthetic provisioning,
typecheck, home 200 and an authenticated session check. It is a public synthetic
welcome host, not the complete platform or production credential custody.

The final forced gate passes 112 tasks and 2,044 tests with zero failures and
75 skips. Dedicated database proofs execute 73 of those skips; optional real
SMTP and microsandbox remain unverified. Twenty-three public packages pass validation. The database sequence passes 139
tests, RLS passes 314 checks, MCP/Brain passes 166 tests and migrations pass 178
without skips. Restore loses zero synthetic rows with measured RTO 14.574 seconds;
this does not establish production RPO/RTO. The smoke deploy passes on ports 3496
and 55496 and cleans up its own resources. Exact final quality counts, failed
attempts and retries are in the [wave 4b record](reviews/2026-11-11-integration-wave4b.md).
No push, PR, npm publication or production enablement was performed. Generated
graph changes remain uncommitted. Real SMTP and microsandbox remain unverified.

## Integration wave 4a, 2026-11-11

Wave 4 combines built public packages and SQL assets, the installed module
registry, and restore/adopter tooling. Native pages and APIs live in module
packages. Registry contributions supply navigation, settings, permissions,
catalog defaults, migration catalogs, export schemas, telemetry and module
configuration. Shared packages receive installation defaults and cookie/activity
identifiers. The special-case gate is zero after seven documented exclusions.

The packed Hello proof installs a tarball and changes one composition line in
a temporary host, then builds and proves its route, navigation, live entitlement
denial, SQL/RLS and replay without core edits. Public package validation covers
22 packages and all historical migration checksums. The runtime environment
rule covers apps, packages and modules at error level with zero violations.

The final forced gate passes 108 tasks and 2,027 tests, with 52 skips. Fifty
skipped database cases pass in dedicated ephemeral proofs; optional real SMTP
and microsandbox cases remain unverified. All eleven browser cases and both
local container smoke runs pass. See the [complete integration record](reviews/2026-11-11-integration-wave4a.md)
for every command, failed development run, exclusion and commit. No push, PR,
publication, hosted provider mutation or production deployment was performed.
Generated graph changes remain uncommitted. Public release stays owner-gated.
## Fix-wave-4 MCP and Brain local implementation, 2026-11-11

Developer MCP now has a disabled route with one synthetic service-template tool,
PostgreSQL authority/audit/admission/confirmation/switch guards, and single-use
static preview exchange after VM teardown. No deployed configuration is enabled.
OWNER-DEVELOPER-MCP-02 remains pending. The
[runbook](runbooks/developer-mcp.md) lists the integrator-owned migration 0070,
global startup and CI wiring, OAuth and browser-review composition, and real VM
proofs still required before exposure. No production-completeness claim applies.

Brain was made real using its existing forced-RLS schema and pgvector. Search
resolves the tenant-approved embedding model route; local tests use deterministic
hash embeddings. Signal promotion and the decision chain commit together. The
HTTP route intersects signed grants with the matching session's live entitlement.
Hosted embedding adapters remain unconfigured. No model provider, push, PR or
production operation was performed. See the [fix-wave-4 verification record](reviews/2026-11-11-fix-wave-4-mcp-brain.md).

## Integration round 3, 2026-11-11

Round 3 combines observability and rate limits, the 11-case domain/theming
browser suite, and Better Auth. Tenant resolution emits a scrubbed span.
Tenant creation and lifecycle mutations share the installation-owner limit.
Suspended API gates return an uncached, secret-free 423. Local identity accepts
explicit `LOCAL_USERS` entries outside production, so browser tests use the real
session composition. Only the DNS route retains the guarded e2e composition seam.

Production selects `PROVISIONING_PROVIDER=neon|postgres`. The Postgres adapter
uses an operator admin connection, separate tenant databases and login roles,
canonical migrations, encrypted runtime credentials, and resume checkpoints.
The Postgres `ap` label declares operator placement; it does not route geography.
R11-12 and R11-18 are fixed with named regressions, closing all 18 index entries.
Better Auth runs the shared identity contract against ephemeral Postgres.
Its notification transport is off until `IDENTITY_SMTP_HOST` is configured.

The environment lint rule is an error. Build/edge configuration uses pure
projections; the only raw reads outside server-config are Next's two literal
runtime selectors, with documented ESLint exceptions. See the round-3 review
record for exact verification results. Earlier handoff sections are historical.
No push, PR, hosted provider operation or production deployment was performed.

## Integration wave 2, 2026-11-11

The local integration combines test hardening, authorization, durable lifecycle,
the disposable database runner, and sandbox/usage adapters. Workflow build
wrapping is removed. The durable worker exports usage to private local files by
default; OpenMeter requires endpoint and key configuration. See the
[verification record](reviews/2026-11-11-integration-wave2.md) for command outcomes,
regressions fixed during integration, and remaining limits. No push, PR or
production operation was performed. R11-12 and R11-18 remain open.

Date: 2026-08-07

Use this document to resume work. It describes current operating boundaries and
where to verify state; it does not repeat delivery history. Read
[`RTK.md`](../RTK.md) first. Detailed implementation evidence belongs in
[`SHIPLOG.md`](SHIPLOG.md), product-facing release history belongs in
[`CHANGELOG.md`](../CHANGELOG.md), and external decisions belong in
[`OWNER-TASKS.md`](OWNER-TASKS.md).

## Local audit checkpoint hardening: 2026-11-11

The local `t3/audit-checkpoint-hardening` branch adds signed external audit
checkpoints and TRUNCATE guards through forward migrations. No external
service, push, PR, or deployment was authorized. The signer must run separately
from the application with its own Ed25519 key. Configure and schedule it using
[the audit checkpoint runbook](security/audit-checkpoints.md). The commands
`pnpm audit:anchor` and `pnpm audit:verify` do not activate a scheduler or create
production key material. See [the local verification record](reviews/2026-11-11-audit-checkpoint-hardening.md).

## Reproducible deployment definitions: 2026-11-11

The local deployment definitions add a standalone non-root image, a Postgres 17
Compose stack with one-shot control-plane migrations, a disposable smoke script,
a dry-run-first Vercel REST helper and an optional Kamal template. See
[runbooks/deploy.md](runbooks/deploy.md). The migration adapter reuses the
existing runner until `pnpm migrate:hosted` lands. Tenant provisioning remains
separate; `/api/health` still proves liveness only. No hosted deployment,
provider mutation, push or PR was performed. Owner gates are unchanged.

## Local key rotation and email: 2026-11-11

The keyring accepts versioned tenant-bound ciphertext and legacy `k0` records.
`pnpm keys:rotate` scans all three durable credential tables with resumable,
audited batches. See [the rotation runbook](runbooks/encryption-key-rotation.md).
Control-plane migration `0045_credential_rotation` adds run checkpoints.

Support Depth can compose a real SMTP transport with React Email templates.
The synthetic test transport remains available. Mailpit's loopback bindings,
CI-required test mode and the module's current in-memory delivery limit are
in [the email runbook](runbooks/transactional-email.md). No SMTP provider,
production resource, push or PR was enabled by this change.

## Local authorization adapter checkpoint, 2026-11-11

`@opentenant/authz` now provides the default manifest role-map policy and an
opt-in OpenFGA adapter. `resolvePermissions` checks live tenant entitlements,
uses reviewed catalog manifest snapshots, and caps mapped permissions by role
before applying IdP claim restrictions. Existing unmapped third-party modules
retain the documented legacy exception. Migration 0063 seeds mapped built-ins
and reserves optional installation-bound OpenFGA IDs; 0064 is unused.

Membership/entitlement sync and module snapshot publication still need the
integration owner's lifecycle wiring. The separate migration fixture that
replays 0029 after all other migrations must apply history in order before the
database migration gate can pass with 0063. No other owner's routes were changed.
See [authorization architecture](architecture/authorization.md) and
[local verification](reviews/2026-11-11-authorization.md). No production provider
activation, push, or PR is included.

## Sandbox vendors and usage export, 2026-11-11

Optional E2B and local microsandbox adapters are implemented behind the existing
sandbox contract with shared mock conformance. E2B requires explicit provider/key
configuration and verified deny-all controls. Local microsandbox disables the
NIC and image pulls; authenticated previews are unsupported and its real microVM
test was not run because no approved image was cached. Hosted execution remains
owner-gated. See [sandbox providers](architecture/sandbox-providers.md).

The new `@opentenant/usage-export` package provides `runUsageExport`, a minimal
OpenMeter CloudEvents adapter and an idempotent development file sink. Apply
migration 0065 before the worker agent wires its scheduler. Receipt-backed
cursors handle late commits without changing ledger semantics. Billing remains
gated by OWNER-BILLING-01. See [worker wiring](architecture/usage-export.md).
## Wave 2 observability and rate limits, 2026-11-11

The local `t3/observability-rate-limits` branch adds optional OTLP tracing,
content-free pino logs, optional Sentry-protocol server error capture, generic
error boundaries and PostgreSQL mutation limits. See
[the SLO runbook](runbooks/slo.md) for the opt-in environment variables and
trusted-ingress IP requirements. Apply control-plane migration 0050 before
starting the route gates. No collector, DSN, cloud resource or provider was
contacted; only npm registry downloads and audit were authorized.

The tenant-resolution owner must wire `traceSpan("tenant.resolve", callback)`
in `lib/tenant.ts`. The lifecycle owner must call `enforceRateLimit` in
`app/api/admin/tenants/route.ts` after its owner gate, with server-owned scope
`installation`, the verified user, and route class `tenant-creation`.
`middleware.ts`, `lib/tenant.ts`, and `app/api/admin/tenants/**` are unchanged.
These remaining wiring steps prevent a claim of complete route coverage.
The [verification record](reviews/2026-11-11-observability-rate-limits.md)
lists exact local commands, all 16 rate-limited routes, and deferred surfaces.
The full gate passed 63/63 uncached tasks and the platform build passed.
## Self-hosted identity adapter, 2026-11-11

`IDENTITY_PROVIDER=better-auth` selects the optional self-hosted adapter. Apply
control-plane migrations 0060–0062 and configure `BETTER_AUTH_SECRET` and
`BETTER_AUTH_BASE_URL`. Production requires HTTPS and a secret of at least 32
characters. The [adapter runbook](architecture/better-auth-adapter.md) explains
local email/password login, explicit SSO/SCIM configuration and email hooks.
External IdP proof and production email delivery remain installation work.
The full quality run passed. The separate migration suite needs the unowned
0029 store fixture updated to apply its baseline before, rather than after,
the migration under test; the runbook identifies the exported helper.

## Local security hardening checkpoint: 2026-11-11

The local `t3/harden-security-batch` branch hardens module proxy boundaries,
identity setup, member mutations, production secret separation and development
host selection. No push, provider call or deployment was authorized. Review
[`reviews/2026-11-11-security-hardening.md`](reviews/2026-11-11-security-hardening.md)
for the audit results, regression coverage and exact local verification.

Production now requires separate `MODULE_ACCESS_SECRET` and
`CONNECTIONS_STATE_SECRET` values. WorkOS cookie-key fallback remains available
only outside production. No key values were created or changed by this task.
The production audit has zero high/critical findings and one remaining moderate
Workflow transitive `minimatch` advisory; the standalone template audit is clean.

## Checkpoint: 2026-09-09

The canonical checkout was on `main` at `51263b2` when this checkpoint was
opened. `origin/main` is
`edff47d`, so these local commits have not been pushed or merged:

- `134bb87` unifies local setup with the canonical migration runner.
- `2af84de` derives quality coverage from the workspace inventory.
- `723a3a7` records the focused simplification plan for FS-01 through FS-04.
- `d0de1fc` refreshes the tracked Graphify report and graph for this revision.
- `b72fef2` records the resume checkpoint and its owner-gated next action.
- `5a510b2` refreshes the tracked Graphify report and graph after that checkpoint.
- `4557903` aligns the checkpoint with the current head.
- `7527551` installs the project-local Archify Codex skill and its lock record.
- `51263b2` keeps the vendored Archify skill out of the repository graph.
- `983a0f9` refreshes the tracked Graphify output after the Archify install.
- `fc73bd6`, `a0a0628`, `0473d4d`, and `02f7196` add and harden the guarded
  Archify updater.

The focused simplification plan is saved at
[`docs/superpowers/plans/2026-09-07-focused-simplification.md`](superpowers/plans/2026-09-07-focused-simplification.md).
FS-02 remains on the preserved `codex/fs-02-assessment-state` worktree, and
the separate integration worktree still holds the reviewed DMP-07 foundation.
Those worktrees were not merged, removed, or cleaned during this checkpoint.

Archify is available to Codex from `.agents/skills/archify`. Use the project
wrappers documented in [`docs/tooling/archify.md`](tooling/archify.md), and
restore or update it through `skills-lock.json` rather than adding it to the
OpenTenant runtime dependency graph.

The macOS LaunchAgent `com.opentenant.archify.update` is installed for the
current user. It runs at login and every seven days, updates only Archify and
its lock record, runs `doctor`, commits locally, and never pushes. It skips
uncommitted OpenTenant source, documentation, or configuration, non-`main`
branches, and Git operations in progress; generated-only `graphify-out/`
changes are allowed. Logs are in `~/Library/Logs/OpenTenant/`.

The current read-back passed `git diff --check`, the full uncached repository
check with 63 of 63 tasks successful, and `graphify check-update .`.
`pnpm unattended:status` reports no awaiting verification, executable task, or
supervised task. The Graphify refresh still reports missing `tree_sitter_sql`
support and syntax warnings in two support files; those warnings do not change
the owner or production boundary.

Archify verification passed under Node `v22.23.2`: `doctor`, the guide command,
showcase validation with 9 of 9 checks, deterministic delivery, and automated
browser visual-check on the bundled example. The visual-check result is
automated evidence; it is not a human visual review.

The next action is owner input for whichever Slack or Developer MCP proof path
should advance. The owner supplies the selected scope and non-secret aliases or
references. I then prepare the exact proof artifacts for review and request a
separate approval for each external action. No Slack message, webhook change,
hosted proof, route registration, provider activation, deployment, or
credential use is authorized by this checkpoint.

## Go-live blocker fixes, 2026-11-11

The worktree now validates server configuration at runtime startup, requires a
production tenant base domain, and exposes `/api/ready` separately from liveness.
Provisioning uses the canonical core, brain, and support migration path, and
rechecks it on resume. The RLS proof now exercises that shared path after its
legacy fixture setup. CI also runs an end-to-end provisioning test with real
Postgres and only the Neon API faked. No applied migration was edited.

The explicit `pnpm migrate:hosted` operator command supports read-only planning,
host confirmation, checksum verification, and canary-first fleet progress. See
[the runbook](runbooks/hosted-migrations.md). Automated Neon provisioning still
accepts only `us` and `eu`; storage accepting `ap` does not select a provider
region. No production or provider operation is authorized by these changes.

The merged security and go-live changes passed local proofs using CI's
pgvector/Postgres 17 image: 314 RLS checks, 30 store assertions, 148 migration
tests and the provisioning integration case with nine assertions. The latter
proves a restricted-role support insert on a freshly provisioned tenant,
context isolation and credential preservation on resume. See
[the merged verification record](reviews/2026-11-11-merge-proofs.md) for exact
commands and the earlier proof's credential-decoding fix. These are local
synthetic proofs; no production or provider operation was performed.

## Browser test harness

`pnpm e2e` runs the Chromium suite in `tooling/e2e` with isolated local
Postgres 17, canonical migrations, synthetic identity, and a local HTTPS
module stub. See [the browser test guide](tooling/e2e.md). The existing
quality matrix remains build-free with 22 workspaces and 66 tasks. All eleven
cases, including custom domains, tenant themes and the R11-06 proxy cache-policy
regression, are active. This adds
local automated evidence and does not authorize hosted or production work.

## Product boundary

OpenTenant is a provider-neutral multi-tenant application platform. It owns
tenant resolution, identity normalization, branding, module entitlement,
signed context, audit evidence, and policy. Native and remote modules consume
OpenTenant contracts without receiving control-plane credentials or another
tenant's data.

The application currently has no authorized production deployment or genuine
tenant-data scope. Development credentials and synthetic probes do not grant
either. Keep the README roadmap conservative until a separately authorized
production deployment and smoke verification have completed.

## Resume sequence

1. Confirm the checkout and current branch with `git status --short --branch`.
2. Read `docs/plans/unattended-backlog.json`; it is the task-state source of
   truth. Do not infer task state from this narrative.
3. Run the unattended status command and compare it with the backlog before
   selecting work.
4. Check `docs/OWNER-TASKS.md` before any provider, production, genuine-data,
   billing, compliance, Slack, or production Developer MCP activation.
5. Query Graphify before broad source exploration.

```sh
fnm exec --using=22 -- pnpm unattended:status
graphify query "What owns the behavior I need to change?"
```

`fnm exec --using=22 --` selects the repository's Node major without assuming
an Intel or Apple Silicon Homebrew path. Confirm `node --version` and
`pnpm --version` through the same prefix before recording verification.

## Historical September delivery state

The September 15-task implementation program has accepted M1, corrected M2, M3
and GFinal outcomes. Its three M3 deliverables are reviewed implementation
contracts, not active product capabilities.
`docs/reviews/2026-09-06-m2.md` records the
policy-bound model, brand upload/review/apply and restorable Assessment browser
journeys. `docs/reviews/2026-09-06-m3.md` records the Developer MCP, Support AI
and Quality Contract designs accepted at integrated revision `2bc70c7`. Final
program review accepted `cba0632`; see `docs/reviews/2026-09-06-final.md`.

The governed backlog has 53 completed non-owner tasks and no next executable or
supervised task. Four owner-controlled entries remain pending. Do not register
the M3 follow-on packets until their stated design, dependency and authority
gates permit it.

The dependency-ordered `SIMPLIFY-01` through `SIMPLIFY-05` program is
implemented in this revision. The program preserved capabilities, database
schemas, permission vocabulary, external package APIs, and provider boundaries.
Check the current GitHub revision to determine whether this revision has merged;
do not record production verification because no production deployment exists.

- Quality work is split into 21 distinct lint, 21 typecheck, and 21 test tasks.
  Lint uses the root flat configuration; Turbo does not build during checks.
- Reusable control-plane work uses `controlPlanePool()` and
  `withControlPlaneTransaction()`. Tenant RLS pools, provisioning's one-shot
  tenant pool, and the workflow heartbeat pool remain physically separate.
- Server Component tenant and session reads use React request-scoped cache.
  Route handlers still perform explicit identity, tenant, permission, and gate
  checks and must not depend on memoization.
- Production route and page files delegate persistence to domain stores.
  Audited writes use the same-client transaction helper, and tenant-admin
  context supplies the derived audit actor.
- The unattended runner, Support AI, and Support Depth retain stable facades
  over focused policy, adapter/store, verification, Git, agent, and service
  modules. Preserve the facade contract tests when changing internals.
- Assessment keeps `AssessmentApp` as a small provider/shell coordinator.
  Shell, questionnaire, responses, results, primitives, and export behavior
  live in focused modules. Preserve scoring, evidence, respondent CRUD,
  consolidation, AI readout, PDF, CSV, JSON, demo mode, and sign-out.

`OWNER-BILLING-01` remains untouched and owner-gated. Exact usage evidence is
not pricing, entitlement, invoicing, checkout, or payment-provider behavior.

## Sources of truth

- `docs/plans/unattended-backlog.json` — task status, dependencies, permitted
  paths, acceptance criteria, and verification commands.
- `docs/OWNER-TASKS.md` — decisions and authority that only the owner can
  supply.
- `docs/SHIPLOG.md` — exact engineering evidence and historical checkpoints.
- `CHANGELOG.md` — concise product narrative for development iterations.
- `docs/product/platform-capabilities.md` — present capability maturity.
- `docs/runbooks/` — provider, tenant, recovery, and operational procedures.
- `graphify-out/wiki/index.md` — broad repository navigation.
- `graphify-out/graph.json` — current repository graph.

Git state, live provider readback, and current database evidence override old
narrative text. A visible directory may be a worktree or container rather than
the authoritative checkout, so verify remotes and branches before writing.

## Core operating boundaries

### Tenant and database isolation

- Resolve tenant context before data access and retain visible authorization at
  every HTTP mutation boundary.
- Use tenant-bound stores and RLS proofs for tenant data. Never route tenant
  queries through the control-plane pool.
- Use one checked-out client for a transaction. Domain writes and their audit
  evidence commit or roll back together.
- Do not change migration history in place. Add forward migrations and rerun the
  migration and restricted-role RLS proof suites.

### Identity and support

- WorkOS or Clerk may supply hosted identity per installation; application
  contracts remain provider-neutral.
- Managed support never becomes the tenant actor. Preserve the real operator,
  reason, support session, derived audit actor, visible banner, expiry, policy
  revocation, and sensitive-action denials.
- Never create provider resources or change hosted configuration without the
  exact scope recorded in `OWNER-TASKS.md`.

### Modules and sandboxing

- Modules receive signed, tenant-scoped OpenTenant context rather than control
  credentials. Keep package exports and Developer MCP entrypoints compatible.
- Remote execution remains admission-controlled, preview-bound, kill-switchable,
  and isolated. Owner approval is still required for the first callable
  Developer MCP route and production sandbox use.

### Product truth and marketing

- Product claims must be supported by committed behavior and current evidence.
- Keep production, provider, and genuine-data claims separate from local or
  synthetic verification.
- Record each task's marketing classification from `RTK.md`. Assessment visual
  and status-treatment changes are `content`; internal refactors are `none`.

## Local development

Use Node 22 and pnpm. Root quality verification intentionally runs lint,
typecheck, and tests in parallel without builds.

```sh
fnm exec --using=22 -- pnpm install --frozen-lockfile
fnm exec --using=22 -- pnpm check
fnm exec --using=22 -- pnpm build
git diff --check
graphify update .
graphify check-update .
```

Database-bound work additionally requires:

```sh
fnm exec --using=22 -- pnpm --filter @opentenant/migrations test
fnm exec --using=22 -- pnpm rls:proof
```

Attach each command to dedicated loopback `opentenant_it_` database URLs as
described by the relevant runbook or task packet. A run that skips its named
integration suite is not database evidence.

For Assessment or platform behavior, run the focused package tests first, then
the full gates. Use BrowserOS Neo in a named agent-owned tab for responsive,
keyboard and download checks, preserving the user's existing sessions. Use
`agent-browser` only when BrowserOS is unavailable or an isolated session is
explicitly needed, and close fallback sessions afterward. Browser success
against a local or preview environment is not production verification.

## Git and delivery

- Use one branch and pull request per backlog task. Merge dependencies before
  beginning their dependents.
- Preserve unrelated local changes. Stage only task-owned files.
- Before pushing, run the task's exact backlog verification, update Graphify,
  and ensure `git diff --check` is clean.
- Review hosted checks and unresolved conversations before merge. Do not deploy
  merely because a pull request merged.
- A production rollback is the relevant task-PR revert; these simplification
  tasks require no data rollback because they add no schema changes.

## Owner gates

The autonomous queue can be empty while owner decisions remain pending. The
four governed backlog gates are:

- `OWNER-SLACK-01` — development workspace/channel and synthetic probe scope.
- `OWNER-DEVELOPER-MCP-02` — exact first callable route and safety evidence.
- `OWNER-COMPLIANCE-01` — legal/system boundary, criteria, owners, evidence
  period, provider scope, and auditor posture.
- `OWNER-BILLING-01` — billable metrics, correction semantics, entitlements,
  commercial policy, and payment-provider scope.

Production enablement, genuine tenant data, public release, provider spending,
and destructive provider cleanup remain separate explicit approvals. Consult
`docs/OWNER-TASKS.md` for the full checklists rather than broadening these
summaries.

## Post-program follow-up

Do not change the README roadmap to “available now” in the simplification
program. That wording is eligible only after all five task PRs are merged and
an owner-authorized production deployment has passed smoke tests for tenant
resolution, administrator settings, managed support, Assessment completion,
and audit evidence. Record the deployment and exact evidence in SHIPLOG before
changing the public roadmap.

## Local custom-domain checkpoint, 2026-11-11

Custom-domain ownership verification and applied root CSS variables are locally
implemented. See [the runbook](runbooks/custom-domains.md) and
[proof record](reviews/2026-11-11-custom-domains.md). Apply control-plane migration
0048 before the code. Hosting is dry-run only, worker rechecks are not wired,
and all three domain/theming Playwright cases now pass in the shared harness. Sign-in and settings stay
on the tenant platform subdomain with host-only cookies; the owner's connection
callback topology decision remains open. No production claim or provider
operation is authorized by this checkpoint.

## Wave 2 worker and tenant lifecycle, 2026-11-11

The durable worker, owner bootstrap, local export and retention-based hard erase
are implemented in this branch. See [the runbook](runbooks/tenant-worker.md).
Migrations 0040-0044 deliberately leave a gap for other wave-2 agents. The
suspended-tenant 423 helper awaits shared-gate wiring by the orchestrator;
current APIs fail closed through their existing generic denials. Middleware,
settings-guard, credential cipher, domains and observability remain untouched.
No hosted operation, provider API proof, push or PR was performed.
