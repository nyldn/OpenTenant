# Local verification, 2026-11-11

Runtime: Node v22.23.2, pnpm 11.13.1. All data and credentials were synthetic.
No E2B cloud or OpenMeter cloud API was called. No push or PR was made.

## Results

| Check | Result |
| --- | --- |
| Full uncached quality run | 69 tasks passed; 1717 tests passed |
| Sandbox package | 146 passed, one real microsandbox lifecycle test not run |
| Four-provider shared conformance | 24 passed within sandbox package |
| Usage export | 14 passed, including six real PostgreSQL/mock-HTTP cases |
| Platform production build | Passed; 27 static pages generated |
| Canonical migration suite with real Postgres | 142 passed, six blocked by one failing upgrade-fixture setup |
| Proposed upgrade-fixture correction in scratch copy | Eight passed, zero skipped |
| Database-store proof | Seven suites, 30 assertions, zero skipped |
| Restricted-role RLS proof | 314 checks across 31 tenant tables, zero skipped |
| Production audit at high threshold | Zero high/critical; one moderate |
| Trivy repository vulnerability/misconfiguration scan | Zero high/critical findings |
| Gitleaks on Git-selected source snapshot | Zero leaks |
| Focused Semgrep on owned code | Zero findings and zero errors across 40 files |
| Broad Semgrep with five local rules | Zero findings across 611 files; one existing generated-file timeout and four existing partial-parse warnings |
| Ripwire quality delta | Zero gating regressions; new-symbol complexity and size advisories remain |

The full quality run registered one skipped microVM test and skipped 20
other integration files behind their existing environment gates. Database
checks listed separately above actually ran; they are not inferred from Turbo.

The real microVM test was not run because no approved image was cached.
The SDK itself loaded with the local backend and returned an empty image list.
Its tests refuse image pulls. Hosted isolation and real OpenMeter aggregation
or dedupe behavior are not established by these local checks.

## Reproduce the database setup

The actual disposable container was `opentenant-usage-proof-dd782`, using
`pgvector/pgvector:0.8.2-pg17-bookworm`, published at loopback port 32771.
It was removed after verification. A fresh reproduction must discover its own
random port instead of binding host port 5432.

```sh
docker run --detach --name opentenant-usage-proof-dd782 \
  --env POSTGRES_PASSWORD=synthetic-local-only --publish 127.0.0.1::5432 \
  pgvector/pgvector:0.8.2-pg17-bookworm
docker port opentenant-usage-proof-dd782 5432
```

Create the following databases with `docker exec ... createdb -U postgres`:

```text
opentenant_it_usage_export
opentenant_it_control_plane
opentenant_it_tenant_core
opentenant_it_tenant_support
opentenant_it_store_admission
opentenant_it_store_usage
opentenant_it_store_model_routing
opentenant_ops04_store_ownership
opentenant_ops05_store_capability
opentenant_it_store_brand_proposal
opentenant_ops06_store_helpdesk_projection
```

The RLS proof used a second fresh container, `opentenant-usage-rls-dd782`,
on random loopback port 32788 with database `opentenant_it_rls`. The first
cluster already had the global `tenant_app` fixture role, so the proof correctly
refused to reuse it. Both containers used the same CI image and were removed.

The exact connection prefix used in the commands below was:

```sh
proofBase=postgresql://postgres:synthetic-local-only@127.0.0.1:32771
export pnpm_config_verify_deps_before_run=false
```

## Commands

```sh
pnpm --filter @opentenant/sandbox test
USAGE_EXPORT_DATABASE_URL="$proofBase/opentenant_it_usage_export" \
  pnpm --filter @opentenant/usage-export test

VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 \
USAGE_EXPORT_DATABASE_URL="$proofBase/opentenant_it_usage_export" \
  pnpm turbo typecheck lint test --force --env-mode=loose --concurrency=1

NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @opentenant/platform build

CONTROL_PLANE_INTEGRATION_DATABASE_URL="$proofBase/opentenant_it_control_plane" \
TENANT_CORE_INTEGRATION_DATABASE_URL="$proofBase/opentenant_it_tenant_core" \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL="$proofBase/opentenant_it_tenant_support" \
  pnpm --filter @opentenant/migrations test --testTimeout=60000 --hookTimeout=60000

ADMISSION_STORE_DATABASE_URL="$proofBase/opentenant_it_store_admission" \
USAGE_STORE_DATABASE_URL="$proofBase/opentenant_it_store_usage" \
MODEL_ROUTING_STORE_DATABASE_URL="$proofBase/opentenant_it_store_model_routing" \
MODULE_OWNERSHIP_STORE_DATABASE_URL="$proofBase/opentenant_ops04_store_ownership" \
MODULE_CAPABILITY_STORE_DATABASE_URL="$proofBase/opentenant_ops05_store_capability" \
BRAND_PROPOSAL_STORE_DATABASE_URL="$proofBase/opentenant_it_store_brand_proposal" \
HELPDESK_PROJECTION_STORE_DATABASE_URL="$proofBase/opentenant_ops06_store_helpdesk_projection" \
  pnpm database:store-proof

DATABASE_URL=postgresql://postgres:synthetic-local-only@127.0.0.1:32788/opentenant_it_rls \
  pnpm rls:proof

pnpm audit --prod --audit-level high
git diff --check
graphify update .
graphify check-update .
ripwire . --quality-delta --legend=compact
ripwire . --edit-check=defineSandboxAdapterConformance
```

The first full quality run hit two unrelated five-second platform-test
timeouts, and the first database runs hit ten-second setup-hook limits under
concurrent host load. The final full run serializes Turbo tasks. Migration
retry used explicit 60-second hook/test budgets. The store proof passed on its
second complete run without changing test code or database requirements.

## Integrator wiring

Apply [the prepared fixture patch](testing/migration-upgrade-fixture.patch)
to `tooling/migrations/src/control-plane-model-routing-store.integration.test.ts`.
The upgrade fixture must apply only the prefix before 0029, then apply 0029.
It currently applies 0065 before 0029, so the runner correctly refuses the
out-of-order migration and all six database cases in that fixture are blocked.
This unowned file was left unchanged in the worktree.

The patch was applied only to a Git-selected source snapshot in
`/tmp/opentenant-adapters-source-scan`. The corrected fixture was verified with:

```sh
CONTROL_PLANE_INTEGRATION_DATABASE_URL="$proofBase/opentenant_it_control_plane" \
  tooling/migrations/node_modules/.bin/vitest run \
  --root /tmp/opentenant-adapters-source-scan/tooling/migrations \
  --configLoader runner src/control-plane-model-routing-store.integration.test.ts \
  --testTimeout=60000 --hookTimeout=60000
```

Separately, connect `configuredVendorSandbox` to the sandbox composition root,
supply reviewed image mappings and E2B preview mediation, and schedule
`runUsageExport` from the worker after applying migration 0065. None of those
wiring points enables hosted resources or billing without its owner gate.

## Security scan commands

Gitleaks scans the Git-selected source snapshot from inside that directory so
the repository's path-specific allowlists retain their intended meaning.
The raw worktree scan also found generated Next.js preview/RSC cache tokens;
those ignored build artifacts are not source credentials.

```sh
git ls-files --cached --others --exclude-standard -z \
  | tar --null --verbatim-files-from -T - -cf - \
  | tar -xf - -C /tmp/opentenant-adapters-source-scan
(cd /tmp/opentenant-adapters-source-scan && gitleaks dir . --redact --no-banner)

SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 \
  semgrep scan --jobs 2 --timeout 15 \
  --config packages/usage-export/testing/security-rules.yml \
  --metrics=off --disable-version-check --error \
  packages/sandbox packages/usage-export apps/platform/lib/server-config.ts

trivy fs --scanners vuln,misconfig --severity HIGH,CRITICAL \
  --skip-dirs node_modules --skip-dirs .git --skip-dirs graphify-out \
  --skip-dirs apps/platform/.next .
```

There is no `.pre-commit-config.yaml` or Promptfoo configuration in this
checkout. No corresponding checks were available to run. Graphify was refreshed
locally; generated graph files are excluded from the commit.

Marketing impact: truth.
