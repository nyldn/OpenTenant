# Integration round 3

Date: 2026-11-11. Branch: `t3/integration-round3`, based on `a493f20`.
Runtime changes are committed through `739c6af`; the following documentation
commit records verification. The test-only foreign-subject fixture was tightened
in `fb5f476` and reran all 65 identity tests with zero skips. No push, PR, hosted API mutation or production
operation was performed. Marketing impact: truth.

## Merge order and conflict decisions

All three merges use `--no-ff` and the required marketing/co-author trailers.

1. Observability `e0b38f5`: kept both notices and HANDOFF sections; combined
   configuration names, platform dependencies and pnpm overrides. Generated
   graph conflicts took ours. Re-resolved the combined lockfile.
2. Domain/theme e2e `b43beaf`: kept the removal of obsolete Workflow build integration,
   combined Vitest imports and kept the production e2e rejection test. Other
   domain, DNS and harness changes merged into the existing ephemeral runner.
3. Better Auth `d6a0bcf`: combined session tracing with provider cookie handling;
   retained custom-domain identity routing before the Better Auth logout rewrite.
   Preserved keyring/authz/observability configuration, worker/usage dependencies,
   both documentation sets and all used migration reservations. Did not restore
   the obsolete Workflow dependency. Re-resolved and verified the lockfile.

Root scripts retain the union. SHIPLOG and CHANGELOG retain both sets of entries.
No applied migration was edited and no new number was needed. Graphify was
regenerated locally with AST extraction and is not committed.

## Integration commits

```text
e16a8bf merge: integrate observability and rate limits
a22bf26 merge: integrate domain and theme browser coverage
1259c15 merge: integrate Better Auth identity adapter
c6cb276 feat(tenant): trace tenant resolution without changing lookup semantics
0c106d2 fix(limits): rate limit tenant creation and lifecycle mutations
e5dbfb8 fix(tenant): return fail-closed suspended responses from shared API gates
a87cf9d feat(auth): support configured local users through the real session gateway
0700284 feat(identity): run Better Auth on shared Postgres conformance and connect optional email
d5a208f feat(provisioning): select Neon or self-hosted Postgres per installation
7c7108b fix(provisioning): accept operator-declared AP tenants on Postgres
e20217d refactor(config): centralize platform environment reads and enforce lint errors
11f6edb fix(identity): bind invitation mail links to verified tenant hosts
aa0b7b5 fix(auth): reject control characters and ambiguous local memberships
739c6af fix(integration): reconcile lifecycle loading and shared provider proofs
fb5f476 test(identity): reject foreign membership rows with a live signed session
```

## Resulting behavior

Tenant lookup emits `tenant.resolve` without changing resolution order or cache
semantics. Creation and lifecycle mutations use the installation owner budget
before reading input or queueing work. Shared admin, support and limiter gates
use verified host lifecycle status for secret-free, uncached 423 responses;
lifecycle lookup errors fail closed. Expired custom domains cannot disclose
lifecycle status.

`LOCAL_USERS` configures token/tenant/user/email/name/role records outside
production. Duplicate tokens, ambiguous memberships and control characters are
rejected. The normal session/gateway path handles all four synthetic browser
accounts. The session replacement and its file are removed. The domain DNS
composition retains its build, configuration and runtime production guards.

Better Auth runs the shared identity suite against real ephemeral Postgres,
including real pagination and signed sessions. Provider-specific checks remain
in packages/testing; the adapter-local duplicate conformance file is removed.
EmailTransport hooks are off without SMTP configuration. Configured invitations
link to a verified tenant platform host and preserve the reference through login.
SMTP operation and external SSO have not been established by synthetic mail tests.

Production requires an explicit `PROVISIONING_PROVIDER`. Neon needs NEON_*;
Postgres needs its operator admin connection. Both paths use the canonical
migration catalogs, restricted roles, encrypted storage and resume checkpoints.
Postgres creates a separate database and runtime login per tenant, revokes PUBLIC
CONNECT, and has a shared RLS proof plus denied cross-database login evidence.
The operator region string declares placement; it does not route geography.
`ap` is accepted with Postgres; Neon keeps `us`/`eu`. Compose and smoke use
Postgres, with synthetic smoke values and no fake Neon credentials.

Ad hoc environment reads are an ESLint error. The only authored-platform reads
outside server-config are the two documented literal NEXT_RUNTIME selectors in
instrumentation. Pure configuration exports keep build/edge code free of Node
SDKs; the existing Clerk and encryption parsers are reused.

## Exact commands and outcomes

The runner sets `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1`, disables Next/Turbo
telemetry, and runs the commands below from the repository root unless the
command explicitly changes directory. Every database command uses the shared
harness and the CI pgvector image on a random non-5432 loopback port. Connection
values are passed by the harness, never recorded in this report. Counts are
passed/failed/skipped tests, except RLS checks and store assertions. A dash means
there is no assertion suite. An interrupted run's count includes completed
summaries only. [Structured results](2026-11-11-integration-round3-results.json).

| Run | Exact command | Exit | P/F/S |
| --- | --- | --- | --- |
| audit | `pnpm audit --prod --audit-level high` | 0 | — |
| authz | `pnpm db:ephemeral -- pnpm --filter @opentenant/authz test` | 0 | 38/0/0 |
| build | `taskset -c 0,1 pnpm turbo build --filter=@opentenant/platform` | 0 | — |
| build-final | `taskset -c 0,1 pnpm turbo build --filter=@opentenant/platform` | 0 | — |
| diff-check | `git diff --check a493f20 HEAD` | 0 | — |
| e2e-final | `pnpm e2e` | 0 | 11/0/0 |
| gitleaks-inventory | `gitleaks dir . --redact --no-banner --config .gitleaks.toml --report-format json --report-path /tmp/opentenant-round3-evidence/gitleaks-tree.json` | 1 | — |
| graph-final | `graphify update .` | 0 | — |
| graph-update | `graphify update .` | 0 | — |
| identity | `pnpm db:ephemeral -- pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/better-auth.integration.test.ts` | 0 | 65/0/0 |
| identity-foreign-subject | `pnpm db:ephemeral -- pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/better-auth.integration.test.ts` | 0 | 65/0/0 |
| identity-mail-final | `pnpm db:ephemeral -- pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/better-auth.integration.test.ts` | 0 | 65/0/0 |
| install | `pnpm install --frozen-lockfile` | 0 | — |
| isolation | `pnpm db:ephemeral -- env ISOLATION_FUZZ_SEED=20261111 node packages/testing/scripts/isolation-proof.mjs` | 0 | 9/0/0 |
| matrix | `pnpm quality:matrix` | 0 | — |
| migrations | `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | 0 | 175/0/0 |
| prod-tinypool | `pnpm why -r --prod tinypool` | 0 | — |
| provisioning | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts lib/provisioning-postgres.integration.test.ts` | 0 | 2/0/0 |
| provisioning-final | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts lib/provisioning-postgres.integration.test.ts` | 0 | 3/0/0 |
| quality | `pnpm turbo typecheck lint test --force --concurrency=2` | 1 | 114/0/12 |
| quality-final | `pnpm turbo typecheck lint test --force --concurrency=2` | 0 | 2009/0/51 |
| quality-retry | `pnpm turbo typecheck lint test --force --concurrency=2` | 0 | 2009/0/51 |
| regression-index | `pnpm --filter @opentenant/testing exec vitest run src/r11-regressions.test.ts` | 0 | 20/0/0 |
| residual-db | `pnpm db:ephemeral -- sh -c 'CUSTOM_DOMAINS_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/platform exec vitest run lib/custom-domains.integration.test.ts && KEY_ROTATION_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/database exec vitest run src/credential-cipher-rotation.postgres.test.ts && pnpm --filter @opentenant/usage-export test'` | 0 | 22/0/0 |
| ripwire-contract | `ripwire . --edit-check=apps/platform/lib/session.ts:currentSession --legend=compact` | 0 | — |
| ripwire-quality | `ripwire . --quality-delta --legend=compact` | 0 | — |
| rls | `pnpm db:ephemeral -- pnpm rls:proof` | 0 | 314/0/0 |
| security-gitleaks | `gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 1 | — |
| security-gitleaks-final | `cd /tmp/opentenant-round3-source && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | — |
| security-gitleaks-source | `cd /tmp/opentenant-round3-source && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | — |
| security-semgrep | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | — |
| security-semgrep-final | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | — |
| security-trivy | `trivy fs --offline-scan --skip-db-update --skip-check-update --skip-version-check --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git --skip-dirs graphify-out --skip-dirs apps/platform/.next .` | 1 | — |
| smoke | `SMOKE_APP_PORT=3393 SMOKE_POSTGRES_PORT=55493 node scripts/smoke-deploy.mjs` | 1 | — |
| smoke-final | `SMOKE_BUILD_NETWORK=host SMOKE_APP_PORT=3393 SMOKE_POSTGRES_PORT=55493 node scripts/smoke-deploy.mjs` | 0 | — |
| smoke-retry | `SMOKE_BUILD_NETWORK=host SMOKE_APP_PORT=3393 SMOKE_POSTGRES_PORT=55493 node scripts/smoke-deploy.mjs` | 0 | — |
| stores | `pnpm db:ephemeral -- pnpm database:store-proof` | 0 | 40/0/0 |
| telemetry-db | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts` | 1 | 2/1/0 |
| telemetry-db-retry | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts` | 1 | 2/1/0 |
| telemetry-db-static | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts` | 0 | 3/0/0 |
| telemetry-diagnostic | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts` | 1 | 2/1/0 |
| tracing-db | `pnpm db:ephemeral -- pnpm --filter @opentenant/observability test` | 0 | 33/0/0 |
| worker | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts` | 0 | 8/0/0 |

The final quality gate passed all 81 tasks across 27 workspaces, with 2,009 tests
passed, zero failed and 51 skipped. The 49 database skips all execute successfully
in dedicated proofs: 22 audit TRUNCATE, ten audit checkpoints, two key rotation,
six custom-domain, six usage-export and three limiter cases. The remaining two
skips are optional microsandbox and SMTP integration, unverified, not passes.
Environment-gated zero-test files, including real pg tracing, provisioning,
worker and isolation, also have separate successful runs.

Identity: 39 shared Local/WorkOS/Clerk tests plus 26 Better Auth shared and
provider-specific tests. Authz: 38 tests, including real local OpenFGA.
Isolation fuzz: nine tests, 175 family sequences and five malformed-ID sequences,
seed 20261111. The browser run has eleven cases, zero failures and zero skips.

## Earlier failures and limits

- The first full quality attempt failed on an unused Clerk parser import after
  extraction. Removing it fixed lint. Both subsequent full gates pass. Exploratory
  typechecks also caught optional-property, DOM iterable and JSX import issues;
  pure configuration/email exports and the correct test libs resolve them.
- The concurrent limiter entrypoint initially returned one admission and eleven
  503s. A static lifecycle import resolved the concurrent first-use behavior;
  the corrected proof admits five and returns seven 429s. No budget, error policy
  or admission assertion was weakened. Both initial failures and the successful
  corrected run are recorded above.
- The first Docker smoke was stopped after npm DNS/download failures on bridge
  networking. The explicit `SMOKE_BUILD_NETWORK=host` retry passed. That option
  applies to image builds only; runtime services keep their Compose network.
- No test timeout occurred. Earlier non-timeout failures are retained as failures.
- The initial whole-working-directory Gitleaks scan found 108 reports. A repeated
  redacted inventory found 121, all in generated Next output while builds changed
  that tree. The authored-source snapshot, preserving repository-relative
  allowlists and excluding generated/dependency trees, has zero findings. No
  allowlist was weakened and no generated output is committed.
- Semgrep scans the repository with seven local rules and no remote configuration.
  Trivy uses cached offline data. It reports two critical tinypool 1.1.1 advisories,
  CVE-2026-104848 and CVE-2026-104849. `pnpm why -r --prod tinypool` is empty;
  the production audit reports zero high/critical, one low and five moderate.
  The test-tooling dependency advisory remains open; it is not a clean Trivy gate.
- Real SMTP and local microsandbox remain unverified. Hosted provider activation,
  real tenant data and production deployment remain owner-gated.

Ripwire's final working-tree-vs-HEAD delta has zero gating findings and the
currentSession contract check has 17 callers, zero incompatible calls. This is
not an independent review of the full branch. Graphify AST update succeeds with
existing missing SQL-parser and metadata warnings. There is no pre-commit or
Promptfoo configuration to run. Raw logs remain under
`/tmp/opentenant-round3-evidence/`; exploratory logs are `/tmp/round3-*.log`.

## Regression index

All eighteen R11 entries are fixed with existing named tests. R11-12 names
`accepts ap as an operator-declared Postgres region`. R11-18 names
`requires only the selected production provisioning provider`,
`provisions a self-hosted database, preserves credentials on resume, and enforces RLS`
and `keeps runtime credentials independent and denies cross-database connections`.
The production provider and AP choices are documented in the deployment runbook.
The all-fixed index is code/test evidence; no ECS score or production claim is
assigned by this implementation record.
