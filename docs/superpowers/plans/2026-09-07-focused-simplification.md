# Focused simplification implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Use the host's explicit model selection for the assignments below. Steps use checkboxes for tracking.

**Goal:** Simplify local setup, Assessment state management, current-status documentation, and workspace quality verification while preserving existing capabilities and data.

**Architecture:** Local setup calls the canonical migration engine. Assessment keeps its public store interface while moving persistence and pure state transitions into focused internal files. Documentation links to current authority, and quality verification compares independently discovered workspace names with Turbo's task report.

**Tech stack:** Node 22, pnpm 11.13.1, TypeScript, React, PostgreSQL 17, Docker Compose, Turbo, Vitest, and Node's test runner.

Date: 2026-09-07. Inspected baseline: `edff47dc71288320d3e7344636965f8229af64b7`.
Status: planned. This document does not start implementation or change the governed backlog.

## Scope and starting evidence

The requested scope is recommendations 1 through 4 from the project review.
UI component retirement is outside this plan.

| ID | Existing problem | Required result |
| --- | --- | --- |
| FS-01 | Local setup does not wait for PostgreSQL health; `local.mjs` duplicates the canonical migration loop | One migration engine, bounded startup, repeatable local setup |
| FS-02 | `store.tsx` combines persistence, recovery, editing, demo state, and status messages | Focused internals with the same `AssessmentProvider`, `useAssessment`, stored data, and user behavior |
| FS-03 | README backlog counts are stale and the documentation index points to an older handoff for next work | One current-status route, with historical context clearly identified |
| FS-04 | Quality verification hard-codes 21 workspaces and 63 tasks | Every discovered workspace receives exactly one lint, typecheck, and test task |

The review ran all 63 quality tasks uncached in 14.954 seconds, plus
`quality:matrix` and `git diff --check`. These are baseline results, not evidence
for future changes. Browser and database acceptance must be collected during
implementation.

The current backlog has 59 entries, including 55 completed and four pending.
Two completed entries are owner tasks, so HANDOFF's 53 completed non-owner count
is accurate. README's 37-of-43 snapshot is stale. Preserve that distinction.

The checkout already has modified `graphify-out/graph.json` and
`graphify-out/GRAPH_REPORT.md`. Preserve their initial diffs before any graph
refresh. Do not discard them or include unrelated graph changes in a task commit.

## Model allocation and cost control

| Work | Implementation model | Effort | Fresh review |
| --- | --- | --- | --- |
| FS-01, local setup and canonical migrations | `gpt-5.6-sol` | high | `gpt-6-astra`, high, after unit and real PostgreSQL evidence |
| FS-02, Assessment state extraction | `gpt-5.6-sol` | high | `gpt-6-astra`, high; this also serves as final integrated review |
| FS-03, documentation corrections | `gpt-5.6-luna` | medium | `gpt-5.6-sol`, medium |
| FS-04, workspace coverage checks | `gpt-5.6-luna` | high | `gpt-5.6-sol`, high |
| Shared files, evidence, task sequencing, and review disposition | Coordinating agent | Current session | Coordinator verifies every reported finding |

Use the smallest bounded assignment that preserves the task contract. Send a
worker this plan, its task section, the baseline SHA, owned paths, and relevant
test files. Avoid replaying the earlier implementation program or whole history.

- Limit implementation concurrency to two workers. Use named ignored worktrees
  only for simultaneous writers. Read `/home/example/git/WORKSPACE.md` first.
- Record the actual model and effort. If the host cannot select an assigned
  model, report the limitation rather than silently changing the assignment.
- Escalate Luna to Sol when the work needs a shared runtime contract change,
  database reasoning, or remains stuck after two attempts at the same failing
  check. Send the failing evidence and current diff to the replacement worker.
- Escalate Sol to Astra for an unresolved migration or persistence invariant.
  Use Astra to settle that narrow decision; return routine implementation to Sol.
- Run deterministic checks before model review. A fresh reviewer reads the
  actual candidate diff and evidence. Do not ask multiple models to repeat the
  same accepted review or run a standing review committee.
- Review corrections on a fresh relevant revision after affected checks pass.
  A changed result requires new evidence; an unchanged accepted result does not.
- These assignments govern development agents only. Do not edit application
  model routes, tenant allowlists, the vendored optimizer, or the unattended
  controller to implement this plan.

## Order and ownership

1. Run FS-01 and FS-04 in parallel. Their owned paths are disjoint.
2. Review and integrate each accepted task through its own branch and PR when
   those Git actions are authorized. Run dependent work from merged dependencies.
3. Run FS-02 and FS-03 after FS-01 and FS-04. FS-03 reconciles the finished
   setup instructions and dynamic quality contract; FS-02 owns Assessment only.
4. Integrate FS-03 before freezing the final FS-02 candidate. Rebase or merge the
   accepted documentation changes into that candidate, rerun checks affected by
   integration, and use FS-02's Astra review for the complete integrated request.

Workers edit only their paths. The coordinator owns shared delivery records,
Graphify, HANDOFF, SHIPLOG, and Git operations. Keep OWNER-TASKS unchanged unless
an actual owner dependency changes. New records go in
`docs/reviews/2026-09-07-fs-01.md` through `2026-09-07-fs-04.md`, with the final
coverage decision in `docs/reviews/2026-09-07-focused-simplification.md`.

## FS-01: make local setup reliable

Implementation: Sol high. Marketing impact: `none` for internal changes;
classify changed public setup/version facts as `truth` before the PR is final.

### Files and responsibilities

- Modify `package.json`: wait for PostgreSQL health before migration.
- Modify `tooling/migrations/package.json`: execute the existing TypeScript
  runner through Node's type-stripping support.
- Modify `tooling/migrations/src/local.mjs`: keep local URL validation, SQL
  discovery, and seeding; replace its private `apply` loop with `applyMigrations`.
- Preserve `tooling/migrations/src/runner.ts` as the canonical execution engine.
- Create `tooling/migrations/src/local.test.ts`: local composition, failure,
  and resource-lifecycle tests with injected pools and migration callbacks.
- Extend `tooling/migrations/src/runner.test.ts` only for a missing invariant.
- Create `tooling/migrations/src/local.integration.test.ts`: guarded local
  composition proof using an `opentenant_it_` database.
- Modify `.nvmrc`, root `package.json` engines, and the README prerequisites
  together to declare the tested Node floor described below.
- Coordinator updates `docs/DELIVERY.md` with the setup acceptance profile.

### Implementation steps

- [ ] Capture the current migration IDs, checksum algorithm, seed behavior,
  exports, and runner tests. The canonical runner already tests checksums,
  out-of-order migrations, rollback, and locking. Reuse those tests.
- [ ] Add a regression that invokes an exported local orchestration function
  with a fake pool and injected `applyMigrations`. Assert that seeding happens
  after migration succeeds, migration failure prevents seeding, checked-out
  seed clients release on failure, and the pool closes on every terminal path.
  Run it before replacing the duplicate loop and record the failing result.
- [ ] Use the existing runtime bridge, verified during planning on Node
  `v22.23.2`:

  ```sh
  rtk proxy fnm exec --using=22 -- node --experimental-strip-types --input-type=module -e 'import { applyMigrations } from "./tooling/migrations/src/runner.ts"; console.log(typeof applyMigrations)'
  ```

  Expected output: `function`. Set `.nvmrc` to `22.23.2`, root engines to
  `>=22.23.2 <23`, and README prerequisites to Node 22.23.2 or later within
  major 22. This explicitly declares the tested floor instead of claiming
  compatibility with every historical Node 22 patch. Keep pnpm pinned as-is.
  Do not add a TypeScript runtime dependency or a second build pipeline.
- [ ] Set the local scripts to:

  ```json
  {
    "local:setup": "docker compose up -d --wait --wait-timeout 60 postgres && pnpm --filter @opentenant/migrations local:migrate"
  }
  ```

  ```json
  {
    "local:migrate": "node --experimental-strip-types src/local.mjs"
  }
  ```

  Retain the existing Compose health check. An unavailable Docker daemon or a
  failed health check exits nonzero before migration starts.
- [ ] Import `applyMigrations` from `./runner.ts` in `local.mjs`, create a
  `pg.Pool`, pass the unchanged discovered migration catalog to the runner,
  acquire a client for the existing seed function afterward, and release/end
  resources with nested `finally` blocks. Guard command-line execution so test
  imports do not connect to a database. Remove the duplicate checksum import
  and migration loop. Preserve seed semantics and loopback-only validation.
- [ ] Add the guarded PostgreSQL integration case. Use the public local
  orchestration function with the test URL; check recorded migration IDs and
  checksums, synthetic seed rows, and repeat-run behavior. Use the existing
  `integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL")` guard.
  The existing migration-execution CI job supplies
  `opentenant_it_control_plane` through this variable; the migrations Vitest
  configuration already serializes files that reset its schema. Make the new
  test run in that job and retain its structured result as evidence. Do not let
  missing integration variables count as successful database acceptance.
- [ ] Run focused checks:

  ```sh
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/migrations exec vitest run src/runner.test.ts src/local.test.ts --configLoader runner
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/migrations typecheck
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/migrations lint
  ```

- [ ] Exercise the documented setup from a disposable checkout with synthetic
  environment values and a uniquely named Compose project. Check that the
  default loopback port is free before starting; stop if another service owns
  it. Never reuse the developer's running database or volume for this proof.
  Run setup twice, then launch the platform and verify the local home and
  Assessment entry. Preserve evidence of health-before-migration ordering.
- [ ] Against separate guarded databases, prove two concurrent migration
  runners serialize, an altered checksum is rejected, and a newly introduced
  older migration is rejected. Existing tests may supply these proofs when
  they execute the same canonical runner against real PostgreSQL.
- [ ] Run the common delivery gates and all database profiles required below.
  Submit the fixed candidate and proof records to Astra. Commit only task-owned
  paths when authorized, using `refactor: unify local migration setup`.

Acceptance: one production migration loop for local and canonical execution;
fresh and repeated setup succeed; startup failure is bounded; failed migration
does not seed; checksum, ordering, locking, cleanup, and existing local user
behavior remain covered by executed evidence.

## FS-02: simplify Assessment state internals

Implementation: Sol high. Marketing impact: `none` unless visible behavior or
copy changes, which this task does not require.

### Files and responsibilities

- Modify `modules/assessment/src/store.tsx`: retain context, public exports,
  provider composition, and `useAssessment`.
- Create `modules/assessment/src/assessment-session.ts`: session types,
  initial state, respondent edit reducer/transitions, and pure session helpers.
- Create `modules/assessment/src/assessment-readout-input.ts`: readout input
  construction and digest functions, with unchanged digest ordering/version.
- Create `modules/assessment/src/persistence/assessment-persistence-coordinator.ts`:
  existing queue, save tracker, tickets, and replacement-epoch coordinator.
- Create `modules/assessment/src/persistence/use-assessment-persistence.ts`:
  hydration, autosave, retry, import/restore, legacy claim, and persistence status.
- Modify `modules/assessment/src/persistence/engagement-schema.ts`: import
  `AssessmentSession` from the pure session file instead of the React store.
- Preserve and, only where necessary, extend `modules/assessment/src/store.test.tsx`,
  `store.integration.test.tsx`, `assessment-results.integration.test.tsx`, and
  `persistence/assessment-repository.test.ts`.
- Update `modules/assessment/src/README.md` only to explain the final ownership.

### Implementation steps

- [ ] Run the existing Assessment tests and record the baseline. Inventory all
  exports and consumers of `store.tsx`, including imports in tests and schema
  files. Record storage keys, readout digest version, and error/status strings.
- [ ] Reformat `store.tsx` without changing its statements or behavior. Inspect
  the whitespace-insensitive diff before extracting code. Do not add a
  repository-wide formatter dependency for this task.
- [ ] Move the existing pure types and transition functions into
  `assessment-session.ts`, and move readout digest functions into
  `assessment-readout-input.ts`. Move implementations unchanged first.
  Re-export their existing public names from `store.tsx` so callers keep working.
  The pure session file must not import the provider or persistence hook.
- [ ] Move `AssessmentPersistenceQueue`, `AssessmentSaveTracker`,
  `AssessmentSaveTicket`, and `AssessmentPersistenceCoordinator` unchanged into
  their persistence file. Preserve their exports through `store.tsx`.
  Retain the repository's own queue; it protects a different boundary from the
  provider's replace/save ordering.
- [ ] Extract the existing persistence effects and operations into
  `use-assessment-persistence.ts`. The hook owns repository identity, load
  lifecycle, metadata, autosave tracking, replacement coordination, persistence
  feedback, and retry/import/export/claim methods. The provider owns active and
  demo domain state and passes explicit snapshots and a stable hydrate callback.
  Keep existing real/demo selection and respondent-edit transitions in the
  provider or pure helper file. Do not introduce a global store or another
  state-management dependency.
- [ ] Preserve the public context property names and signatures. Preserve the
  current tenant-scoped repository construction, load cancellation, generation
  checks, replacement epoch, skip-first-save behavior, and edit-origin snapshot.
  A storage failure must still display unsaved state and allow retry.
- [ ] Run the existing mounted-provider tests after each extraction. Add a
  deferred-promise regression only where coverage is missing, covering tenant
  or supplied-repository replacement while an old load/save is pending. Require
  the old operation to have no effect on the new tenant's visible state.
  Use controlled promises rather than timing sleeps.

  ```sh
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/assessment exec vitest run src/store.test.tsx src/store.integration.test.tsx src/assessment-results.integration.test.tsx src/persistence/assessment-repository.test.ts
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/assessment typecheck
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/assessment lint
  ```

- [ ] Preserve evidence for hydration without an initial write, delayed
  A-to-B-to-A edits, retry after failure, restore while a save is pending,
  invalid import without state loss, tenant mismatch rejection, edit/save/cancel
  with stable respondent IDs and notes, real/demo separation, and StrictMode.
  Keep existing legacy-claim and Web Locks proofs; do not simplify those away.
- [ ] Verify the composed browser journey in an agent-owned BrowserOS Neo tab
  at 375, 768, and 1440 pixels. Complete/edit a respondent with notes, reload,
  export a restorable engagement, import it, try an invalid import, switch demo
  mode, and verify actual PDF/CSV/JSON downloads. A restored readout must retain
  freshness behavior and must not trigger a new provider request by itself.
  Use synthetic data and the existing local model adapter.
- [ ] Run the common delivery gates on the integrated candidate after FS-03
  lands. Ask one fresh Astra reviewer to review FS-02 and final coverage of all
  four tasks. Commit task-owned changes when authorized using
  `refactor: separate assessment state and persistence`.

Acceptance: `store.tsx` composes focused responsibilities; no changed public
store interface, scoring, digest format, storage schema/key, download behavior,
tenant scope, or data-preservation behavior. File length is supporting evidence,
not the acceptance criterion. Moving all complexity into one new giant hook
does not satisfy this task.

## FS-03: give current status one clear home

Implementation: Luna medium. Marketing impact: `truth`.

### Files and responsibilities

- Modify `README.md`: replace manually maintained queue counts with a link to
  the authoritative backlog/status route and correct handoff descriptions.
- Modify `docs/README.md`: route current next-work questions to HANDOFF and the
  backlog; describe FABLE5-HANDOFF as historical planning context.
- Coordinator updates `docs/HANDOFF.md`: preserve accurate operational facts and
  remove unnecessary duplicated counts if the backlog link answers the question.
- Modify `docs/DELIVERY.md` only to reconcile the completed FS-01 and FS-04
  commands and runtime floor. Retain the distinct database and browser gates.

### Implementation steps

- [ ] Read the live backlog and run its status command. Verify completed
  non-owner tasks separately from completed owner tasks and pending owner gates.

  ```sh
  rtk proxy fnm exec --using=22 -- pnpm unattended:status
  ```

- [ ] Replace README's numeric snapshot with this stable text:

  ```markdown
  Current task state and dependencies live in the
  [governed backlog](docs/plans/unattended-backlog.json).
  Run `pnpm unattended:status` to see the next executable or supervised task.
  The [current handoff](docs/HANDOFF.md) explains operating boundaries and
  where to verify them.
  ```

- [ ] Route the documentation index's next-work entry to `HANDOFF.md`; label
  the FABLE5 document as historical planning context. Keep historical evidence
  and its dates intact. Do not rewrite old ship-log counts as present-day totals.
- [ ] Reconcile the README setup prerequisites and delivery contract with the
  accepted FS-01/FS-04 implementation. Use workspace coverage language instead
  of another manually maintained 21/63 count in current instructions.
- [ ] Check all changed relative links and commands against actual files and
  scripts. Search only current-status sections for obsolete counts. Apply the
  unslop audit. No new prose-matching tests or generated status service are
  required for this reversible documentation change.
- [ ] Run `git diff --check`, inspect the final diff, and obtain a fresh Sol
  medium review of factual accuracy. Record `truth` routing for the separate
  marketing repository after merge; do not acknowledge or publish marketing
  changes from this unmerged source. Commit when authorized using
  `docs: consolidate current project status`.

Acceptance: README and the docs index direct readers to the same current
authority; current setup/check instructions exist and match code; historical
records remain historical; no manual count is introduced as a new source of truth.

## FS-04: derive quality coverage from workspace identity

Implementation: Luna high. Marketing impact: `none`.

### Files and responsibilities

- Modify `scripts/assert-quality-pipeline.mjs`: keep the existing CLI entrypoint,
  collect pnpm workspace inventory and Turbo dry-run output, and print results.
- Create `tooling/ci/quality-pipeline.mjs`: pure inventory normalization and
  task-matrix validation, with JSDoc types for the existing CI typecheck.
- Create `tooling/ci/quality-pipeline.test.mjs`: fixture-based contract tests.
  The existing CI package test glob includes this file automatically.
- Coordinator updates `docs/DELIVERY.md` after the behavior passes.

### Implementation steps

- [ ] Capture the installed pnpm inventory shape without network access:

  ```sh
  rtk proxy fnm exec --using=22 -- pnpm list --recursive --depth -1 --json
  rtk proxy fnm exec --using=22 -- pnpm turbo run lint typecheck test --dry=json
  ```

  Derive expected names from pnpm's inventory, independently of Turbo tasks.
  Exclude the repository root by resolved filesystem path, not package name.
  Reject duplicate names, missing names, malformed inventory, and command errors.
  Include every actual workspace, even one with a missing script.
- [ ] Define `validateQualityMatrix(workspaceNames, tasks)` in the pure helper.
  It must throw on any missing, duplicate, or unexpected package/task pair.
  Retain the existing checks that forbid builds and build dependencies, require
  `eslint .` for lint, and require `tsc --noEmit` for typecheck. Reject empty
  commands, including a test task without a command.
- [ ] Add fixture tests before wiring the helper into the CLI. Build valid
  tasks from each workspace name and the three required commands. Require:

  ```text
  One complete workspace passes.
  Twenty-two complete workspaces pass without changing a constant.
  An added workspace with no test task fails.
  A missing lint task plus a duplicate task elsewhere fails.
  A task for an unknown workspace fails.
  Different package-name sets with equal task counts fail.
  Duplicate or missing workspace names fail.
  A build task or a dependency on any package's build task fails.
  Empty commands and incorrect lint/typecheck commands fail.
  A failed inventory or Turbo command is not treated as an empty successful run.
  ```

  Use synthetic fixture names such as `@fixture/a`. Keep real pnpm/Turbo
  invocation in a single smoke check rather than spawning them in every test.
- [ ] Run the tests and record the regression failure before changing the
  wrapper. Implement direct set equality over the expected Cartesian product
  of workspace names and `lint`, `typecheck`, `test`; no new dependency is needed.
- [ ] Import the helper from the existing script. Remove `EXPECTED_WORKSPACES`,
  the fixed 63-task message, and fixed-count assertions. Derive the success
  message from validated inventory. Keep the `quality:matrix` command unchanged.

  ```sh
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/ci test
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/ci typecheck
  rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/ci lint
  rtk proxy fnm exec --using=22 -- pnpm quality:matrix
  ```

- [ ] Run the common delivery gates, inspect the diff for weakened checks, and
  obtain a fresh Sol high review. Commit when authorized using
  `refactor: derive quality coverage from workspace inventory`.

Acceptance: adding a valid workspace needs no counter update; adding a workspace
without a required check fails; equal counts cannot hide mismatched package
identities; the current repository still passes with no quality-time builds.

## Common verification and completion

Apply `repo-delivery` for FS-01 and FS-04. After focused checks, each code task
runs the repository delivery profile under the declared Node version:

```sh
rtk proxy fnm exec --using=22 -- pnpm install --frozen-lockfile
rtk proxy fnm exec --using=22 -- pnpm quality:matrix
rtk proxy fnm exec --using=22 -- pnpm check
rtk proxy fnm exec --using=22 -- pnpm build
rtk git diff --check
```

At the final integrated candidate, force one current execution:

```sh
rtk proxy fnm exec --using=22 -- pnpm turbo run lint typecheck test --force --output-logs=errors-only
rtk proxy fnm exec --using=22 -- pnpm turbo run build --force --output-logs=errors-only
```

FS-01 also requires real migration, store, and RLS profiles from
`docs/DELIVERY.md`, each using its guarded disposable PostgreSQL resources:

```sh
rtk proxy fnm exec --using=22 -- pnpm --filter @opentenant/migrations test
rtk proxy fnm exec --using=22 -- pnpm database:store-proof
rtk proxy fnm exec --using=22 -- pnpm rls:proof
```

Supply the exact suite-owned environment variables from the delivery runbooks
and `.github/workflows/ci.yml` using synthetic local URLs. These commands without
their guarded database configuration are not complete verification instructions
and a skipped named suite is not acceptance. Record the new local integration
suite explicitly alongside the existing canonical profiles. If dependency
manifests or lockfiles change, run both root and standalone starter audits and
the starter install/build profile in the delivery contract.

After code changes, refresh Graphify with `graphify update .` and check freshness.
Keep refreshes AST-only and reconcile the pre-existing graph diff. Do not enable
semantic provider calls. The coordinator checks each requirement against actual
evidence, verifies reviewer findings, and records corrected or rejected findings
with a source-based reason.

Every task record includes base/candidate SHA, actual worker model and effort,
owned paths, commands/exit codes, cache use, tests executed/skipped, database or
browser artifacts, reviewer model/decision, and unresolved external dependencies.

Finish only when all four outcomes pass their acceptance criteria and the final
Astra review accepts the integrated candidate. Record any missing Docker,
PostgreSQL, browser, or model-selection capability as a named blocker rather
than claiming the affected work is complete.

This request authorizes creating the plan. Later implementation may proceed
when requested. Push, merge, publication, provider activation, deployments,
genuine tenant data, and destructive resource cleanup retain their existing
authorization boundaries. No new owner-controlled product work is required to
complete these four local simplification outcomes.

## Planning verification

On 2026-09-07, the coordinator checked coverage of FS-01 through FS-04, the
documentation index link, and whitespace. A read-only runtime probe on Node
`v22.23.2` imported the canonical migration function successfully. The installed
pnpm inventory returned 22 entries including the root, with 21 unique workspace
names after root exclusion.

A fresh read-only reviewer returned `ACCEPT` for scope, model allocation,
ownership, ordering, and acceptance evidence. It confirmed that the existing
migration and CI-package test commands will discover the proposed test files.
This accepts the implementation plan only. No implementation task has started,
and no future database, browser, build, or model assignment is reported as run.
