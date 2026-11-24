# OpenTenant product and code review

Review date: 2026-09-06. Source revision: `43b629f8b4cd08cd83e569002adaba34f5f8f097`.

## Assessment

OpenTenant has a substantial local platform, with tenant routing, identity adapters,
tenant database boundaries, audited administration, support workflows and module
contracts. Its larger product roadmap remains unfinished. The empty autonomous
queue does not mean the original PRDs are complete.

The next program should repair the confirmed defects, finish a few accepted user
journeys, and prepare the remaining gated capabilities. Another broad architecture
refactor would repeat work that already landed in SIMPLIFY-01 through SIMPLIFY-05.

This is a source review and planning deliverable. It changes no application code,
backlog execution state, provider settings or production resources. Findings are
based on source inspection and the deterministic checks below. They are not
claims of demonstrated exploitation or live production behavior.

Start execution planning with [the milestone plan](2026-09-06-implementation-program.md),
then use [the task packets](2026-09-06-implementation-packets.md) and
[the agent instructions](2026-09-06-agent-review-contract.md).

## Baseline and verification

The canonical checkout began clean on `main`. Local HEAD, the cached `origin/main`
and a fresh `git ls-remote origin refs/heads/main` agreed on the revision above.
There was one worktree. Planning documents are on `codex/prd-review-plan-20260906`.

| Check | Result on this review |
| --- | --- |
| Node and package manager | Node 22 through `fnm exec --using=22`; pnpm 11.13.1 |
| `pnpm check --force --output-logs=errors-only` | 63 successful, 0 cached, 16.018 seconds |
| `pnpm turbo build --filter=@opentenant/platform --force --output-logs=errors-only` | Passed, 0 cached, 22.141 seconds |
| `pnpm unattended:status` | 48 tasks; no next task, supervised task or task awaiting verification |
| Backlog enumeration | 44 completed, 4 pending owner gates |
| Root production dependency audit | Failed; metadata reports 3 high and 2 moderate findings |
| Standalone tenant starter production audit | Failed; 1 high finding |
| Database execution and RLS | Not rerun. This host has no discovered PostgreSQL 17 binaries or Docker command. Default tests skip database integration suites without their dedicated URLs |
| Browser and hosted verification | Not performed. No application behavior, provider configuration or deployment was changed |
| Graph | Used for discovery; initial report described an older August 7 revision. AST refresh attempted and refused by the shrink guard; see below. Every finding was checked in source |

An initial check used the host's Node 26 and replayed all Turbo results. It is
excluded from the acceptance evidence. The forced Node 22 runs above replaced it.
Dependency audit counts are time-sensitive registry results, not proof that the
application exposes every dependency issue.

The required `graphify update .` attempt exited 1. It reported missing
`tree_sitter_sql` support for 38 SQL files and partial extraction of
`modules/support/src/support-ai.ts` and `support-depth.ts`. The candidate graph
had 5,299 nodes versus 5,460 in the existing graph; its guard refused replacement.
Tracked graph files remain unchanged. Repair the extraction prerequisites before
requiring a fresh graph as implementation evidence; do not force past the guard.
The independent quality-matrix assertion also passed with 21 tasks of each kind
and zero builds in the quality pipeline.

## Original intent and accepted revisions

The initial import is `036ddc6`, dated 2026-07-19. Its architecture was stored at
`docs/superpowers/specs/2026-07-15-opentenant-architecture-design.md`; its Developer
MCP PRD was `docs/product/2026-07-19-tenant-module-developer-mcp-prd.md`. Use
`git show 036ddc6:<path>` to read those original versions. Their current successors
are [platform architecture](../architecture/platform-architecture.md) and
[Developer MCP](../product/developer-mcp.md).

The original boundary was a provider-neutral multi-tenant platform, with native
examples and separately isolated tenant modules. It explicitly rejected ambient
provider authority, caller-established tenant identity and silent publication.
The current architecture preserves that boundary.

Later accepted documents narrow the implementation contract. The Developer MCP
authority freeze overrides earlier broad tool ambitions. The accepted Support AI
boundary permits reviewed suggestions; it does not establish the full autonomous
Support Agent. The August 3 brand/voice ruling leaves preferred words and style
fields inert. Plans must follow these decisions even when an older PRD summary
sounds broader.

| Requirement family | Current evidence | Remaining outcome |
| --- | --- | --- |
| Platform architecture sections 5-14 | `apps/platform/lib/`, `packages/auth`, `packages/database`, `packages/platform-core`; full local quality run passed | Repair the boundary defects below; obtain separate release evidence |
| Managed support and helpdesk | `modules/support`, `apps/platform/lib/helpdesk.ts`, tenant/owner pages and transactional stores | Broader browser acceptance coverage; hosted adapters remain subject to their gates |
| Assessment reference module | Split UI, scoring, respondent management, exports and optional readout exist | Preserve respondent data; connect actual persistence and model policies |
| Brand document PRD sections 4, 7 and 13 | Deterministic parser, provenance schema, proposal review/edit/apply and stores exist | The application still offers URL seeding, not the promised `brand.md` upload journey |
| Voice PRD sections 5 and 11 | Immutable profile validation/storage; Support AI banned-word refusal and profile pinning | Application composition and profile UI; preferred/style/example fields remain inert |
| Model-selection ADR | `ModelRouter`, credential-broker contract, SQL schema and synthetic tests | Persistent store/composition, administrative controls and migration of Assessment's direct provider path |
| Developer MCP FR-001, FR-002, FR-004, FR-014 | Protocol discovery/listing, authority profiles, per-call checks and atomic decision audit | Durable route composition and remaining launch evidence; descriptors are not executable handlers |
| Developer MCP FR-003 through FR-013 and FR-015 | Sandbox, template, preview and admission foundations | Complete workspace lifecycle, route integration and launch criteria. Publication and brokered capabilities remain separate later scope |
| Scoped Support AI, OPS-12 | `SupportAiService` returns `review_required`; local adapters and evaluation coverage | A persistent, authorized review-only application journey |
| Full AI Support Agent, phases P0-P4 | Accepted PRD; precursor support libraries | Not represented by completed OPS-12. Triage-only scope needs a settled phase boundary; later autonomous repair/release is deferred |
| Improvement Lab phase 0 | `packages/quality-contract` schemas, immutable digests and baseline evaluation; committed in `f2a8db9` | Durable module-version binding. Observe, Propose, Experiment and governed reuse remain deferred |
| Admission, activity, usage and launcher | Completed starter-inspired tasks and current source | Keep audit/usage evidence distinct from commercial billing |
| Production, compliance and billing | Runbooks and explicit owner gates | No current production or genuine-data approval established by this review |

The review checked the initial architecture and PRDs, current product documents,
accepted ADRs, backlog and representative implementations at the affected
boundaries. It is not an exhaustive audit of every source file or historical PR.

## Confirmed findings

P1 means repair before expanding the affected capability or declaring it ready.
P2 means a required correctness or integration improvement. None of these labels
asserts a current production incident.

### R1. Assessment API does not enforce module access, P1

`apps/platform/app/api/assessment-readout/route.ts:48` resolves a tenant and optional
session, then admits the request. It does not enforce identity/passcode access or
the enabled-module setting. `apps/platform/app/assessment/layout.tsx:23` enforces
identity/passcode access for the page, but also lacks an enabled-module check.
The root layout resolves branding and tenancy, not this missing authorization.

Put one explicit server-side Assessment access decision behind both callers.
Keep the passcode workflow working. The acceptance evidence must show that a
denied request performs no admission or provider work. See `OT-R01`.

### R2. Telemetry does not close its content or attribution boundary, P1

`packages/observability/src/index.ts:43` validates selected fields but returns the
original input at line 82. Additional top-level fields remain present.
`apps/platform/app/api/telemetry/route.ts:63` logs that object and retains its
caller-supplied tenant identifier, although the route resolved a trusted tenant.
The normal Assessment page-view sender supplies `tenantId: null`.

Construct a bounded canonical event, enforce an exact input field set, and bind
logged tenant identity to the server's context. Verify emitted records, not only
validator return codes. See `OT-R02`.

### R3. Editing a respondent loses notes and can duplicate the record, P1

`modules/assessment/src/assessment-shell.tsx:56` loads a saved respondent through
`loadScores`. `store.tsx:149` recreates the session from `emptySession`, clearing
evidence. Saving at lines 132-144 writes the cleared map back. It also derives
the respondent ID again from editable company, department and name fields;
changing those fields can insert a second record rather than update the first.

Preserve the original respondent ID and full editable state through an explicit
edit operation. Cover save, reload, rename and evidence preservation. See `OT-R03`.

### R4. Development tenant fallback lacks a production guard, P2 release blocker

`apps/platform/lib/tenant.ts:28` recognizes development hosts and configured
suffixes without checking the runtime mode. This contradicts architecture
section 7. Middleware's narrower local-host check does not cover every normalized
host accepted by this helper. Identity validation still checks the expected
tenant, so this finding does not establish an identity or RLS bypass.

Make production ignore all development overrides and defaults. Keep ordinary
verified-domain resolution unchanged. See `OT-R04`.

### R5. Dependency audit is currently red, P1 release blocker

The root audit reports affected `nanoid` 5.1.6 and 3.3.16 paths; the standalone
starter also contains 3.3.16. The registry reports fixes at 5.1.16 and 3.3.18 for
the broadest relevant advisories. Recheck that advice at implementation time.
See `GHSA-28wg-ghj8-5hjv`, `GHSA-2v37-7h3g-55p8` and `GHSA-xwg4-73v4-xw9w` in the
package audit. No vulnerable behavior was exercised.

Repair both dependency graphs, preserve compatible major versions, and run the
existing install, audit and build gates. See `OT-R05`.

### R6. Database store proofs are not part of normal CI, P2

`.github/workflows/ci.yml` runs migration integration tests with database URLs,
but its ordinary quality job supplies no URLs to `packages/database` integration
tests. In particular, the admission and usage store suites skip. The controller's
local PostgreSQL proof profiles cover these stores, but normal CI does not invoke
them. Migration success alone does not prove application store concurrency,
replay or aggregation behavior.

Add an explicit isolated database-store CI job that rejects skipped named suites.
Do not run schema-resetting suites concurrently against one database. See `OT-R06`.

### R7. Assessment model calls bypass the accepted routing policy, P2

`apps/platform/app/api/assessment-readout/route.ts:79` selects providers from
request/environment state and fetches with ambient keys. The accepted model ADR
includes Assessment, but `ModelRouter` is not composed into this path. Its current
`complete` method is non-streaming and its stores are interfaces/test doubles,
so a simple wrapper around `resolve()` would leave important work unfinished.

Add durable policy reads and evidence, a brokered streaming contract, then the
Assessment composition. Preserve cancellation and lease limits. See `OT-I01` and
`OT-I02`. Provider credentials do not prove residency or retention claims.

### R8. The promised brand upload has no application entry point, P2

`apps/platform/app/api/admin/brand-proposals/route.ts:57` accepts `sourceUrl` and
calls `queueBrandSeed`. The admin page at lines 83-105 offers an HTTPS URL form.
`parseBrandDocument` has no application caller. Existing provenance schema and proposal stores
and migration tests therefore do not prove the promised upload-to-review journey.
See `OT-I03` and `OT-I04`.

### R9. Assessment's documented persistence is disconnected, P2

The module README describes `AssessmentRepository`, but the live provider reads
and writes the two legacy keys directly. The repository's versioned document
uses another key and has no production caller. JSON export is a report object,
not a restorable engagement document.

Unify these paths with an explicit legacy migration and preserve existing data.
The current keys are shared within one browser origin. Normal tenant subdomains
have separate origins; same-origin development switching and shared-browser
sessions still need an explicit storage-scope policy. Do not claim a cross-origin
storage leak. See `OT-I05`.

## Documentation drift and deferred work

- `docs/CODEX-HANDOFF.md:103` calls Lab phase 0 uncommitted, although `f2a8db9`
  contains it.
- The August 4 state table in the Developer MCP route plan predates the final
  audit and admission work. Preserve its rejected-run lessons; replace current
  status claims with a dated ledger.
- `docs/product/ai-support-agent.md:774` says none of its dependencies are met.
  Several support foundations now exist. Later callable MCP, publication and
  hosted execution dependencies remain unresolved.
- The brand PRD's future-tense build order mixes completed library/store work
  with the still-missing upload UI. Neither blanket completion nor blanket
  deferral is accurate.
- `docs/HANDOFF.md` names `pnpm db:test`, but the root package has no such script.
  Its hard-coded Node path is absent on this host. Use the checked toolchain and
  explicit migration/RLS commands in future task evidence.

These corrections belong in `OT-P01`. Historical plans remain historical records;
the implementation backlog must not silently reinterpret them as ready tasks.

## Review disposition

Sol high reviewed product traceability. Luna high reviewed module correctness and
quality coverage. Astra high independently reviewed architecture and confirmed
R1, R2, R4 and R7. The primary reviewer checked findings against source.

The primary review corrected an initial claim that brand upload was complete.
The parser and stores exist; the application upload path does not. It also
narrowed the storage finding to same-origin behavior. Suggested helpdesk
read-before-audit reordering was not accepted as a defect: the current function
does not release detail when audit fails, and moving audit before a read would
change the meaning of the recorded event.

The final planning review and its disposition are recorded in the
[agent review contract](2026-09-06-agent-review-contract.md).
