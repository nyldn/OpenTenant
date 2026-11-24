# Wave 2 worker and lifecycle verification

Implementation branch: `t3/durable-tenant-lifecycle`. Node 22.23.2 and pnpm
11.13.1. The implementation is local-only. No push, PR, hosted identity request,
Neon request, or other provider API operation was performed. Only the authorized
Graphile Worker dependency download and npm audit used the public npm registry.
Twenty and Plane were not fetched and no code was copied from them.

The fixture correction is commit `10e42bf`. It selects migration numbers strictly
before the target, then applies the target. This is test-only; no applied
migration changed. The feature implementation is commit `1ef7148`.

## Delivered behavior and integration boundary

- `pnpm worker` runs Graphile Worker 0.16.6 on control-plane PostgreSQL. The
  crontab dispatches helpdesk projections per tenant. Provisioning leaves HTTP
  through a transactional queue write and a 202 job ID. Job retries are bounded,
  visible and audited. Terminal worker crashes are reconciled for operator retry.
- Owner bootstrap uses a 72-hour digest-backed claim, an identity-gateway member
  invitation, authenticated email matching, atomic single-use consumption, and a
  durable gateway owner grant. Reissue revokes prior claims/invitations. Existing
  owners cannot use bootstrap as ownership transfer. Raw tokens use private
  delivery files, not console output, URLs, audit details or queue payloads.
- Suspend/resume are installation-owner operations with audit evidence. The root
  layout renders the suspended page. `currentTenant()` fails closed for suspended
  and deleted hosts. `suspendedTenantResponse()` returns 423 and awaits integration
  into shared gates by the orchestrator. Existing APIs retain their generic
  denial status. Settings-guard, middleware, next.config, credential cipher,
  domain pages and observability were not edited.
- Export uses the restricted tenant role, JSON per table, dependent tenant-bound
  control-plane rows, credential redaction, a local sink interface, audited
  owner-only download and 24-hour expiry. The archive is a tar.gz file. This
  implementation materializes tables/downloads in memory and is not a
  point-in-time backup.
- Delete marks the tenant deleted, schedules retention, checkpoints the provider
  drop, removes private files and tenant-scoped control-plane rows, and writes a
  content-free installation audit receipt. The owner-only purge handles FK
  dependencies, self-referencing usage corrections and tables without tenant FKs.
  It preserves other tenants' rows. Shared tenant-owned modules must be retired
  before erase. The integration suite fakes the provider delete, not SQL cleanup.
- `pnpm tenant:seed-e2e` is a loopback-only synthetic operator-page fixture.

The heartbeat task and trigger route are removed. Workflow remains because the
unchanged Next configuration uses its build wrapper. The production npm audit
reports one moderate advisory, zero high and zero critical.

## Forward migrations

Control-plane migrations added:

- `0040_worker_jobs.sql`
- `0041_owner_bootstrap.sql`
- `0042_tenant_lifecycle.sql`
- `0043_tenant_erase.sql`
- `0044_tenant_erase_self_references.sql`

This worktree deliberately leaves 0030-0039 unused. Other branches can supply
those numbers. Reserved tenant-core 0010-0011 are unused. The orchestrator may
renumber new migrations before merge.

## Database commands

All URLs below use synthetic local credentials. The final task-owned service
used a bounded tmpfs data volume to avoid shared-host disk checkpoint stalls.
PostgreSQL fsync settings were unchanged. Its image and host port are the
required values. Earlier disk-backed task containers were removed.

```sh
docker run -d --name opentenant-wave2-1764596a-ram-pgvector-55440 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1g \
  -p 127.0.0.1:55440:5432 -e POSTGRES_DB=opentenant_ci \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  --health-cmd 'pg_isready -U postgres -d opentenant_ci' \
  --health-interval 2s --health-timeout 3s --health-retries 20 \
  pgvector/pgvector:0.8.2-pg17-bookworm

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_ci \
  node tooling/ci/rls-proof.mjs
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres \
  node tooling/ci/create-integration-databases.mjs

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-wave2-1764596a/store-reports-final \
  pnpm database:store-proof

VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 \
CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test

TENANT_WORKER_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_wave2_control \
PROVISIONING_TENANT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_wave2_tenant \
  pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts

PROVISIONING_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_provisioning_control \
PROVISIONING_TENANT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/opentenant_it_provisioning_tenant \
  pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts
```

The worker-proof databases are created separately with `create database` through
the task container's `psql`. Each provisioning proof starts with fresh control
and tenant databases. Run the two provisioning paths sequentially: their
synthetic tenant_app login is cluster-global and its password rotates on initial
role creation. Run RLS first because it requires a fresh cluster with no existing
tenant_app role.

| Proof | Result |
| --- | --- |
| RLS | 314 checks, 31 tenant tables, passed |
| Database stores | 30 assertions, 7 suites, zero skipped, passed |
| Migrations | 148 tests, 21 files, zero skipped, passed |
| Worker integration | 6 cases, zero skipped, passed |
| Provisioning integration | 1 case, 9 assertions, zero skipped, passed |
| Migration fixture | 8 focused tests passed |

The six worker cases exercise real Graphile queue migration/dispatch, canonical
provisioning with only identity/Neon APIs faked, token revocation/expiry/email
matching/single use/audit chains, helpdesk idempotence, restricted-role archive
creation/redaction/expiry, last-attempt crash reconciliation, and checkpointed
erase after a simulated sink failure. Erase also removes immutable usage
corrections and a non-FK replay guard while preserving another tenant's guard.

The first focused test run failed because the new modules did not exist. Later
runs exposed the usage correction self-reference, non-FK cleanup, and PostgreSQL
name-array decoding. The final tests cover those corrections. Early broad runs
also hit five-second unchanged-test timeouts under host load, disk WAL/checkpoint
stalls, and ignored Workflow-generated route files during dev-server linting.
The server was stopped and only its generated routes removed before the final
quality run. No assertion was weakened and no existing test timeout was edited.

## Browser and bounded security checks

The Playwright MCP request timed out. The isolated fallback session
`opentenant-wave2-1764596a` opened the synthetic operator page, observed the failed
job, clicked Retry, and observed pending status and zero attempts. SQL readback
confirmed `tenant.job_retried`. The fallback session and dev process were closed.
The seed and worker-migration commands contacted only loopback PostgreSQL.

Evidence is under `/tmp/opentenant-wave2-1764596a`, including
`operator-jobs.png`, `browser.log`, `browser-database.log`, per-suite JSON store
reports and command logs. This is local browser evidence, not a hosted proof.

```sh
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org

gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json \
  --report-path /tmp/opentenant-wave2-1764596a/gitleaks-final.json

SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 \
  semgrep scan --jobs 1 --timeout 0 --config /tmp/opentenant-semgrep.yaml \
  --metrics off --disable-version-check --exclude node_modules --exclude .agents \
  --exclude graphify-out --exclude '*.test.ts' --exclude '*.test.tsx' \
  --exclude apps/platform/.next --error --json \
  --output /tmp/opentenant-wave2-1764596a/semgrep-product.json .

TRIVY_SKIP_VERSION_CHECK=true trivy fs --offline-scan --skip-db-update \
  --skip-java-db-update --skip-check-update --scanners vuln --severity HIGH,CRITICAL \
  --exit-code 1 --skip-dirs node_modules --skip-dirs .git \
  --skip-dirs apps/platform/.next --format json \
  --output /tmp/opentenant-wave2-1764596a/trivy.json .

ripwire . --quality-delta --legend=compact
ripwire . --edit-check=./apps/platform/lib/tenant.ts:currentTenant
graphify update .
```

Gitleaks ran on a repository-relative snapshot of tracked and non-ignored source,
including new files, and found zero leaks. Semgrep ran five local rules across
377 product/tooling files with zero findings; it has pre-existing partial-parse
warnings in Assessment and Support. An earlier unrestricted-concurrency scan
failed to allocate io_uring memory. The bounded scan covered the new export,
owner-invite and worker files. Trivy used its cached database and reported zero
high/critical vulnerabilities. These bounded scans are not a full security audit.
Ripwire reported zero gating regressions before the feature commit; the tenant
entry point has no signature change or incompatible callers. No pre-commit or
Promptfoo configuration exists. Graphify used AST extraction only.

## Workspace gates

```sh
VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 \
VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 \
  pnpm turbo typecheck lint test --force --env-mode=loose --concurrency=2

NEXT_TELEMETRY_DISABLED=1 WORKFLOW_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  pnpm turbo build --filter=@opentenant/platform

git diff --check
git diff --cached --check
```

The uncached workspace run passed all 63 tasks with 1,534 Vitest tests and 137
Node tests, zero failures and zero cache hits. Dedicated DB commands above
execute the integration files that skip without URLs in the broad run. The
focused platform set passed 62 tests in 11 files; the full platform package
passed 434 tests in 70 files.

The first production build compiled successfully, then failed on unused
eslint-disable headers emitted into generated Workflow route.js files. The
operator authorized a separate tooling commit that ignores only the exact
three generated output paths and comments that `withWorkflow` creates them.
Hand-written source remains linted. The next config and middleware remain
unchanged. After heartbeat removal, no application code imports Workflow or
uses `use workflow` / `use step`; only the next.config wrapper and its config-test
mock remain. Removing that wrapper, mock and dependency is an integration item
for the orchestrator.

The generated-handler ignore is commit `8fdd09e`. `eslint --print-config` returns
`undefined` for the literal generated webhook path, while the hand-written
helpdesk projection retains 112 configured lint rules. `pnpm worker --migrate`
and `pnpm worker --once` were also exercised against loopback PostgreSQL.

After the generated-file ignore, `pnpm turbo lint --force --concurrency=2`
passed all 21 lint tasks uncached. The task-owned Postgres containers were
removed after database verification. Final cleanup used:

```sh
docker rm -f opentenant-wave2-1764596a-ram-pgvector-55440
docker ps -a --filter name=opentenant-wave2-1764596a --format '{{.Names}}'
```

The readback returned no task container.

The final platform production build passed 1/1 task, uncached, with all 26 static
pages generated. It retains a non-blocking Next ESLint-plugin detection warning;
the separate workspace lint run passed. `git diff --check` and
`git diff --cached --check` passed. Build telemetry was disabled.
