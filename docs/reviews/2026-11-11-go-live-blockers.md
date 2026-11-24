# Go-live blocker implementation evidence

Branch: `t3/fix-go-live-blockers`. Base: `89785b35b`.
The original branch's verification below is historical. The subsequent
[merge verification](2026-11-11-merge-proofs.md) passed every pgvector-dependent
proof after correcting the provisioning test's stored-credential decoding.
Local-only work, without pushes, PRs, provider operations, or external downloads.
Runtime: Node `v22.23.2`, pnpm `11.13.1`. Dependencies came from the offline
pnpm cache. All historical SQL migration files remain unchanged.

## Findings and implementation

1. Confirmed. Tenant domain creation and commit reconciliation use
   `OPENTENANT_TENANT_BASE_DOMAIN`. It defaults to `example.test` only outside
   production. Production requires a valid DNS hostname. Slugs must form a valid
   hostname. Middleware accepts generic valid tenant hostnames; it did not have
   an `example.test` suffix rule. Other source occurrences are synthetic
   examples, local identity email defaults, or in-memory test-adapter defaults.
2. Confirmed. The shared production schema path applies core, seeds metadata,
   creates the application role if absent, then applies brain and support.
   Canonical module migrations provide schema/table grants and retain explicit
   append-only revocations. Resumed legacy jobs recheck all catalogs without
   rotating stored credentials. The RLS proof uses this path after establishing
   its legacy fixture. The new integration test drives the platform service,
   uses real control/tenant databases, and fakes only the Neon API. It checks
   restricted-role support insertion, missing/wrong context rejection, denied
   deletion, brain access, role attributes, and unchanged login on resume.
3. Confirmed. Liveness stays `/api/health`. `/api/ready` opens a dedicated
   control-plane probe with 750 ms connection, query and server statement
   timeouts. Failure returns uncached 503 with a fixed body. Both routes retain
   host validation; there was no health exemption to extend.
4. Confirmed. A server-only typed validator declares deployment identity,
   database, encryption, provisioning, module, local identity and OAuth settings.
   Runtime instrumentation validates production requirements at startup. Server
   composition reads use it; browser/edge provider selection remains separate.
   Only the selected hosted identity provider's secrets are required. Local
   identity is rejected in production. `.env.example` contains names and
   comments without credential values.
5. Confirmed. `migrate:hosted` is separate from the unchanged loopback-only local
   command. It confirms every URL host before connecting, rejects URL connection
   overrides, checks checksums/ordering, supports read-only planning and
   canary-first sequential fleet rollout, and emits secret-free progress.
   Fleet manifests contain owner URLs and must be protected and ignored.
6. The schema/adapter difference is real but intentional for this fix.
   Automated Neon provisioning continues to reject `ap`, with an explicit API
   regression test and runbook explanation. Storage support does not choose an
   approved Neon region. No mapping or provider enablement was invented.

## Tests added

- Server configuration: 17 test cases covering production requirements,
  selected-provider settings, invalid hostnames/slugs, development defaults,
  encryption-key validation and secret-free errors.
- Readiness: 4 test cases covering success, bounded settings, connect/query
  failure, missing configuration and response redaction/cache headers.
- Middleware: 2 test cases covering both health paths with valid configured
  suffixes and malformed host denial.
- Tenant API: explicit `ap` rejection; configured domain creation and ambiguous
  commit reconciliation assertions in the existing route suite.
- Provisioning: completed-checkpoint revalidation, 3 role setup/connection tests,
  and 1 real database integration test with only Neon faked.
- Hosted migrations: 4 unit tests and 2 real database tests covering
  host confirmation, connection overrides, argument validation, dry-run with no
  writes, repeatability, checksum drift, canary ordering and halt-on-failure.

## Commands and results

The task-owned container was created using the cached image, without pulling:

```sh
docker run --pull=never --name opentenant-golive-010de34a \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=opentenant_ci -p 127.0.0.1:55439:5432 -d postgres:17-alpine
pnpm install --offline --frozen-lockfile --ignore-scripts
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/postgres \
  node tooling/ci/create-integration-databases.mjs
```

All credentials above are disposable local synthetic credentials.

| Command | Result |
| --- | --- |
| `pnpm turbo typecheck lint test` | PASS, 63/63 tasks, 1,600 passing tests across Vitest and Node test runners. Integration suites needing unset dedicated URLs are skipped here, and are reported separately below. |
| `pnpm turbo build --filter=@opentenant/platform` | PASS, 1/1 build task. |
| `git diff --check` | PASS after correcting trailing whitespace. |
| Migration command below | PASS, 21 files, 148 tests, zero skipped files. |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_ci pnpm rls:proof` | FAIL, missing `vector` extension; 3 setup/cleanup checks completed, full RLS assertions did not run. |
| Database-store command below | FAIL at pgvector preflight, zero store assertions executed. |
| Provisioning integration command below | FAIL, 1 test reached real schema provisioning and stopped at missing `vector`. Its restricted-role support assertions remain unproved locally. |
| Hosted CLI dry-run below | PASS, listed 29 control-plane migrations without writing a tracking table. |

```sh
CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-golive-store-reports \
  pnpm database:store-proof

PROVISIONING_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_provisioning_control \
PROVISIONING_TENANT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_provisioning_tenant \
  pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts

CONTROL_PLANE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/opentenant_it_control_plane \
  pnpm migrate:hosted control-plane --target 127.0.0.1:55439 --dry-run
```

RLS requires a fresh cluster role namespace. It was run after clearing only the
synthetic `tenant_app` role and its grants in this task-owned container, before
running provisioning. CI uses separate pgvector/Postgres 17 services per job.
The new provisioning test is included in the database-store CI job with two
separate databases. Its local failure is not a waiver of the go-live proof gate.

## Security and structural checks

- Gitleaks ran on the repository and on a source snapshot made from
  `git ls-files -co --exclude-standard`. The raw working-directory scan found
  generated `.next` build keys. Running `gitleaks dir . --redact --no-banner`
  inside the source snapshot passed with zero findings using the repository's
  existing allowlists. No allowlist was broadened.
- `semgrep scan --config /tmp/opentenant-semgrep.yaml --metrics=off
  --disable-version-check --no-git-ignore --exclude node_modules --exclude .next
  --exclude .git --exclude graphify-out --exclude .agents --json
  --output /tmp/opentenant-golive-semgrep.json .` passed with zero findings.
  The five locally available rules check dynamic evaluation, disabled TLS,
  credential logging, shell subprocesses and sandbox origin bypass. This was
  a scoped local ruleset, not the hosted registry ruleset.
- `trivy fs --offline-scan --skip-db-update --skip-java-db-update
  --skip-check-update --skip-version-check --scanners vuln,misconfig --format json
  --output /tmp/opentenant-golive-trivy.json --skip-dirs node_modules
  --skip-dirs .next --skip-dirs .git .` completed using cached databases.
  It reported 56 vulnerabilities: 9 critical, 21 high, 22 medium, 4 low.
  The same scan of base `89785b3` reported the identical 56 package/version/CVE
  findings. This change introduced zero findings. These are outstanding baseline
  findings, not a clean dependency security verdict.
- No `.pre-commit-config.yaml` or Promptfoo configuration exists.
- `graphify update .` refreshed the AST graph without provider calls. It
  reported unavailable `tree_sitter_sql` and existing extraction warnings.
- `ripwire . --quality-delta` reported clone/verbosity heuristics in identity
  initialization, CI and the lockfile, plus complexity in the new validator and
  CLI. Those were reviewed against passing type checks and behavioral tests.
  `ripwire . --edit-check=prepareTenantDatabase` and
  `ripwire . --edit-check=provisionTenant` found no incompatible callers.

Marketing impact: truth. No production readiness claim is made until the three
pgvector-dependent proof suites pass in an authorized environment.
