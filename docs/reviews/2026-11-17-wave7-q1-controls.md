# Wave 7 Q1 fixes and local UAT controls

Date: 2026-11-17. Resumed the integrator's saved `e9ff898` WIP on
`t3/wave7-q1fix`. Implementation checks ran on `a0c941d` before commit
consolidation. Final implementation files retain that revision's contents.
No push or production operation is included.

## Item 1: bounded audit filters

Files: `apps/platform/app/admin/audit/{page.tsx,page.test.tsx,audit-filters-form.tsx}`,
`apps/platform/lib/audit-filters.ts`,
`packages/database/src/{audit-store.ts,audit-store.test.ts,audit-store-filters.test.ts}`,
`tooling/e2e/{audit/phases.mjs,specs/admin-accessibility.spec.ts}`, and
`CHANGELOG.md`.

GET filters apply tenant, action and inclusive UTC dates before the existing
100-row limit. Labelled controls, clear action and announced shown count retain
admin authorization and the scrollable table.

The original commit recorded 10/10 audit page unit tests and 122 passed database
tests with 21 optional integration cases skipped. The final package run also
includes those 10 audit page cases. Both admin browser batches passed 5/5 at
390 and 1440 pixels, zero failed/skipped. Additional audit persona coverage is
recorded below. Marketing impact: truth; the canonical changelog is updated.

## Item 2: private brand fixtures

Files: `tooling/uat/{brand-assets.mjs,brand-assets.test.mjs,seed.mjs,snapshot.mjs,
runtime.mjs,runtime.test.mjs,package.json}`,
`tooling/e2e/{audit/phases.mjs,specs/branding-assets.spec.ts,specs/uat-reset.spec.ts}`,
and `docs/plans/2026-11-15-ux-fix-plan.md`.

Fixture version 2 seeds stable synthetic PNGs in the real private asset store.
Both owners are denied the other asset on all nine UAT hosts; their own assets
and public defaults work. Reset and a fresh stack preserve exact asset metadata
and bytes. The saved browser test needed readonly fixture pairs to satisfy
strict indexed access; no asset behavior changed for that typing correction.

The original commit recorded 11/11 UAT Node tests. Final evidence includes the
seed case within 40/40 UAT Node tests, branding browser cases 2/2, and the shared
reset/restart case 1/1. All these Node/browser cases have zero skips. Marketing
impact: none.

## Items 3 and 4: guarded fixture controls

Files: `tooling/uat/{control.mjs,control-guard.mjs,operator.mjs,provision-control.mjs,
export-control.mjs,control.test.mjs,runtime.mjs,runtime.test.mjs,serve.mjs,README.md}`,
`package.json`, `tooling/e2e/specs/uat-reset.spec.ts`,
`tooling/ci/run-database-store-tests.test.mjs`, `docs/tooling/uat.md`,
`docs/plans/2026-11-15-ux-fix-plan.md`, `docs/HANDOFF.md`, `docs/SHIPLOG.md`,
and this record.

The CLI and gateway both check the owning manifest/run. The server checks the
live controller PID/start time/cwd, canonical worktree directories, loopback
URLs and ports, and a running network-isolated, run/worktree-labelled pinned
pgvector container. Foreign/stopped stacks, service Postgres, remote targets,
driver host overrides and malformed commands are refused. The private gateway
token is required; bodies are bounded and failures return safe receipts.
Controls serialize against each other and reset. No secrets are printed.

Journey 4 creates an incompatible `public.schema_migrations` fixture table in a
new synthetic tenant database. The real worker fails naturally. `clear` checks
the exact conflict shape before removing it and preserves product checkpoints
and jobs. An unused fixture database is removed when no tenant was created.
The live proof observed failed after five normal attempts, clicked the product
Retry job action, observed active/completed, and found exactly one retry audit.

Journey 5 changes only existing archive expiry for the requested slug, in one
parameterized statement against the disposable control database. Past expiry
never moves forward. Unknown tenants are refused and an empty tenant returns
zero. The live proof downloaded Alpha and Beta with 200, expired Alpha, then
observed Alpha 404 and Beta 200 with identical Beta expiry. Completed job state
was retained. No application, provisioner or worker code changed for either
control. Marketing impact: none.

Reset/restart passed after both controls: archive authority and the created
tenant/database disappear, control status is unarmed, seeded private asset
metadata/bytes return exactly, and old sign-in authority is rejected. These
assertions share one browser reset test.

The store-test edit is retained because its cwd-relative workflow path fails
under the required repository-root Node command. Resolving from `import.meta.url`
works both from root and from the CI package. The unused path import was removed;
inventory and database assertions are intact. No environment ceilings,
dependencies, migrations or production control flags were added.

## Tester commands

Run over SSH in the worktree owning the approved running disposable stack:

```sh
pnpm uat:control --help
pnpm uat:control fail-next-provision
pnpm uat:control status
# Create uat-provision-retry in the product, region eu. Wait for failed/Retry job.
pnpm uat:control status
pnpm uat:control clear
# Click Retry job in the product and wait for active/completed.
pnpm uat:control status
# First create and download an Alpha export in the product.
pnpm uat:control expire-exports alpha
# Retry its original URL: 404. Other tenant exports remain available.
```

`fail-next-provision <new-synthetic-slug>` selects another new slug.
`expire-exports <tenant-slug>` selects another tenant's existing exports.
`pnpm uat:reset` removes the controls and restores the seed.

## Verification and limits

Every long command ran in the foreground through `forge-job run`, retaining the
default lifetime, memory and process limits. Public images were already cached;
all proof endpoints were local. The shared tmux stack was never used or stopped.

Passed checks:

- `node --test tooling/uat/*.test.mjs`: 40 passed, zero failed/skipped.
- `node --test tooling/ci/*.test.mjs`: 483 passed, zero failed/skipped.
- `pnpm build`: 25/25 tasks, including the platform build.
- Admin browser batches: 5/5 at each viewport, zero failed/skipped.
- Branding/reset browser batch: 3/3, zero failed/skipped, including both controls.
- E2E package typecheck/lint passed after the readonly tuple correction.
- Final `pnpm turbo typecheck lint test --concurrency=1 --output-logs=errors-only`:
  115/115 successful tasks, 109 cached. This includes typecheck and lint for all
  touched packages. The platform unit run has 707 passed and 36 optional cases
  skipped; the database unit run has 122 passed and 21 optional cases skipped.
- Ripwire branch quality delta: zero gating findings, five minor findings and
  two new-symbol findings. The component's dead-code finding misses its JSX use.
- `git diff --check` passed.

The exact combined browser command was attempted first:

```sh
CI=1 pnpm e2e specs/admin-accessibility.spec.ts specs/uat-reset.spec.ts specs/branding-assets.spec.ts
```

Forge terminated that job at its 6 GiB limit after eight admin cases had passed;
the interrupted aggregate report is not a passing receipt. Equivalent complete
coverage used two `E2E_PHASE=journeys E2E_FILTERED=1` runs of
`tooling/e2e/run-phase.mjs specs/admin-accessibility.spec.ts`, with `--grep='at 390'`
and `--grep='at 1440'`, then a standalone `E2E_PHASE=reset E2E_FILTERED=1` Playwright
run of the branding and reset specs. All limits remained in force.

An initial unconstrained Turbo run hit the job's thread limit. A lower-concurrency
run found an untouched Assessment stream-cancellation timing failure; it passed
on rerun with Turbo concurrency set to one. The subsequent gate reached 114/115
tasks and exposed the saved branding tuple type error, which was fixed.

## Existing audit baseline drift

The extra strict `persona-a11y.spec.ts` run for `admin-audit` stopped with six
passed, one failed and eleven not run. It expects the tenant owner to redirect
home and see `Example Alpha`; the actual page stays at `/admin/audit` and renders
`Access denied`. The identical authorization guard already returns
`AdminAccessDenied` at base `a40fac1`, before the filter changes. The baseline is
unchanged by this task.

The integrator should review nine baseline cells: tenant-owner, admin and member
at 390, 768 and 1440. Each currently expects final `/` and heading `Example Alpha`;
the existing product behavior is final `/admin/audit` and heading `Access denied`,
with status 200, tenant binding unchanged, and no audit data. Review the expected
document while retaining the audit authorization guard.

An additional diagnostic run used the existing persona spec in candidate mode,
followed by explicit checks of the current permission outcomes and WCAG target,
severity and count comparisons against the reviewed baseline. All 18 cells
passed across six personas and three viewports, with zero new or worse WCAG
violations. Candidate mode did not rewrite any baseline. This diagnostic result
does not make the strict baseline comparison pass.

## Cleanup and handoff

All 39 recorded loopback listener ports are closed. All seven recorded container
names are absent, no containers carry this worktree's UAT label, and its manifest
and active lock are absent. The named foreground jobs are inactive and
`forge-job audit` reports no unmanaged dev servers. Unrelated existing resources
were preserved.

Graphify AST refresh completed with zero API tokens and its outputs remain
uncommitted. Its existing SQL-parser warning means 67 SQL files contributed no
symbols. Nine existing semantic nodes also lack `source_file` metadata. These
graph limitations are separate from the executed database proofs. The final
implementation tree matches the tested pre-consolidation
revision. The only remaining check issue is the strict audit baseline drift
above. The original monolithic browser invocation exceeded its memory budget;
all 13 primary browser cases passed in bounded batches instead.
