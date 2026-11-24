# Integration wave 4a

Date: 2026-11-11. Branch: `t3/integration-wave4a`, based on `e5c0829`.
Marketing impact: truth. No push, PR, publication, hosted provider mutation or
production deployment was performed. All evidence uses local synthetic data.

## Merge decisions

The ordered no-fast-forward merges integrate package-build/release maturity,
module registry extensibility, and restore-drill/adopter documentation.
The tenant-module conflict uses registry catalogs with the package build's
SQL asset handling. The CI conflict retains package, docs-link and restore jobs.
No historical SQL was edited. All merge messages carry the requested trailers.

## Registry and configuration

The documented search starts at 150 matching lines after merging, compared with
the registry branch's 172-to-151 reduction. The package-build merge removes one
Next configuration match. It ends at zero after six explicit app exclusions: three
operator support route budget calls, the platform rate-budget type and classifier,
and one package dependency declaration. Each runtime exclusion has a comment;
the composition explains the dependency metadata exclusion. The raw final count
is six. The extended shared-runtime audit starts at 20 matching lines and ends
at zero after excluding the SDK's shared support rate-budget type. The combined
raw final count is seven, with seven exclusions and zero special cases.
`pnpm module:audit` enforces both scopes.

Runtime imports of built-in packages are confined to the composition. Module
packages own native pages and APIs. Contributions supply export schemas,
configuration keys, access permissions, catalog defaults and helpdesk bindings.
The platform's operator support authority, immutable broker capability vocabulary
and audit event vocabulary remain platform contracts. They do not select a
native module. OAuth vault AAD is shared security behavior.

The runtime environment restriction is an ESLint error in apps, packages and
modules. Packages and modules have no runtime exceptions. Tests and scripts are
excluded. Three
operator scripts retain their historical src paths: database audit-cli,
credential-cipher-rotate, and auth-better-auth generate-migration. The two
literal NEXT_RUNTIME selectors in platform instrumentation retain their existing
documented exceptions for Next's static runtime selection.

## Commits

Runtime and harness changes are committed through `08ab794`. The following
documentation commit records the final evidence. Integration commits, oldest
first:

```text
0ea868c merge: integrate package build and release maturity
93b6ee7 merge: integrate module registry extensibility
a301ae8 merge: integrate restore drill and adopter documentation
b1445cb fix(packages): build registry definitions and ship module SQL assets
d6b4561 refactor(modules): dispatch native pages and APIs through manifest contributions
0752200 feat(registry): seed installation catalogs and plan fleet migrations from contributions
9b90f48 refactor(config): prohibit ambient environment reads in runtime libraries
f9bca33 refactor(registry): declare module exports configuration and operator service bindings
462817f fix(registry): expose portable service types and restrict module configuration
8abd555 test(registry): install packed Hello into a temporary host in CI
45ab096 fix(assessment): preserve the brand scope of the module contrast rule
1d50478 refactor(registry): remove built-in selection from shared runtime packages
08ab794 fix(testing): exclude local credentials and agent state from adopter copies
```

## Exact command results

Node 22.23.2, pnpm 11.13.1. Commands run from the repository root unless they
explicitly change directory. The runner sets `VITEST_MAX_FORKS=2`,
`VITEST_MIN_FORKS=1`, `NEXT_TELEMETRY_DISABLED=1`, and
`TURBO_TELEMETRY_DISABLED=1`. Every database proof uses `pnpm db:ephemeral` and
`pgvector/pgvector:0.8.2-pg17-bookworm` on a random non-5432 loopback port.
Connection values are never recorded. A command with no assertion suite has
no test count. [Structured results](2026-11-11-integration-wave4a-results.json)
include durations and task counts. Local raw logs remain under
`/tmp/opentenant-wave4a-evidence/`.

| Run | Exact command | Exit | Passed / failed / skipped | Unit |
| --- | --- | --- | --- | --- |
| d-library-tests | `pnpm --filter @opentenant/auth test && pnpm --filter @opentenant/database exec vitest run src/credential-cipher.test.ts && pnpm --filter @opentenant/security exec vitest run src/checkpoint-sinks.test.ts && pnpm --filter @opentenant/brain exec vitest run src/embeddings.test.ts && node --test tooling/ci/runtime-env.test.mjs` | 0 | 175/0/0 | tests |
| packed-adopter | `pnpm module:adopter-proof` | 1 | — | command |
| b-migrations-final | `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | 0 | 178/0/0 | tests |
| packed-adopter-2 | `pnpm module:adopter-proof` | 1 | — | command |
| build | `pnpm turbo build` | 1 | — | command |
| install-final | `pnpm install --frozen-lockfile` | 0 | — | command |
| packed-adopter-3 | `pnpm module:adopter-proof` | 1 | — | command |
| matrix | `pnpm quality:matrix` | 0 | — | command |
| docs | `pnpm docs:links` | 1 | — | command |
| changesets | `pnpm changeset status` | 0 | — | command |
| audit | `pnpm audit --audit-level high` | 0 | — | command |
| rls | `pnpm db:ephemeral -- pnpm rls:proof` | 0 | 314/0/0 | checks |
| stores | `pnpm db:ephemeral -- pnpm database:store-proof` | 0 | 40/0/0 | assertions |
| provisioning | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts lib/provisioning-postgres.integration.test.ts` | 0 | 3/0/0 | tests |
| packed-adopter-4 | `pnpm module:adopter-proof` | 1 | — | command |
| worker | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts` | 0 | 8/0/0 | tests |
| build-2 | `pnpm turbo build` | 0 | — | command |
| registry-extras-tests | `pnpm --filter @opentenant/platform exec vitest run lib/helpdesk.test.ts lib/module-capability-broker.test.ts lib/connections.test.ts lib/server-config.test.ts && pnpm --filter @opentenant/module-sdk test` | 0 | 64/0/0 | tests |
| docs-final | `pnpm docs:links` | 0 | — | command |
| packed-adopter-5 | `pnpm module:adopter-proof` | 1 | — | command |
| gitleaks | `cd /tmp/opentenant-wave4a-source && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | — | command |
| isolation | `pnpm db:ephemeral -- env ISOLATION_FUZZ_SEED=20261111 node packages/testing/scripts/isolation-proof.mjs` | 0 | 9/0/0 | tests |
| package-final | `pnpm package:check` | 0 | 22/0/0 | packages |
| registry-contract-tests | `pnpm --filter @opentenant/module-sdk test` | 0 | 18/0/0 | tests |
| ripwire-contract | `ripwire . --edit-check=defineModule --legend=compact` | 0 | — | command |
| semgrep | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | — | command |
| ripwire-quality | `ripwire . --quality-delta --legend=compact` | 2 | — | command |
| trivy | `trivy fs --offline-scan --skip-db-update --skip-check-update --skip-version-check --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git --skip-dirs graphify-out --skip-dirs .agents --skip-dirs apps/platform/.next .` | 0 | — | command |
| restore | `pnpm restore:drill` | 0 | — | command |
| quality | `pnpm turbo typecheck lint test --force --concurrency=2` | 2 | 1391/0/20 | tests |
| packed-adopter-6 | `pnpm module:adopter-proof` | 0 | 3/0/0 | tests |
| module-config-tests | `pnpm --filter @opentenant/platform exec vitest run lib/module-services.test.ts lib/module-third-party-access.test.tsx lib/tenant-suspension-access.test.ts app/\[...modulePath\]/page.test.tsx` | 0 | 11/0/0 | tests |
| residual-database | `pnpm db:ephemeral -- sh -c 'CUSTOM_DOMAINS_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/platform exec vitest run lib/custom-domains.integration.test.ts && KEY_ROTATION_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/database exec vitest run src/credential-cipher-rotation.postgres.test.ts && pnpm --filter @opentenant/usage-export test'` | 0 | 22/0/0 | tests |
| database-audit | `pnpm db:ephemeral -- pnpm --filter @opentenant/database exec vitest run src/audit-truncate.integration.test.ts src/audit-checkpoints.integration.test.ts` | 0 | 10/0/0 | tests |
| limiter | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts` | 0 | 3/0/0 | tests |
| migrations-final | `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | 0 | 178/0/0 | tests |
| packed-adopter-final | `pnpm module:adopter-proof` | 0 | 3/0/0 | tests |
| quality-2 | `pnpm turbo typecheck lint test --force --concurrency=2` | 1 | 2011/12/52 | tests |
| gitleaks-final | `cd /tmp/opentenant-wave4a-source-final && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | — | command |
| package-complete | `pnpm package:check` | 0 | 22/0/0 | packages |
| semgrep-final | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | — | command |
| graph | `graphify update .` | 0 | — | command |
| smoke | `SMOKE_BUILD_NETWORK=host SMOKE_APP_PORT=3494 SMOKE_POSTGRES_PORT=55494 node scripts/smoke-deploy.mjs` | 0 | — | command |
| shared-platform-tests | `pnpm --filter @opentenant/platform test` | 1 | 496/1/9 | tests |
| shared-library-tests | `pnpm --filter @opentenant/observability test && pnpm --filter @opentenant/auth test && pnpm --filter @opentenant/security test` | 1 | 185/1/0 | tests |
| identity | `pnpm db:ephemeral -- pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/better-auth.integration.test.ts` | 0 | 65/0/0 | tests |
| shared-platform-tests-2 | `pnpm --filter @opentenant/platform test` | 0 | 497/0/9 | tests |
| shared-library-tests-2 | `pnpm --filter @opentenant/observability test && pnpm --filter @opentenant/auth test && pnpm --filter @opentenant/security test` | 0 | 251/0/0 | tests |
| shared-regression-tests | `pnpm --filter @opentenant/platform exec vitest run app/api/telemetry/route.test.ts app/api/module-access/\[module\]/route.test.ts app/api/mcp/developer-mcp-surface.test.ts lib/tenant-activity.test.ts && pnpm --filter @opentenant/auth exec vitest run src/local/gateway.test.ts && pnpm --filter @opentenant/security exec vitest run src/tenant-activity.test.ts && pnpm --filter @opentenant/observability exec vitest run src/index.test.ts && pnpm --filter @opentenant/module-sdk test` | 0 | 77/0/0 | tests |
| quality-3 | `pnpm turbo typecheck lint test --force --concurrency=2` | 0 | 2027/0/52 | tests |
| install-complete | `pnpm install --frozen-lockfile` | 0 | — | command |
| platform-final | `pnpm --filter @opentenant/platform build` | 0 | — | command |
| packages-final | `pnpm package:check` | 0 | 22/0/0 | packages |
| changesets-final | `pnpm changeset status` | 0 | — | command |
| audit-final | `pnpm audit --audit-level high` | 0 | — | command |
| matrix-final | `pnpm quality:matrix` | 0 | — | command |
| observability-database | `pnpm db:ephemeral -- pnpm --filter @opentenant/observability test` | 0 | 34/0/0 | tests |
| module-audit | `pnpm module:audit` | 0 | — | command |
| gitleaks-complete | `cd /tmp/opentenant-wave4a-source-final && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | — | command |
| structure-final | `ripwire . --quality-delta --legend=compact` | 0 | — | command |
| graph-final | `graphify update .` | 0 | — | command |
| security-final | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | — | command |
| e2e | `pnpm e2e` | 0 | 11/0/0 | tests |
| build-complete | `pnpm turbo build` | 0 | — | command |
| docs-complete | `pnpm docs:links` | 0 | — | command |
| smoke-final | `SMOKE_BUILD_NETWORK=host SMOKE_APP_PORT=3495 SMOKE_POSTGRES_PORT=55495 node scripts/smoke-deploy.mjs` | 0 | — | command |
| source-env | `pnpm exec eslint apps/platform packages modules` | 0 | — | command |
| docs-handoff | `pnpm docs:links` | 0 | — | command |
| diff-before-handoff | `git diff --check e5c0829 HEAD` | 0 | — | command |

The final full gate passes 108/108 uncached tasks with 2,027 tests passed,
zero failures and 52 skips. Fifty database skips execute successfully in the
dedicated proofs: 22 audit TRUNCATE cases and one Hello case in migrations,
ten audit checkpoint cases in the store proof, two key-rotation, six custom
domain, six usage-export and three limiter cases. The two external-service
skips are optional real microsandbox and SMTP integration. They remain
unverified and are not passes. Environment-gated zero-test files have separate
identity, provisioning, worker, isolation and real PostgreSQL tracing runs.

The full build passes 24/24 tasks. The final repetition uses matching build
cache entries; the explicit platform build also passes. All 22 public packages,
including Hello, pass publint, ATTW, packed-file, licence, secret and SQL checks.
All 55 historical IDs/checksums match the immutable fixture. Hello's SQL is byte
identical to the registry branch, SHA-256
`7d3dd13836ed6aeffd735865737142e26d98d389f03243760bc9d2389d66a46f`.
The packed proof passes three real-host/database tests, modifying exactly one
composition line and dependency metadata in a temporary copy. The 11 browser
cases pass with no skips. Both smoke runs pass and clean up their own resources.
The final smoke uses ports 3495 and 55495.

The restore drill loses zero rows, measures zero RPO for its quiesced synthetic
workload and measures RTO 37.116 seconds. It does not establish production RPO/RTO.
The audit threshold has zero high/critical findings, ten moderate and one low.

## Failures, corrections and retries

- The first full gate stops at a non-portable inferred helpdesk service type.
  A named public `HelpdeskSource` fixes declaration generation. The second full
  run exposes 12 stale fixture/surface expectations. Synthetic module tests now
  install their fixture definitions; shared telemetry schemas, logout cookies,
  local permissions and activity IDs are registry/configuration contributions.
  The third full run passes every task. No assertion was removed to hide a failure.
- The first build exposes module server code in the edge configuration import.
  Module configuration projection moves into server-only host services. The
  next full build and explicit final platform build pass.
- Initial package checks identify the sample's absent licence file and a
  not-yet-built new entrypoint. The full Apache licence and ordered builds fix
  them. Final package checks pass all 22 packages, including declared SQL assets.
- Packed-proof development first encounters unpublished SDK resolution, then
  missing offline tarballs, then an incomplete workspace installation. A packed
  SDK with a temporary scoped override, permitted npm resolution, a complete
  install and prerequisite builds fix the setup. Both completed proof runs pass
  three tests. The final proof also ships SQL and asserts exactly one changed
  composition line.
- The first database migration runs find the setup's missing platform-core
  dependency and an old expectation that local Brain defaults to enabled.
  Declaring the dependency and using the registry default fix them. Both final
  migration runs pass 178 tests with zero skips.
- Earlier focused development runs catch SQL loading in Vite, nested exported
  declarations, fixture mocks and the moved MCP route inventory. Shared SQL
  loading, public types and explicit module fixtures fix those failures.
- Ripwire initially reports a complexity regression in `defineModule`.
  Extracting resource validation removes it. The final check reports zero
  gating regressions at `08ab79421+dirty`; only documentation/generated graph
  changes were dirty at that checkpoint.
- No test times out during this integration, so no timeout retry is required.
  Repeated runs above correct concrete setup, compiler or assertion failures.

Gitleaks finds zero source leaks with the repository-relative allowlist.
Semgrep runs seven local rules with zero findings; this is a limited rule scan.
Trivy's offline vulnerability/misconfiguration scan finds zero high/critical
findings in repository deployment/runtime inputs, excluding vendored agent tools
and generated output. No pre-commit or Promptfoo configuration exists.
Graphify refreshes with AST extraction; existing parser/semantic metadata
warnings remain. Generated graph output is deliberately not committed.
