# OpenTenant implementation program

Date: 2026-09-06. Baseline: `43b629f8b4cd08cd83e569002adaba34f5f8f097`.
Status: all 15 local tasks have implementation or accepted design evidence.
M1, corrected M2, M3 and GFinal are accepted. No push, merge, provider
activation or deployment is part of this status.

## Objective

Bring the implemented platform into line with its accepted contracts, finish the
missing brand and Assessment journeys, and prepare the next gated product work.
The [review](2026-09-06-code-review.md) is the evidence for this sequence.

The current request authorizes review and planning documents. It does not start
the implementation queue, expose Developer MCP, activate providers, deploy, push
or merge. An instruction to execute this program would authorize its local
implementation tasks; provider and production gates retain their exact scope.

## Model assignments

| Model and effort | Responsibility |
| --- | --- |
| `gpt-6-astra`, `high` | Approve architecture and task contracts; independently review milestone outcomes and the final integrated revision |
| `gpt-5.6-sol`, `high` | Implement authorization, cross-package contracts, database composition, policy and migration-sensitive work |
| `gpt-5.6-luna`, `high` | Implement bounded module fixes, typed projections, UI work and documentation after shared contracts are settled |
| Coordinating agent | Verify findings, own integration/shared files, collect evidence, enforce dependencies and report remaining work |

These are orchestration assignments, not application model selections. Do not add
them to tenant model allowlists or assume `pnpm unattended:run` will select them.
The current runner disables nested multi-agent execution and has no explicit
three-model routing contract. Start with supervised delegation through the host's
subagent interface. Any future controller change needs its own reviewed task.

## Milestones

| Gate | Tasks | Required outcome | Astra decision |
| --- | --- | --- | --- |
| G0, contract review | `OT-P01` plus task packet review | Current requirements ledger, approved scope, dependencies, ownership and evidence rules | Accept the bounded program before code implementation |
| M1, correctness and release checks | `OT-R01` through `OT-R06` | Assessment access and editing corrected; telemetry canonical; production fallback closed; both audits pass; database store checks run in CI | Review source, emitted evidence and unskipped store results |
| M2, accepted user journeys | `OT-I01` through `OT-I05` | Policy-bound Assessment inference, actual brand upload/review/apply, restorable Assessment state | Review composed behavior and browser acceptance against the candidate revision |
| M3, next product contracts | `OT-D01` through `OT-D03` | Current MCP launch checklist, review-only support design, Lab persistence design | Accept or return each design independently; no automatic capability activation |
| GFinal, integration | All earlier gates and evidence reconciliation | Every task closed with evidence, or explicitly recorded as blocked/deferred with its owner and dependency | Issue final code/program review; do not infer release permission |

M1 is the highest priority. M2 addresses accepted capabilities whose separate
libraries and screens do not yet form the promised workflow. M3 deliberately
produces implementation-ready designs for larger work whose policy is still
incomplete. It must not be reported as delivery of those product capabilities.

## Execution status

| Gate | Local status | Evidence |
| --- | --- | --- |
| G0 | Accepted | `docs/reviews/2026-09-06-ot-p01.md` |
| M1 | Accepted | `docs/reviews/2026-09-06-m1.md` |
| M2 | Accepted after the GFinal authorization correction | `docs/reviews/2026-09-06-m2.md` |
| M3 | Accepted | `docs/reviews/2026-09-06-m3.md` |
| GFinal | Accepted at `cba0632` | `docs/reviews/2026-09-06-final.md` |

The controller contains all executable G0, M1 and M2 work and reports no next
task. M3 produces design packets only, so `OT-D01` through `OT-D03` remain in
their reviewed documents rather than being registered as shipped code tasks.

## Dependency and concurrency rules

1. Complete G0 before assigning code work. Do not repeat SIMPLIFY-01 through
   SIMPLIFY-05 or reopen completed backlog items without a specific new defect.
2. In M1, Sol owns `OT-R01`, `OT-R04`, `OT-R05` and `OT-R06`. Luna owns `OT-R02`
   and `OT-R03`. Assign one packet at a time to each worker.
3. `OT-R05` owns both lockfiles and dependency manifests. Complete it before
   `OT-R06`, which owns CI. Other workers must not regenerate lockfiles.
4. `OT-R01` precedes `OT-I02`. `OT-R03` precedes `OT-I05`. `OT-R06` precedes
   database-bearing M2 verification. `OT-I01` precedes `OT-I02`; `OT-I03`
   precedes `OT-I04`.
5. M2 has two independent streams after M1. Sol builds model policy/store and
   inference composition, then brand upload persistence. Luna can work on
   Assessment persistence after Sol/Astra settle its conversion contract, then
   brand UI after the upload API lands. Serialize any overlapping files.
6. Merge a task dependency before starting its dependent, as required by the
   repository. If merge authority is unavailable, preserve the task branch and
   report that dependency as waiting; continue only independent tasks.
7. Use the canonical checkout for ordinary work. Use ignored named worktrees
   only when parallel writers require isolation. The coordinator alone updates
   shared HANDOFF, SHIPLOG, OWNER-TASKS, backlog and generated graph files.

## Acceptance evidence

Each task record contains the requirement and finding IDs, base/candidate SHAs,
owned paths, actual model/effort, commands, exit codes, tests executed/skipped,
browser evidence where relevant, reviewer disposition and remaining gates.
Store new records under `docs/reviews/` when execution starts. Do not manufacture
completion timestamps or fill evidence with a promised test command.

Run focused checks first, then the task's repository gates under Node 22:

```sh
rtk proxy fnm exec --using=22 -- node --version
rtk proxy fnm exec --using=22 -- pnpm --version
rtk proxy fnm exec --using=22 -- pnpm check
rtk proxy fnm exec --using=22 -- pnpm turbo build --filter=@opentenant/platform
rtk git diff --check
```

At milestone and final review, force one fresh quality/build run to establish
current execution rather than replay old logs. No repeated full runs are needed
when no source changed and all relevant evidence remains valid.

Database tasks must use fresh local test databases with the repository's
`opentenant_it_` guards. Record actual execution counts and reject skipped named
suites. Run migrations and `pnpm rls:proof` against dedicated synthetic resources,
never a development application's or provider's database. The CI job added by
`OT-R06` becomes the repeatable store-verification contract.

For user journeys, use a named BrowserOS Neo tab, with agent-browser only as the
documented fallback. Check 375, 768 and 1440 pixel widths, keyboard navigation,
visible errors, data persistence and actual downloaded artifacts. Use synthetic
provider responses unless the exact live call is already authorized.

The README's `What's new` section is for end users. Include only visible product
capabilities and outcomes there. CI tuning, dependency maintenance, model
assignments, review gates and other engineering operations belong in the ship
log or task evidence, even when they are important release work.

Apply `repo-delivery` during `OT-R05` and `OT-R06`, which change dependency or
delivery behavior. Keep the resulting checks in this repository's delivery
contract. Apply unslop to all authored prose. Refresh Graphify after material
code or architecture-document changes without adding unapproved model/API work.

## Release and owner dependencies

| Outstanding dependency | Local work that can finish first | Action still requiring the owner's scope |
| --- | --- | --- |
| `OWNER-DEVELOPER-MCP-02` | `OT-D01` and later separately accepted local contract work | First callable route, exact tools and hosted execution |
| `OWNER-SLACK-01` | Existing adapter checks and content-free fixtures | Exact synthetic workspace/channel/provider probe |
| `OWNER-BILLING-01` | Existing usage evidence and defects found in it | Metrics, prices, corrections, entitlements and provider scope |
| `OWNER-COMPLIANCE-01` | Existing evidence export contracts | Program boundary, control owners, period and auditor posture |
| Model endpoints and policy | Synthetic M2 routing and cancellation proof | Real endpoint/account, retention/residency facts and paid probes |
| Production and genuine data | Local code, CI, browser checks, review and release packet | Exact deployment, identity/database configuration, restore, incident, domain and data scope |

The named owner gates are already in repository policy. This plan introduces no
new approval requirement for ordinary local repairs. The missing PostgreSQL
toolchain is a verification prerequisite, not a product decision. Record it as
an external blocker if it remains absent on the execution host.

## Completion rule

The program is complete only when the requested local implementation and design
outcomes above have acceptance evidence and a final Astra review. Record deferred
product phases separately: autonomous Support Agent repair/release, Lab Observe+
and Developer MCP publication are still unfinished product work. A successful
program review does not change their status or authorize production.
