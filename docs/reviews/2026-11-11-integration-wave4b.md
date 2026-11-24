# Integration wave 4b

Date: 2026-11-11. Branch: `t3/integration-wave4b`, from `f078c8d`.
Marketing impact: truth. No push, PR, npm publication, hosted provider change or
production enablement was performed. All databases and identities are synthetic.
Generated Graphify files remain uncommitted.

## Integration and boundaries

The ordered no-fast-forward merges retain isolated CI databases, the canonical
`ci:db-sequence`, production Postgres provisioning and the original sixteen
browser journeys. All application imports use built public entrypoints. E2E
module entitlements derive from an installed fixture registry, including the
remote proxy fixture. Registry catalog insertion stays transactional so deferred
initial-version foreign keys hold. The module audit has zero special cases;
the generated host composition has one explicit composition exclusion, alongside
the seven previously documented exclusions.

Brain owns its API through its manifest. It receives tenant database, identity,
permission and model-routing ports instead of importing platform source. Its
manifest declares the execution mode, and missing/production mode denies local
embedding fallback. Local hashing is deterministic, not a hosted semantic model.
Promotion and its decision-chain entry commit together.

MCP migrations 0070 and 0071 are forward additions. All 55 historical migration
IDs/checksums are unchanged; two new checksums extend the fixture to 57.
Destructive test fixtures reset the new schema before replay. Global startup
validates the exact production owner gate. A pure built config entrypoint avoids
Node-only code in Next's edge build. CI enforces exactly 141 Developer MCP and
25 Brain test passes with no skips.

The local issuer uses local or Better Auth browser sessions, registered redirects,
explicit project consent, S256 PKCE, one-use 60-second codes and five-minute
opaque audience-bound tokens. Exchange rechecks membership, project and switches.
Metadata has well-known aliases. Mutations separately require browser confirmation
bound to tenant/user/client/project/tool/input and consumed once. Browser forms
preserve Origin, reject cross-origin requests and retain their route-owned CSP.
OAuth redirects permit only the registered callback origin. SQL stays behind the
browser service transaction.

Better Auth forms use strict-origin referrer policy. Logout forwards to the
canonical provider path instead of parsing an original middleware-rewrite URL.
The browser regression covers rendered signup, invitation acceptance, sign-in,
logout and replay of a revoked signed session.

`create-opentenant` is a new public, unpublished package. Its original templates
use local copying with Node APIs; no third-party implementation was copied.
It consumes real pnpm tarballs, generates typed config, composition, Compose and
placeholder env files, migrates and provisions one synthetic tenant with an RLS
runtime login. Both identity choices have a real session check. The generated
host is a minimal public synthetic welcome page, not the full platform. It binds
loopback and keeps private runtime/demo identity files ignored with mode 0600.
Production credential custody and authenticated module-host ports remain full
platform work. CI times each identity in a fresh `node:22` container without host
node_modules or package-manager cache mounts and fails above 600 seconds.

## Conflicts

The CI/e2e merge was conflict-free. The MCP merge resolved:

- Developer route surface test: replaced the old absence assertion with the executable default-off and exact owner-gate regressions.
- HANDOFF: preserved both histories; the wave 4b entry is the current state.
- Migration reservations: retained Hello and reserved/used 0070 for MCP, then reserved 0071 before adding OAuth SQL. 0072+ stays free.
- Embeddings and their tests: retained explicit configuration and its regression, added deterministic local embeddings, and kept production fail-closed behavior.
- Brain host API/service/tests: preserved the package move and manifest dispatch, adapted real tools to injected host ports, and retained revoked-entitlement tests.
- Developer package manifest: kept built exports, files, licence and publish metadata while adding the branch dependencies. No per-module transpile exception was added.

Both merge messages end with the requested marketing and co-author trailers.

## Commands and measured evidence

Node 22.23.2 and pnpm 11.13.1 on the host. Verification exports
`pnpm_config_verify_deps_before_run=false`, `VITEST_MAX_FORKS=2`,
`VITEST_MIN_FORKS=1`, `NEXT_TELEMETRY_DISABLED=1` and
`TURBO_TELEMETRY_DISABLED=1`. Every database proof uses the disposable
`pgvector/pgvector:0.8.2-pg17-bookworm` image and a random non-5432 loopback port.
Counts are pass/fail/skip. Commands with no assertion suite have no invented test
count. A failed command is not a passing proof even when some assertions pass.
Structured verification commands and measured durations are in the [structured results](2026-11-11-integration-wave4b-results.json).
Raw local logs are under `/tmp/opentenant-wave4b-evidence/`.

| Run | Exact command | Exit | Counts or duration |
| --- | --- | --- | --- |
| install-final | `pnpm install --frozen-lockfile` | 0 | No test count |
| build | `pnpm turbo build` | 0 | No test count |
| quality-final | `pnpm turbo typecheck lint test --force --concurrency=2` | 0 | 2044/0/75 tests |
| matrix-final | `pnpm quality:matrix` | 0 | No test count |
| package-check | `pnpm package:check` | 0 | 23/0/0 packages |
| module-audit-final | `pnpm module:audit` | 0 | No test count |
| packed-adopter | `pnpm module:adopter-proof` | 0 | 3/0/0 tests |
| platform-build | `pnpm --filter @opentenant/platform build` | 0 | No test count |
| database-sequence-2 | `pnpm db:ephemeral -- pnpm ci:db-sequence` | 0 | 139/0/0 tests |
| rls | `pnpm db:ephemeral -- pnpm rls:proof` | 0 | 314/0/0 checks |
| mcp-brain-built | `pnpm db:ephemeral -- node tooling/ci/mcp-brain-proof.mjs` | 0 | 166/0/0 tests |
| migrations-2 | `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test --testTimeout=120000 --hookTimeout=120000` | 0 | 178/0/0 tests |
| residual-db | `pnpm db:ephemeral -- sh -c 'CUSTOM_DOMAINS_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/platform exec vitest run lib/custom-domains.integration.test.ts && KEY_ROTATION_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" pnpm --filter @opentenant/database exec vitest run src/credential-cipher-rotation.postgres.test.ts && pnpm --filter @opentenant/observability test && pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts'` | 0 | 45/0/0 tests |
| restore | `pnpm restore:drill` | 0 | No test count |
| docs-complete | `pnpm docs:links` | 0 | No test count |
| e2e | `pnpm e2e` | 0 | 19/0/0 tests |
| dx-final-local | `DX_TIMED_REPORT=/tmp/opentenant-wave4b-evidence/dx-final-local.json pnpm dx:timed` | 0 | 40.463 seconds; limit 600 |
| dx-final-better-auth | `DX_IDENTITY=better-auth DX_TIMED_REPORT=/tmp/opentenant-wave4b-evidence/dx-final-better-auth.json pnpm dx:timed` | 0 | 41.278 seconds; limit 600 |
| smoke | `SMOKE_BUILD_NETWORK=host SMOKE_APP_PORT=3496 SMOKE_POSTGRES_PORT=55496 node scripts/smoke-deploy.mjs` | 0 | No test count |
| audit-final | `pnpm audit --audit-level high` | 0 | No test count |
| gitleaks-final | `cd /tmp/opentenant-wave4b-source-final && gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | No test count |
| semgrep-final | `EIO_BACKEND=posix semgrep scan --jobs 1 --timeout 30 --config packages/usage-export/testing/security-rules.yml --config packages/auth-better-auth/semgrep.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next --exclude .agents .` | 0 | No test count |
| trivy-final | `trivy fs --offline-scan --skip-db-update --skip-check-update --skip-version-check --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git --skip-dirs graphify-out --skip-dirs .agents --skip-dirs apps/platform/.next .` | 0 | No test count |
| r11-final | `pnpm --filter @opentenant/testing exec vitest run src/r11-regressions.test.ts` | 0 | 20/0/0 tests |
| changeset | `pnpm changeset status` | 0 | No test count |
| diff-final | `git diff --check f078c8d HEAD` | 0 | No test count |
| graph | `graphify update .` | 0 | No test count |
| ripwire-final | `ripwire . --quality-delta --legend=compact` | 0 | No test count |

## Failed runs and retries

- The first forced quality run fails CLI typechecking because its config included the build config without TS-extension support. The next fails an unused E2E setup binding. The third executes 2,043 passing tests, one route-boundary failure and 75 skips. Moving the OAuth query into the service fixes that failure; the final forced run is recorded above.
- The first DB sequence stops at the model-routing fixture because resetting `public` leaves `developer_mcp` behind. Resetting both makes the complete repeat pass 139 tests, including all nine isolation-fuzz cases. The loaded-host fuzz phase takes 268.07 seconds overall, with no individual test timeout.
- The first migration proof passes 177 tests and fails only the catalogue fixture, which still expects 55 entries. Appending only the two forward checksums yields 178 passes without modifying historical SQL or checksums.
- The initial exact MCP/Brain gate expects 20 Brain tests but executes 22. The count is corrected, then expanded to 25 with three execution-mode regressions. The canonical schema regression raises Developer MCP to 141. The final built-package proof passes both exact counts.
- Browser setup first fails on Node-only imports reaching edge code, then missing fixture package dependencies, wrong registry-helper argument order, premature project insertion and remote-catalog transaction constraints. No setup failure counts as a browser pass. A concurrent forced build removes files Next is reading, producing one pass and two failures. Subsequent browser runs are serialized with builds.
- OAuth callback assertions time out twice at 15 seconds, two successive runs, with two other browser cases passing each time. Playwright routing does not intercept the redirected callback as assumed. A real random-port loopback callback receiver fixes the test. The focused suite then passes all three cases. The full nineteen-case result is recorded above. These callback timeouts and the earlier web-server startup failure are retained, not credited as passes.
- Initial DX development fails before starting a host because a fractional child timeout is invalid. The next run stalls because synchronous Docker execution blocks the Postgres relay; that run is explicitly stopped. Asynchronous execution fixes it. An early home-only proof measures 52.824 seconds; expanded identity proofs measure 57.180 and 90.249 seconds. The final current-artifact measurements above supersede those early timings.
- Initial Ripwire quality delta reports a short-horizon middleware churn heuristic. It is not recorded as a pass. The final delta against the committed runtime state passes. This is structural evidence, not an independent security review.

## Limits and open gates

Production Developer MCP enablement remains rejected without
OWNER-DEVELOPER-MCP-02 approval. No reviewed real microsandbox image was configured
for the credential/network isolation proof. Injected local sandbox tests do not
establish real VM isolation. Hosted embeddings and hosted sandbox operation remain
unconfigured. Public npm publication and provenance remain owner work.

The normal forced quality run retains 75 skipped cases. All 73 database cases
execute in dedicated proofs; real SMTP and real microsandbox remain two explicit
unverified skips. Environment-gated identity/provisioning/worker/tracing/fuzz files
also have dedicated executions. Skips are not passes. The synthetic restore drill
does not establish production RPO/RTO.

Gitleaks reports zero source findings. Semgrep runs seven local rules with zero
findings, a limited rule scan. Trivy is a scoped offline cached scan with zero
high/critical findings. No pre-commit or Promptfoo configuration exists, so neither
is claimed as a passing check. Graphify refresh uses AST extraction only and
retains existing parser/semantic metadata warnings. Generated output is excluded
from every commit.

## Commits

The following documentation commit records this final evidence. Runtime and merged-source commits:

```text
26d6df6 fix(ci): isolate integration suites and share the database sequence
e000332 feat(ai): implement gated developer MCP and tenant Brain tools
cb9011f test(e2e): cover provisioned tenant onboarding and critical journeys
4382f20 merge: integrate isolated CI and tenant browser journeys
b5eca0c merge: integrate gated developer MCP and Brain tools
5336a64 feat(mcp): integrate canonical storage local OAuth and browser confirmation
5114bf9 fix(identity): preserve browser origins and route Better Auth logout correctly
bea264c feat(dx): scaffold and time a host from packed OpenTenant packages
483d936 test(database): reset the MCP schema in usage export fixtures
750aba5 fix(mcp): keep OAuth registration queries behind the browser service
```
