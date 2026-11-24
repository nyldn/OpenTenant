# Balanced simplification program

Date: 2026-08-07

## Objective

Improve developer feedback speed, runtime efficiency, code boundaries,
Assessment usability, and operational documentation without removing a
capability, changing a database schema, changing permission vocabulary, or
breaking an external package API.

The program is five sequential tasks. Each task uses its own branch and pull
request, lands before its dependent task starts, and refreshes the repository
graph. Production smoke evidence is required after every merge before the next
task is unlocked. `OWNER-BILLING-01` remains untouched and owner-gated.

`SIMPLIFY-01` is supervised because all 21 workspaces includes the trusted CI
package manifest. `SIMPLIFY-04` is supervised because its runner-facade work
changes the trusted unattended controller itself. The controller deliberately
cannot grant itself either authority. Both tasks stay dependency-ordered in the
backlog. Status reports them separately, while run, verification recovery, and
loop commands never select them for unattended execution.

## SIMPLIFY-01: quality pipeline

- Replace the 21 workspace `lint` aliases to `tsc --noEmit` with one root
  ESLint flat configuration using non-type-aware typescript-eslint
  recommendations and Next.js Core Web Vitals.
- Keep one explicit TypeScript check per workspace.
- Remove unnecessary upstream builds from `typecheck` and `test`.
- Prove the dry-run graph contains exactly 21 lint, 21 typecheck, and 21 test
  tasks and no build task.

## SIMPLIFY-02: request context and database pools

- Add a global reusable `controlPlanePool()` with observability attachment,
  maximum size five, 30-second idle timeout, and five-second connection and
  query timeouts.
- Add `withControlPlaneTransaction(work)` with one-client begin, commit,
  rollback, broken-client release, and error propagation.
- Migrate reusable control-plane consumers while keeping tenant RLS,
  provisioning one-shot, and workflow heartbeat pools physically separate.
- Wrap `currentTenant` and `currentSession` in module-level React `cache`
  without making Route Handlers depend on memoization.

## SIMPLIFY-03: sharper HTTP and data boundaries

- Move raw SQL out of all eleven production route and page files into existing
  domain services or narrowly named stores.
- Use the shared transaction helper wherever a mutation and its audit event
  must commit atomically.
- Reuse the hardened shared `sameOrigin` check in Assessment.
- Keep authorization visible in every route, including the explicit
  permission, gate result, and failure response.
- Derive the audit actor once in `TenantAdminContext`.

## SIMPLIFY-04: stable facades

- Make the unattended runner a compatibility facade over agent/sandbox setup,
  Git state, verification/PostgreSQL proof, and orchestration state.
- Split Support AI and Support Depth into policy, store/adapter, and service
  modules without changing package exports.
- Add facade contract tests before moving implementations. Keep the runner and
  Support facades below 100 lines and every new service module below 450.

## SIMPLIFY-05: Assessment polish and operational docs

- Reduce `AssessmentApp` to a coordinator below 250 lines with separate shell,
  questionnaire, responses, results, and export modules.
- Preserve scoring, evidence, demo data, respondent CRUD, consolidation, AI
  readout, PDF, CSV, JSON, and sign-out.
- Keep one demo banner, add visible completion progress, make roster and score
  matrix tabs, and consolidate exports to PDF plus one CSV/JSON menu.
- Verify keyboard navigation, 375/768/1440 layouts, and real downloads.
- Rewrite `docs/HANDOFF.md` below 250 lines. Historical delivery evidence stays
  in `docs/SHIPLOG.md`, and releases stay in `CHANGELOG.md`.

The README roadmap can move from `in progress` to `available now` only in a
post-production follow-up after all five pull requests are merged and their
production smoke checks pass.

## Required verification

Every task runs focused tests, `pnpm check`, `pnpm build`, `git diff --check`,
`graphify update .`, and `graphify check-update .` under Node 22. Database tasks
also run `pnpm rls:proof`. Platform and Assessment changes use preview
deployments. After each merge, production smoke checks cover tenant resolution,
administrator settings, managed support, Assessment completion, and audit
evidence before the next task starts.
