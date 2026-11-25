# OpenTenant changelog

This log tracks development snapshots and changes users can see. For test
results and implementation details, see the [ship log](docs/SHIPLOG.md).

## 2026-11-24 · Public source and local quick start

- Published a clean source snapshot on GitHub. The project is pre-1.0.
  Public packages and external contributions still have separate approvals.
- Updated the [quick start](README.md#run-it-locally) to launch the synthetic
  tenant and open Assessment with local identity and PostgreSQL.
- Added routes through the [documentation](docs/README.md) for trying the app,
  adding a module, and operating an installation.


## 2026-11-17: Audit filters

Platform administrators can filter the bounded audit log by tenant, exact action
and inclusive UTC dates, see an announced result count and clear the filters.

## 2026-11-14: Persistent local UAT

Added `pnpm uat:serve` for human and remote browser testing with synthetic
tenants, role personas, Mailpit and signal-driven cleanup. Added
`pnpm uat:down` for worktree-labeled orphan cleanup. Marketing impact: none.

## 2026-11-11: ECS wave 5 tooling

Environment lint now rejects process destructuring and imported process aliases.
Fresh RLS proof uses canonical provisioning exclusively. Turbo restores generated
SQL assets, and E2E listing succeeds without executing tests. A local registry
proof validates package publication and clean-container scaffold startup while
public npm release and provenance remain owner-gated.

## 2026-11-11: local wave-4 integration

Public libraries now build ESM/declarations and ship SQL assets, with Changesets
and an owner-gated release workflow. Installed module contributions drive the
host and shared runtime configuration. A packed third-party module installs
without core edits and has a CI proof for navigation, access and migrations.

The integrated checks pass, including all eleven browser cases, package checks,
disposable database proofs and local deployment smoke. Adopter links and a
synthetic backup/restore drill are automated. Optional real SMTP/microsandbox
proofs and public publication remain unperformed. See [the verification record](docs/reviews/2026-11-11-integration-wave4a.md).

## 2026-11-11: local wave-2 integration

Integrated durable tenant jobs and owner bootstrap with authorization and
isolation hardening. Usage export runs on the durable worker with a local file
sink by default. The obsolete Workflow build wrapper is removed. Shared
disposable database verification now covers the merged worker and usage jobs.
See [verification and remaining limits](docs/reviews/2026-11-11-integration-wave2.md).
Marketing impact: truth.

## 2026-11-11 — Module authorization adapters

Mapped module roles now cap elevated identity claims and require enabled tenant
entitlements. Built-in modules use this policy; unmapped third-party modules
retain a documented legacy path. Optional OpenFGA relationship checks and sync
helpers have local container coverage. Lifecycle wiring and production
activation remain integration work. See [authorization](docs/architecture/authorization.md).
## 2026-11-11 — Sandbox adapters and usage export

- Added optional E2B and local microsandbox adapters with shared mocked
  conformance. Local microVM previews remain unsupported and the real microVM
  lifecycle proof has not run. Hosted execution remains owner-gated.
- Added OpenMeter CloudEvents export and private local JSON export from the
  immutable usage ledger, with durable delivery receipts and bounded retries.
  Worker scheduling is an integration step; billing remains owner-gated.

Marketing impact: truth.
## 2026-11-11 — Self-hosted identity adapter

- Added Better Auth as an optional email/password identity provider with tenant
  organization roles and host-bound sessions. SSO and SCIM are opt-in; external
  IdP proof and mail delivery require installation configuration. See the
  [adapter runbook](docs/architecture/better-auth-adapter.md).

## Unreleased

### Optional observability and mutation limits

- Added opt-in OTLP tracing and Sentry-protocol server error capture, plus
  content-free pino logging and generic error screens. Collectors remain optional.
- Added persistent PostgreSQL limits for settings, members, identity portals,
  brand proposals, support controls, passcode verification and the module proxy.
  Tenant-creation wiring and tenant-resolution spans remain merge-time steps
  for the agents owning those files.
- Documented proposed readiness, availability and latency objectives in the
  [SLO runbook](docs/runbooks/slo.md). These are operating targets, not production evidence.

### Security hardening

- Updated Next.js and vulnerable runtime dependencies in the platform and
  standalone module template.
- Restricted untrusted module response headers, redirects, caching and
  cross-origin mutations while retaining the opaque sandbox.
- Protected identity setup with owner authorization, kept member operations
  on their locked database client, and audited invitation attempts before issuance.
- Required separate production signing keys, blocked cross-origin framing,
  and disabled the development tenant selector in production.

### Restorable, policy-bound Assessments

**Why it matters:** Teams can resume a working Assessment without losing its
participants, evidence, progress, or current executive readout, while model use
stays inside the active tenant's policy.

- Added a restorable engagement backup alongside the existing report export.
  Invalid or wrong-tenant backups leave current work untouched.
- Restored current readouts appear without another model request. Changes that
  affect the result mark the saved readout stale until a person regenerates it.
- Kept demo work separate from saved engagements and preserved recoverable
  legacy data instead of silently assigning it to a tenant.

### Tenant brand import and review

**Why it matters:** Tenant administrators can start from an existing brand
document without giving an upload permission to change live branding by itself.

- Added bounded `brand.md` upload with visible source digest, parser version and
  locked-field rejection.
- Kept editing, review and apply as separate actions. Only policy-allowed values
  reach the tenant's active brand.
- Kept upload and supersede as separate tenant permissions. A denied replacement
  leaves the current draft and its audit history unchanged.

### Clearer Assessment workflow

**Why it matters:** Assessment participants can see how much of the
questionnaire is complete, move cleanly between respondent and score views, and
download the right output without sorting through repeated controls.

- Added visible completion progress and responsive questionnaire navigation
  while preserving scoring, evidence, demo data, respondent editing,
  consolidation, AI readout, and sign-out.
- Presented the respondent roster and score matrix as keyboard-navigable tabs,
  retained one demo banner, and removed duplicate demo status treatment.
- Consolidated exports into one PDF action and one CSV/JSON menu; all three
  continue to produce downloadable files.

### Shared request context and control-plane connections

**Why it matters:** Server-rendered identity and tenant reads are deduplicated
within their render scope, while reusable control-plane work shares one small,
observable database pool instead of opening competing pools throughout the
platform.

- Centralized reusable control-plane access behind one bounded pool and added
  a same-client transaction helper with rollback and broken-client handling.
- Kept tenant-isolated RLS connections, provisioning's one-shot tenant pool,
  and workflow heartbeat connections physically separate.
- Preserved route authorization, audit atomicity, package APIs, permissions,
  and database schemas.

### Distinct monorepo quality checks

**Why it matters:** Contributors now get independent lint, typecheck, and test
feedback without rebuilding packages or running TypeScript twice under two
different task names.

- Replaced all 21 workspace lint commands that only repeated compiler or syntax
  checks with one root ESLint flat configuration, non-type-aware TypeScript
  recommendations, React Hooks rules, and Next.js Core Web Vitals coverage for
  both Next.js workspaces.
- Kept one explicit TypeScript check per workspace and removed upstream build
  dependencies from typecheck and test, reducing the quality graph from 76
  scheduled tasks to 63 with no builds.
- Added a deterministic assertion that guards the 21 lint, 21 typecheck, and 21
  test contract.

### Shared PostgreSQL admission control

**Why it matters:** Limits and idempotent retries now agree across application
processes instead of resetting inside each route instance.

- Added transactional fixed-window, concurrency-lease, expiry, release, size,
  and idempotency enforcement with tenant- and scope-bound policy snapshots.
- Replaced process-local assessment-readout, telemetry, and module-access
  counters with one shared PostgreSQL adapter bound to trusted server context.
- Added a deny-network local PostgreSQL proof that executes exact named
  concurrency and replay tests with a restricted role and zero skipped tests.
- Idempotency replays no longer execute route side effects; malformed caller
  keys remain input errors, passcode evidence uses a server-keyed HMAC, every
  acquired lease is released, and streamed provider work stops at lease expiry.

### Append-only exact usage evidence

**Why it matters:** OpenTenant can retain exact, replay-safe operational usage
evidence without coupling it to authorization limits or prematurely choosing a
commercial model.

- Added server-owned metric definitions and immutable tenant-scoped usage
  events with explicit occurrence/recording time, source, fingerprint, and
  idempotency evidence.
- Same-key races commit one event, and replay requires an exact match across
  metric, quantity, occurrence time, source, fingerprint, and correction
  identity. Distinct keys remain distinct, and corrections append linked signed
  deltas rather than mutating history.
- An additive migration keeps the original migration checksum stable while
  requiring corrections to remain at the original occurrence timestamp;
  bounded half-open
  tenant/metric aggregation includes them exactly once. No price,
  plan, entitlement, invoice, checkout, webhook, or payment-provider behavior
  was added.

### Governed autonomous backlog closure

- All 37 non-owner tasks in the 43-task backlog are controller-verified,
  including the final admission replay/lease and exact-usage replay/correction
  hardening. The autonomous controller queue is empty.
- The four owner-controlled entries remain explicit gates for a Slack probe, first
  callable Developer MCP route, SOC 2/Vanta scope, and commercial billing
  policy. Production and genuine-data approvals remain separate.

### Immutable tenant voice profiles

**Why it matters:** Each tenant can retain a current validated voice profile
and its exact history without letting later edits or revocation erase the
evidence.

- Structured profiles are canonicalized and validated before publication;
  contradictory word lists and unsafe or ineffective rewrites are refused.
- Publication uses an explicit revision check, allocates immutable monotonic
  versions, and records one tenant-scoped audit event atomically.
- Revocation clears only the current pointer and appends evidence; the cited
  profile version remains immutable and readable in tenant-scoped history.
- This storage slice adds no prompt, model-router, provider, generation, or
  customer-facing conditioning path.

### Review-invalidating brand proposal edits

**Why it matters:** Tenant operators can correct a proposed brand value without
losing the evidence of where it came from or accidentally applying a value that
was reviewed before the correction.

- The exact tenant-bound edit permission exposes edits for draft and reviewed
  proposals while applied and superseded proposals remain immutable.
- Editing retains request, parser-version, and upload or website provenance,
  returns the proposal to draft, and requires a fresh review before apply.
- PostgreSQL freezes the proposed key/provenance envelope, rejects bypass and
  no-op review invalidation, and keeps discarded proposals immutable.
- Edit/apply races resolve to one atomic winner, and a reviewed edit that would
  create a second live draft returns an actionable conflict.

### Immutable brand parser versions

**Why it matters:** Every uploaded brand proposal now keeps the identity of the
deterministic parser that produced it, so later parser releases cannot silently
reinterpret or rewrite earlier proposals.

- A seeded insert-only parser registry accepts new distinct versions while
  preserving every existing version definition.
- Upload proposals require a known, immutable parser version; website-backed
  proposals retain an explicit no-parser value.
- Upload provenance remains digest-based and never fabricates a website URL.

### Tenant-bound brand proposal permissions

**Why it matters:** Brand proposal writes now follow the tenant administrator's
verified active tenant and exact operation grant instead of installation-wide
authority.

- Upload/request, review, apply, and discard/revoke each require their own
  permission; edit and supersede remain separate grants for their forthcoming
  transitions.
- Platform administration and managed support do not imply tenant brand-write
  access, and submitted cross-tenant identifiers fail before mutation.
- Installation-owner tenant creation now creates only the empty brand policy.
  A tenant owner or administrator with `brand.proposal.upload` starts or retries
  the separate website proposal after entering the tenant-bound workflow.
- Review and revoke retain actor, tenant, and reason evidence through the shared
  transactional store; apply keeps one canonical audit event.

### Transactional reviewed-brand apply

**Why it matters:** Installation owners can now see policy-locked brand values
before confirmation and apply the remaining reviewed values without overwriting
a newer manual policy change.

- Review pins the active brand-policy version; apply locks the proposal and
  policy, merges only unlocked values into overrides, increments the policy
  version once, terminalizes the proposal, and appends actor, reason, and
  resulting-version audit evidence in one transaction.
- PostgreSQL now explicitly rejects reviewed or applied proposals whose
  reviewed policy-version pin is null.
- Concurrent or stale apply attempts fail closed. Uploaded and website-derived
  provenance remain visible beside each proposed value.

### Reviewed, tenant-scoped support suggestions

**Why it matters:** Support teams can now evaluate grounded AI assistance
without allowing a model to send replies, resolve tickets, publish knowledge,
cross tenant boundaries, or interrupt deterministic support work.

- Added review-only category, priority, and reply-draft contracts with exact
  retrieved-span citations and content-free inference evidence.
- Added provenance-backed, redaction-reviewed installation-shared and
  tenant-private knowledge with explicit human publication and two-person
  private-to-shared promotion.
- Added deterministic offline gates for privacy, injection, tenant denial,
  review, failure behavior, citation containment, evaluation strata, and paired
  regressions. The slice uses a synthetic adapter and makes no provider call.

### Provider-neutral model routing contracts

**Why it matters:** Model choice can now be configured per tenant, module, and
use case without allowing module code to choose residency, bypass retention
policy, or receive provider credentials.

- Added primary and secondary model slots resolved through explicit tenant,
  installation, and platform scopes under a versioned owner allowlist.
- Added fail-closed residency and retention filters, pair-specific revocable
  cross-border consent, and complete content-free resolution attribution.
- Added encrypted tenant-first and installation-fallback credential brokerage
  behind a synthetic no-network adapter boundary. No live provider or genuine
  tenant data is used by this slice.

### Bounded compliance evidence export contracts

**Why it matters:** Future compliance programmes can consume locally verified,
tenant-safe evidence packages without turning compliance tooling into a source
of truth or continuously exporting tenant content.

- Added explicitly authorised exports with fixed time and record bounds,
  allowlisted resources and fields, omitted-field redaction metadata, and
  offline-verifiable SHA-256 manifests.
- Added immutable, consent-bound scope versions for one exact tenant or an
  installation-owner aggregate with a frozen tenant allowlist. New tenants and
  fields never enter an existing scope automatically.
- Added a no-network synthetic adapter covering one-way revocation,
  cross-tenant denial, idempotency conflicts, and checkpoint reconciliation.
  This slice makes no provider call and makes no compliance or audit-readiness
  claim.

### Provider-independent Slack app contracts

**Why it matters:** Interactive support actions now have a locally proven
tenant and authority boundary before any Slack app, OAuth exchange, workspace,
or provider credential is introduced.

- Added installation-and-tenant-bound workspace connections, channels, ticket
  threads, and identity mappings with composite persistence constraints and
  forced row-level security.
- Added synthetic signed acknowledge, assign, and resolve actions that reject
  stale ticket versions, replay, scope substitution, inactive mappings, and
  revoked authority. Every action reloads canonical ticket state and current
  operation-specific permission before mutation.
- No OAuth exchange, Slack SDK, provider credential, external call, or genuine
  tenant data is used by this slice.

### Tenant-safe support depth contracts

**Why it matters:** Support can now model deterministic notification recovery,
attachment access, SLA state, satisfaction feedback, and operational metrics
without exposing provider addresses, object URLs, ticket content, or another
tenant's state.

- Added canonical tenant-bound in-app/email preferences and append-only
  delivery attempts bound to canonical outbox versions, with opaque destination
  references, deterministic idempotency, normalised failure classes, and a
  three-attempt transient-recovery budget.
- Added bounded attachment metadata, deterministic SLA policy/state,
  pause-aware clocks, requester-owned one-time CSAT, and content-free
  per-tenant analytics behind explicit requester, tenant-admin, owner, and
  exact active managed-support checks. Storage object references stay behind
  the attachment service boundary.
- Added forced-RLS tenant tables and an append-only content-free evidence
  ledger. No email provider, object store, external endpoint, credential, or
  genuine tenant data is used by this slice.

### Local Slack delivery contracts

**Why it matters:** Support notifications now have a locally proven,
tenant-safe one-way delivery boundary before any Slack workspace or provider
credential is used.

- Added minimal escaped Slack messages built only from allowlisted ticket
  metadata, with accessible fallback text, safe HTTPS links, and unfurls off.
- Added tenant-bound encrypted webhook custody, idempotent queueing, bounded
  retries, content-free health/permanent-failure visibility, and a clearly
  labelled synthetic manual test.
- Delivery operates on copied outbox metadata and cannot mutate the canonical
  ticket. This slice makes no Slack provider call and does not add OAuth,
  channel selection, threading, or interactive actions.

### Owner and tenant helpdesk experience

**Why it matters:** Installation owners can work content-free cross-tenant
queues without trusting projection rows as ticket authority, while requesters
and tenant support staff receive separate, permission-shaped workflows.

- Added accessible All, Unassigned, Mine, Escalated, and priority-risk owner
  queue views with tenant, status, priority, assignment, reference search, and
  projection delivery-health visibility.
- Owner detail opens now treat projected tenant IDs and ticket references as
  navigation hints: the sensitive customer-data-read installation permission
  and an active managed-support session bound to the exact tenant are rechecked
  before content is loaded by reference from that tenant's canonical database.
  Queue-discovery authority alone never unlocks ticket content, and an access
  evidence write must succeed before content is returned.
- Added a persistent tenant-branded **Get help** entry and permission-shaped
  requester/tenant-queue views. Create, own read/reply, tenant read/reply,
  internal notes, assignment, and operational management remain independent.
- Ticket pages expose status, assignment, priority, public/internal
  conversation, history, and content-free permanent delivery failures with
  semantic headings, descriptions, tables, and labelled controls.
- Actual SLA clocks, attachments, CSAT, analytics, and provider delivery remain
  in later slices; the current SLA-risk queue is explicitly a priority-risk
  view.

### Helpdesk core and owner projection

**Why it matters:** Every support-ticket change now commits with a canonical
version and a same-transaction outbox event, so an installation owner's
helpdesk queue can be served from one minimal, rebuildable control-plane index
instead of querying every tenant database, without ticket content ever
leaving the tenant data plane.

- Added a canonical monotonic `version` to tenant tickets; PostgreSQL rejects
  any update that does not advance it by exactly one.
- Added a tenant transactional outbox: every ticket mutation appends one
  queue-metadata envelope at the new version in the same transaction, with
  append-only identity/payload, claim/retry with `for update skip locked`,
  bounded retries, explicit dead-letter states, and a structural CHECK that
  denies subject, body, message, and attachment keys.
- Added a control-plane owner projection keyed by tenant and ticket number
  that applies events idempotently and monotonically (an older event can
  never replace a newer row), carries per-tenant checkpoint and lag/health
  state, supports tombstones for disablement/retention, and can always be
  rebuilt from canonical tenant state. It has no content columns by design
  and is never ticket authority.
- Replaced the coarse `support.use`/`support.admin` grants with the approved
  requester and tenant-staff permission vocabulary
  (`support.ticket.create/read_own/reply_own/read_tenant/reply/note_internal/assign/manage`);
  the legacy aliases still expand fail-closed. Added
  `owner.helpdesk.queue.read` for the minimal owner queue discovery seam;
  detail opens and mutations still re-resolve and reauthorize the exact
  tenant.
- Tombstoning a tenant's projection and rebuilding it append hash-chained
  audit evidence in the same transaction.
- Excluded by design in this slice: Slack or email delivery calls,
  attachments, SLA/CSAT, AI, a polished helpdesk UI, and any widening of the
  OPS-05 content-minimized broker summary.

### Production dependency audit restored

**Why it matters:** The production dependency graphs of the platform monorepo
and the copyable tenant starter again contain no known high-severity
advisories, and CI's high-severity audit gate can pass without exceptions.

- Updated Next.js to 15.5.21 within the supported 15.x line, resolving one App
  Router denial-of-service advisory (GHSA-m99w-x7hq-7vfj) and two server-side
  request forgery advisories (GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4).
- Raised the workspace `postcss` override to 8.5.18 for the source-map path
  traversal advisory (GHSA-r28c-9q8g-f849) in both dependency graphs.
- Added a workspace `brace-expansion` override at 5.0.8 for the unbounded
  expansion denial-of-service advisory (GHSA-mh99-v99m-4gvg).
- No major-version upgrades were bundled; frozen installs, the supply-chain
  build policy, the pinned `sharp` runtime, and the reviewed licence closure
  are unchanged.

### Brokered module capabilities

**Why it matters:** A remote module can now perform one useful tenant-data read
without receiving a database connection string, provider credential, arbitrary
query surface, or customer ticket content.

- Added an initial closed capability, `support.ticket.read`, whose effective
  authority is the intersection of the immutable module-version declaration,
  creator ceiling, exact tenant/version grant, active entitlement, and current
  user's module-scoped permission.
- Added immutable declaration and append-only grant history in PostgreSQL.
  Declarations must be committed before their module version, capability
  expansion requires a new version, and grants can expire or be revoked but
  cannot be silently reactivated or rewritten.
- Added a strict bearer-authenticated remote-module broker that returns at most
  25 support ticket metadata summaries. It never accepts caller-selected SQL,
  tenant IDs, fields, filters, capabilities, or limits.
- Bound signed remote-module context to the immutable module version and
  hardened its tenant, identity, permissions, brand, timestamp, and expiry
  shape before broker authorization.
- Added content-free, hash-chained grant, use, denial, error, and revocation
  evidence with correlation IDs; provider and SQL errors remain generic.
- This is not broad database access, a grant-management UI, a service-grant
  system, a Developer MCP tool, or a module publication/deployment workflow.

### Immutable module ownership and promotion boundary

**Why it matters:** A tenant can build a private module without risking an
accidental cross-client share, while an installation owner can create a
separately reviewed shared copy without rewriting the tenant's original.

Changed:

- Added closed platform, installation-owner, and tenant-private ownership
  scopes. Tenant-created records are private by construction.
- Bound every tenant entitlement to an explicit immutable artifact version;
  PostgreSQL rejects cross-tenant private assignments and ownership changes.
- Added an insert-only promotion store that requires installation publication
  authority, an exact reviewed source digest, a new module identity, version,
  and digest, attributable creator/reviewer/publisher provenance, and atomic
  audit evidence.
- Made remote module delivery deny-by-default: destinations must use standard
  HTTPS on an exact operator allowlist, decoded paths cannot replace the
  approved origin, and platform credentials or arbitrary inbound headers are
  never forwarded with the signed module context.
- Kept publication local and provider-neutral. There is no public promotion UI,
  marketplace, deployment call, or successful Developer MCP publication route.

### Production dependency audit gate

**Why it matters:** Pull requests now fail before build when production
dependencies contain a known high-severity vulnerability, and the current
transitive image-processing advisory is removed from the installation graph.

Changed:

- Overrode Next 15's vulnerable optional `sharp` 0.34 line with Apache-2.0
  `sharp` 0.35.3, which includes the patched libvips release for
  `GHSA-f88m-g3jw-g9cj`.
- Added a production-only, high-severity `pnpm audit` gate to CI.
- Added matching sharp and PostCSS overrides, a frozen lockfile, audit
  instruction, and libvips notice to the copyable Apache tenant-module starter.
- Verified the resolved native module by encoding and reading a PNG in memory,
  in addition to monorepo and isolated-starter production builds.

### Tenant onboarding and empty-brand path

**Why it matters:** Installation owners can create a tenant without inventing
brand values, while an optional website starts a separate review workflow
instead of silently changing the live tenant brand.

Changed:

- Replaced the required CSS-brand choice with an optional HTTPS website field.
- Initialized new tenant brand policies with empty defaults and overrides.
- Added independently recoverable pending seed requests, owner-visible proposal
  request/retry controls, and auditable tenant-bound review/discard actions. A
  failed optional enqueue cannot undo tenant creation or delete its identity
  organisation, and discard atomically cancels queued work.
- Kept proposals inactive and enforced per-value source URL and retrieval-time
  provenance in both the application contract and PostgreSQL constraints.
- Completed the slice through the unattended controller after the full
  repository checks and sandboxed production build passed.

### Managed-support context

**Why it matters:** Installation operators can perform approved routine tenant
configuration without impersonating a tenant user or receiving ambient access
to customer data and high-impact actions.

Changed:

- Added tenant-managed support policy and short-lived, revocable, opaque
  support sessions that preserve the real operator, reason, tenant, timestamps,
  generated installation identity, and optional change reference.
- Added visible owner-console policy controls, a tenant-host reason form,
  persistent support banner, and explicit session exit.
- Allowed policy-approved routine branding and non-sensitive module/navigation
  configuration through the existing audited settings paths. Domain labels and
  notes update real domain records; integration labels and health notes update
  real connection records without touching routing, scopes, status, or tokens.
- Kept customer data, exports, credentials, deletion, billing, identity,
  module access modes and passcodes, production-domain activation, broader
  module grants, and integration authorization behind separate fail-closed
  authority.
- Completed the slice through the unattended controller and merged it in pull
  request #15 after the repository check and live RLS proof passed.

### Installation-owner permission seam

**Why it matters:** Installation-wide tenant operations now have an explicit
authority boundary instead of relying directly on tenant roles or provider
role names.

Changed:

- Added provider-neutral installation-owner authority and permission contracts.
- Preserved existing platform-administrator tenant creation through one narrow
  compatibility mapping.
- Routed tenant creation through the explicit `owner.tenant.create` check and
  attributed its audit evidence to the installation owner.
- Added denial coverage proving tenant membership, tenant permission strings,
  unknown permissions, and ambiguous runtime values cannot grant installation
  authority.
- Completed the first unattended backlog slice through an independent
  controller checkpoint, full verification, and completion commit; managed
  support is the next dependency-ordered slice.

### Safe unattended development pipeline

**Why it matters:** OpenTenant can now continue approved local work from a
durable queue instead of relying on one long chat or silently stopping when an
independent product slice remains.

Changed:

- Researched ten high-adoption agent-development projects and adopted their
  strongest compatible patterns without copying or installing their code.
- Added a versioned, dependency-aware backlog seeded from the approved
  multi-tenant operations delivery sequence; owner-only decisions remain
  visible but are never selected.
- Added a Node 22 runner with clean-worktree, `codex/` branch, no-`.env`,
  Graphify, tool-version, path-scope, timeout, run-lock, checkpoint, and
  deterministic verification gates.
- Made sanitized child execution portable across local macOS and GitHub's
  Linux runners by preserving the active Node runtime and resolving Git from
  the current toolchain instead of fixed platform paths.
- Kept execution local and bounded. The runner cannot push, merge, deploy,
  publish, call provider APIs, read secrets, or use genuine tenant data.
- Deferred GitHub-hosted agent writes until protected branches/rulesets and a
  reviewed read-only-agent/safe-output design are available.

### Tenant module UI starter and separate marketing surface

**Why it matters:** Tenant developers now have a permissively licensed,
shadcn-ready screen baseline without importing OpenTenant core code or licensed
marketing assets into their module.

Changed:

- Added an Apache-2.0 Next.js tenant-module starter with Tailwind v4, semantic
  brand tokens, reviewed shadcn/ui primitives, tests, and a production build.
- Kept the starter on the official public shadcn registry and documented
  registry, dependency, sandbox, data-capability, and publication guardrails.
- Excluded Studio credentials and licensed resources from the OpenTenant
  release and tenant-facing builder in accordance with the current Studio
  licence terms.

### shadcn/ui monorepo tooling

**Why it matters:** Maintainers can now use the official shadcn/ui CLI to add or
inspect components without manually reconstructing the repository's shared
design-system paths.

Changed:

- Added application and design-system `components.json` files for Tailwind v4,
  React Server Components, Radix Nova, Lucide icons, and CSS-variable theming.
- Added stable package exports and application aliases so shared components are
  routed to the design-system workspace while app-specific blocks remain local.
- Documented safe CLI usage that preserves OpenTenant's customised components
  and avoids committing private-registry credentials.

### Approved multi-tenant operations direction

**Why it matters:** Agencies, SaaS teams, and enterprise platform teams now have
a coherent target for managing multiple differently branded tenants without
weakening the reusable template's tenant and provider boundaries.

Designed:

- One installation owner operates one console and creates tenants directly;
  tenants do not register with a second agency application.
- Managed-support sessions retain the real operator and permit routine
  configuration while separating customer data, credentials, exports,
  deletion, billing, and identity changes.
- Module ownership is explicit: OpenTenant platform, installation-owner shared,
  or tenant private. Tenant-private modules cannot silently become shared.
- Module data access uses explicit brokered capabilities, including a visible
  path for justified broad tenant access without raw database credentials.
- Support becomes an optional first-party tenant module and owner-wide Helpdesk
  with a minimal rebuildable ticket projection, asynchronous notifications, and
  staged Slack webhook/OAuth integration.
- SOC 2 evidence and installation- or tenant-scoped Vanta adapters are planned
  without claiming current compliance or production readiness.

This is an accepted design, not a delivered capability. See
[multi-tenant operations](docs/architecture/multi-tenant-operations.md).

### Human-readable product documentation

**Why it matters:** New readers can now understand what OpenTenant is, what is
usable today, how provider choices fit together, and what is still blocked
without reconstructing the product from implementation plans.

Changed:

- Reframed the README around user outcomes, platform maturity, provider choices,
  local setup, and production limits.
- Expanded the README into a project landing page with the OpenTenant mark,
  build/toolchain/licence badges, a provider-aware architecture diagram,
  example-module and repository maps, security principles, verified proof
  points, and an honest now/next/later roadmap.
- Added a platform-capabilities guide with consistent status labels and clear
  separation between implemented behavior, development-only provider evidence,
  foundations, examples, and owner-gated work.
- Clarified that one hosted installation selects WorkOS or Clerk, while Vercel
  and Neon remain the current hosted stack behind provider boundaries.
- Documented Supabase and other providers as possible future adapters, not
  current support.
- Separated this human-readable iteration history from the detailed engineering
  ship log.
- Replaced dated or generator-specific public documentation URLs with stable,
  topic-based paths for the architecture and Developer MCP requirements.
- Hardened the GitHub repository with template metadata, dependency alerts and
  updates, curated Actions, automatic branch cleanup, contribution signoff,
  dependency update automation, and a security-focused pull-request template.

## 2026-07-20 — Iteration 4: integrity and recovery closure

**Why it matters:** Ambiguous infrastructure outcomes and historical data now
produce honest, recoverable states instead of false success, false failure, or
destructive compensation.

Changed:

- Tenant creation and activation reconcile lost commit acknowledgements against
  exact audit and row evidence before deciding what happened.
- Provisioning validates regions and brand keys before privileged provider
  work, and activation commits state plus audit evidence atomically.
- Tenant databases use one canonical, checksum-tracked migration catalog with
  safe exact-schema baselining and a single tenant identity anchor.
- Audit verification distinguishes canonical, legacy-but-valid, empty, and
  unverified history without rewriting historical hashes.
- The assessment's streamed model readout moved to the Node.js runtime and now
  normalizes provider and network failures.

Verified:

- 520 automated tests passed.
- A fresh PostgreSQL 17 run passed 183 isolation and immutability checks across
  all 18 tenant-scoped tables.
- The production build completed without warnings, and GitHub CI passed the
  full check and RLS-proof jobs.

## 2026-07-20 — Iteration 3: complete identity choice

**Why it matters:** Template adopters can choose the identity provider that
fits their deployment without changing OpenTenant's tenant, membership, or
authorization model.

Changed:

- Added Clerk as a complete per-deployment alternative to WorkOS for browser
  identity, organization lifecycle, invitations, memberships, roles,
  permissions, tenant switching, and sign-out.
- Preserved the local single-user identity adapter for development.
- Moved organization provisioning and member administration behind neutral
  ports so platform routes no longer depend on provider SDKs or identifiers.
- Added native Clerk controls and middleware while retaining WorkOS and local
  behavior.
- Added provider-bound persistence and fail-closed checks for ambiguous,
  inactive, cross-tenant, or unknown-role states.

Verified:

- Local, WorkOS, and Clerk runtime smoke checks passed.
- A development-only WorkOS flow proved hosted login, sealed session, exact
  tenant membership, and synthetic cleanup.
- Clerk's signed-out controls and hosted sign-in surface were browser-verified;
  the complete synthetic organization/member flow remains owner-gated by the
  final custom-role permission decision.

## 2026-07-20 — Iteration 2: hosted-stack evidence and governance

**Why it matters:** The intended stack is explicit and tested at its dangerous
boundaries, while the reusable template remains free of account-specific
configuration.

Changed:

- Selected Vercel for hosted application and sandbox execution, Neon PostgreSQL
  for hosted data planes, and WorkOS or Clerk for hosted identity.
- Added a bounded Vercel Sandbox adapter seam and a development-only REST probe
  that created, exercised, stopped, and cleaned up an ephemeral sandbox.
- Proved the real Neon tenant-provisioning path in a temporary US development
  project, including verified TLS, migrations, least privilege, forced RLS,
  exact tenant context, and cleanup.
- Added an optional Vercel operator MCP runbook for human-confirmed diagnostics.
  This integration does not replace the tenant-bound Developer MCP.
- Added a repository knowledge graph, durable handoff, owner-task ledger, and
  evidence-oriented ship log.
- Adopted the split licence model and completed the current technical licence
  and provenance review.

Still gated:

- Production provider accounts, domains, data regions, retention, restore,
  spend, and incident-response approval.
- Production Vercel Sandbox isolation and authenticated-preview approval.
- Public release and external contributions.

## 2026-07-19 — Iteration 1: reusable platform baseline

**Why it matters:** OpenTenant became a coherent multi-tenant platform rather
than a collection of application-specific features.

Added:

- A Next.js tenant shell with trusted host resolution, branding, navigation,
  module entitlements, tenant administration, and generic not-found behavior.
- Provider-neutral identity, database, provisioning, module, credential, audit,
  observability, and sandbox contracts.
- Control-plane and tenant-plane PostgreSQL migrations, encrypted connection
  records, forced row-level security, and resumable provisioning checkpoints.
- Native assessment, knowledge, and support example modules.
- A remote-module contract using short-lived, module-bound signed context.
- A denial-first Developer MCP design and isolated sandbox lifecycle proof for
  tenant-created modules.
- Local-first Docker PostgreSQL, synthetic seed data, and local identity so the
  platform can run without cloud accounts.

Not included in the baseline:

- A successful Developer MCP tool route.
- Automatic module publication or infrastructure changes.
- Production approval or use of genuine tenant data.
