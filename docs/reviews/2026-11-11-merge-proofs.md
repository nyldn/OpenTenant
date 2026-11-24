# Security and go-live merge verification

Branch: `t3/review-reusable-framework`, merging `t3/fix-go-live-blockers`
after `t3/harden-security-batch`. Marketing impact: truth.
Runtime: Node `v22.23.2`, pnpm `11.13.1`. No push, PR, production operation,
provider API request or genuine tenant data was involved.

## Resolutions and follow-up fixes

- `.env.example` retains the union of variable names and comments, including
  `MODULE_ACCESS_SECRET`, `CONNECTIONS_STATE_SECRET` and
  `OPENTENANT_TENANT_BASE_DOMAIN`. Every assignment has an empty value.
- Both signing-secret readers retain `serverConfig()` and require their
  dedicated secret in production. The validator requires the connection-state
  secret and rejects values shorter than 32 characters.
- The initial focused run failed eight tests because older production fixtures
  lacked the complete installation configuration and its new state secret.
  The follow-up uses the shared production fixture and adds missing, empty
  and 31-character state-secret cases. The final focused run passed 37 tests.
- The first pgvector provisioning run exposed double base64 encoding in the
  test's SQL read. Production stores the base64 wire string as bytea, and its
  reader converts those bytes to UTF-8. The corrected integration test uses
  that existing format. No production credential format changed.
- The provisioning case enforces nine executed expectations, checks the
  encrypted record is unchanged on resume, and connects with the original
  decrypted application URI. A support ticket insert succeeds with tenant
  context. Missing/wrong context and deletion are denied; the login is neither
  superuser nor BYPASSRLS. Each final provisioning run started with newly
  created control-plane and tenant databases.

## Workspace gates

| Exact command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; lockfile unchanged. |
| `pnpm --filter @opentenant/platform exec vitest run lib/connections-secret.test.ts lib/module-access.test.ts lib/server-config.test.ts` | PASS; 3 files, 37 tests. |
| `pnpm turbo typecheck lint test --force` | PASS; 63/63 tasks, no cache hits, 1,527 Vitest tests and 137 Node tests, zero failures. Twenty DB suite files skip without URLs in this command; the dedicated runs below execute all of them. |
| `pnpm turbo build --filter=@opentenant/platform` | PASS; 1/1 task, Next 15.5.29. |
| `pnpm --filter @opentenant/platform typecheck` | PASS after the integration-test decoding correction. |
| `pnpm --filter @opentenant/platform lint` | PASS after the integration-test decoding correction. |
| `git diff --name-only --diff-filter=U` | PASS; empty output. |
| `grep -rn '^<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.json' --include='*.mjs' .` | PASS; no matches, grep exit 1. |
| `git diff --check` and `git diff --cached --check` | PASS. |

## Database proofs

The service image and synthetic credentials match `.github/workflows/ci.yml`.
Only the host port differs. The task-owned container used loopback port 55436;
no host port 5432 or pre-existing container was used. It was removed afterward.

```sh
docker run -d --name opentenant-merge-72e2bd70-pgvector-55436 \
  -p 127.0.0.1:55436:5432 -e POSTGRES_DB=opentenant_ci \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  --health-cmd 'pg_isready -U postgres -d opentenant_ci' \
  --health-interval 2s --health-timeout 3s --health-retries 20 \
  pgvector/pgvector:0.8.2-pg17-bookworm

ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/postgres \
  node tooling/ci/create-integration-databases.mjs

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_ci \
  node tooling/ci/rls-proof.mjs

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-merge-proof-72e2bd70/store-reports \
  pnpm database:store-proof

CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test

docker exec opentenant-merge-72e2bd70-pgvector-55436 psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c 'drop database opentenant_it_provisioning_control' \
  -c 'drop database opentenant_it_provisioning_tenant' \
  -c 'create database opentenant_it_provisioning_control' \
  -c 'create database opentenant_it_provisioning_tenant'
PROVISIONING_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_provisioning_control \
PROVISIONING_TENANT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55436/opentenant_it_provisioning_tenant \
  pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts

docker rm -f opentenant-merge-72e2bd70-pgvector-55436
```

| Proof | Executed result |
| --- | --- |
| RLS | PASS; 314 checks across 31 tenant tables. |
| Database stores | PASS; 30 assertions, 7 suites, zero skipped. Per-suite counts: admission 3, usage 2, model routing 4, ownership 1, capability 2, brand proposal 11, helpdesk projection 7. JSON reports verify the exact inventory. |
| Migration execution | PASS; 148 tests in 21 files, zero skipped. Includes 102 integration cases in 12 files and 46 unit/static cases in 9 files. |
| Provisioning | PASS; 1 integration case, 9 executed expectations, zero skipped. Only the Neon API is faked. |

## Additional checks and limits

Gitleaks scanned all 990 non-ignored repository files from a temporary snapshot,
using repository-relative paths and `.gitleaks.toml`. It found zero leaks.
The initial raw-directory scan reported three generated Next cache-key entries
under ignored `.next/cache`; none is a tracked source credential. No security
allowlist was changed.

Semgrep ran five local security rules from the preceding security review,
scanning 395 production files with zero findings. Trivy used its cached
vulnerability database and found zero high/critical vulnerabilities. These
bounded scans do not establish a full application-security verdict.

```sh
# Run from the source snapshot for correct relative-path allowlists:
gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json \
  --report-path /tmp/opentenant-merge-proof-72e2bd70/gitleaks-source.json
SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 \
  semgrep scan --config /tmp/opentenant-semgrep.yaml --metrics off \
  --disable-version-check --exclude node_modules --exclude graphify-out \
  --exclude '*.test.ts' --exclude '*.test.tsx' --exclude apps/platform/.next \
  --error --json --output /tmp/opentenant-merge-proof-72e2bd70/semgrep.json .
TRIVY_SKIP_VERSION_CHECK=true trivy fs --offline-scan --skip-db-update \
  --skip-java-db-update --skip-check-update --scanners vuln \
  --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git \
  --skip-dirs apps/platform/.next --format json \
  --output /tmp/opentenant-merge-proof-72e2bd70/trivy.json .
ripwire . --quality-delta --legend=compact
ripwire . --edit-check=serverConfig
graphify update .
```

Ripwire quality delta against the pre-merge HEAD exits 2 with three inherited
gating heuristics: duplication and a helper-clone finding between
`localIdentityConfig` and `workosPort`, plus CI job length. These match the
incoming branch's recorded static findings. No unrelated refactor was made.
The server-config contract check found 18 callers and zero incompatible calls.
The final follow-up changes fixtures, tests and verification documentation only.
No pre-commit or Promptfoo configuration exists.

`graphify update .` passed without triggering its shrink guard, producing
6,154 nodes, 13,577 edges and 363 communities. It used AST extraction only.
Warnings remain for the missing SQL parser, 62 files without extracted symbols
and nine semantic nodes missing source-file metadata. They do not represent
failed application checks.

Detailed local logs are under `/tmp/opentenant-merge-proof-72e2bd70`.
