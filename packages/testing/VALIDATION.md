# Wave-2 test hardening verification

Branch: `t3/cross-tenant-test-hardening`. Local synthetic data only; no push,
PR, provider API request or deployment. Marketing impact: none.
Node v22.23.2, pnpm 11.13.1. Logs and JSON evidence are under
`/tmp/opentenant-wave2-*` and `/tmp/opentenant-isolation-proof`.

| Proof | Executed result |
| --- | --- |
| Identity contract | 36 passed: 12 cases each for Local, WorkOS and Clerk. No network and no skips. |
| Focused test hardening | 60 passed: identity 36, regression index 16, dependency floor 1, license policy 7. |
| Isolation, random seed 336489630 | 9 passed, zero skipped; 175 generated family sequences and 5 malformed-ID sequences. |
| Isolation, CI seed 20261111 | 9 passed, zero skipped; same exact inventory and property run counts. |
| RLS proof | 314 checks across 31 tenant tables. |
| Database-store proof | 30 assertions, 7 suites, zero skipped. Admission 3, usage 2, model routing 4, ownership 1, capability 2, brand 11, helpdesk 7. |
| Migration suite | 148 tests, 21 files, zero skipped. |
| Provisioning integration | 1 test, 9 executed expectations, zero skipped. |
| Platform build | 1/1 task passed. |
| Initial full uncached workspace gate | 63/63 tasks, 1,580 Vitest tests and 137 Node tests passed. This preceded the seven license-policy tests. |
| Final workspace gate | 63/63 uncached tasks passed; 1,587 Vitest tests and 137 Node tests. Turbo concurrency 1 and one Vitest worker. |
| Gitleaks | Zero findings in the final source snapshot with repository-relative allowlists. |
| Semgrep | Five rules, 401 paths, zero findings; six parse/timeout warnings in pre-existing files. Focused auth and new script scan: 20 paths, zero findings and zero errors. |
| Trivy | Zero high/critical production dependency findings, cached offline vulnerability database. |
| Ripwire | Zero gating findings. Advisory complexity in two new test helpers and CI job length. |

The initial identity contract run failed six cases. Separate production-fix
commits reject owner invites, normalize injected provider-port failures, and
bind WorkOS memberships to exactly one authenticated subject. The final
contract and all 152 existing auth tests passed.

The index marks ten findings fixed with named regression evidence. R11-04,
R11-12, R11-13, R11-14 and R11-15 remain explicitly open on this branch.
It does not claim that parallel agents' unmerged fixes are present.

The first fuzz fixture attempts exposed fixture mistakes involving the
singleton tenant anchor, support foreign keys, brand review/parser state,
and the voice-profile word grammar. The final fixture uses separate production
provisioning paths and leaves every schema constraint intact. Restricted
runtime callers cannot access control-plane stores; trusted control-plane
calls exercise explicit tenant scoping separately. See README.md for that
boundary and the local cluster-wide role credential detail.

Two later workspace reruns encountered five-second platform timeouts and an
unrelated Assessment abort-test race, respectively, on the overloaded shared
host. A final bounded run uses one Turbo task and one Vitest worker at a time.
All 63 tasks passed in that final run. No unrelated test or production source was changed to conceal those failures.

The RLS proof requires a fresh cluster without `tenant_app`, so it ran before
provisioning. An earlier local attempt correctly refused the already-used
cluster; the successful proof used a fresh task-owned container. The container
was removed after all database proofs. No pre-commit or Promptfoo configuration
exists. Graphify updates use AST extraction only; the existing missing SQL
parser, symbol-less files and nine nodes without source metadata remain warnings.

Exact successful proof commands, plus the workspace reruns:

```sh
docker run -d --name opentenant-wave2-test-1876b7c7-55444 \
  -p 127.0.0.1:55444:5432 -e POSTGRES_DB=opentenant_ci \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  --health-cmd 'pg_isready -U postgres -d opentenant_ci' \
  --health-interval 2s --health-timeout 3s --health-retries 20 \
  pgvector/pgvector:0.8.2-pg17-bookworm

pnpm install
pnpm --filter @opentenant/auth test
pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts src/r11-regressions.test.ts src/dependency-security.test.ts src/dependency-license.test.ts
pnpm --filter @opentenant/testing typecheck
pnpm --filter @opentenant/testing lint
pnpm turbo typecheck lint test --force
pnpm turbo typecheck lint test --force --concurrency=2
VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 \
  pnpm turbo typecheck lint test --force --concurrency=1 --env-mode=loose
pnpm turbo build --filter=@opentenant/platform

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_ci \
  node tooling/ci/rls-proof.mjs
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/postgres \
  node tooling/ci/create-integration-databases.mjs
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/postgres \
  node packages/testing/scripts/isolation-proof.mjs
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/postgres \
ISOLATION_FUZZ_SEED=20261111 \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-wave2-ci-reports \
  node packages/testing/scripts/isolation-proof.mjs

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-wave2-store-reports \
  pnpm database:store-proof

CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test
PROVISIONING_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_provisioning_control \
PROVISIONING_TENANT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/opentenant_it_provisioning_tenant \
  pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts

docker rm -f opentenant-wave2-test-1876b7c7-55444
node packages/testing/scripts/dependency-proof.mjs /tmp/opentenant-wave2-property-test.cdx.json
git diff --check
git diff --cached --check
ripwire . --quality-delta --legend=compact
ripwire packages/auth --edit-check=packages/auth/src/clerk/gateway.ts:invite
graphify update .
```

The source snapshot contains `git ls-files -co --exclude-standard` paths, copied
with their repository-relative names into `/tmp/opentenant-wave2-scan`. No
security allowlist changed. The first absolute-path scan hit existing browser
storage-key false positives because the relative allowlists did not match;
the final scan below runs inside the snapshot and has zero findings.

```sh
# cwd: /tmp/opentenant-wave2-scan
gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json \
  --report-path /tmp/opentenant-wave2-gitleaks-final.json
# cwd: repository root
SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 EIO_BACKEND=posix \
  semgrep scan --jobs 1 --timeout 30 --config /tmp/opentenant-semgrep.yaml --metrics off \
  --disable-version-check --exclude node_modules --exclude graphify-out \
  --exclude '*.test.ts' --exclude '*.test.tsx' --exclude apps/platform/.next \
  --error --json --output /tmp/opentenant-wave2-semgrep-final.json .
TRIVY_SKIP_VERSION_CHECK=true trivy fs --offline-scan --skip-db-update \
  --skip-java-db-update --skip-check-update --scanners vuln \
  --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git \
  --skip-dirs apps/platform/.next --format json \
  --output /tmp/opentenant-wave2-trivy.json .
```

The first Semgrep attempt failed to allocate an io_uring queue. The final broad
scan used the POSIX backend and one worker, scanning 401 paths with no findings.
It reported a timeout and a parse warning in vendored Archify files, and four
partial-parse warnings in existing Assessment and Support files. A focused
scan of the auth sources and new test scripts passed with zero engine errors.

```sh
SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 EIO_BACKEND=posix \
  semgrep scan --jobs 1 --timeout 30 --config /tmp/opentenant-semgrep.yaml \
  --metrics off --disable-version-check --exclude '*.test.ts' --exclude '*.test.tsx' \
  --error --json --output /tmp/opentenant-wave2-semgrep-owned.json \
  packages/auth/src packages/testing/scripts .github/workflows/ci.yml
```
