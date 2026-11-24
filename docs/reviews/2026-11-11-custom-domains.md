# Custom domains and tenant token implementation proof

Marketing impact: truth. Local synthetic work only; no push, PR, hosting API,
real DNS query in tests, provider resource, deployment, or genuine tenant data.

## Delivered scope and limits

- Owner/admin custom-subdomain add, TXT verify and remove, tenant-bound and
  atomic with audit evidence. Random challenges are stored only as hashes.
- Migration `0048_custom_domain_challenges` adds challenge evidence and routing
  expiry. `0049` is unused. Legacy custom mappings require a fresh proof.
- Pure periodic verification decision, injected DNS at the service boundary,
  no worker wiring. Verification expires after 48 hours, next check after 24.
- Custom-host lookup bypasses the existing cache and checks expiry immediately.
- Sign-in/settings canonicalize to the tenant's verified platform subdomain.
  Return paths stay there with host-only cookies. Custom callbacks never relay
  OAuth code/state. The owner's connection callback topology remains open.
- Root layout renders validated color/font CSS variables on all tenant pages.
- Provider-neutral hosting port with a disabled-by-default Vercel dry-run plan;
  no live mode or registration wiring.
- Three Playwright-ready cases in `tooling/custom-domains-e2e`, awaiting the
  separately owned harness. They are not executed browser evidence; ECS
  White-label is still incomplete.

No upstream code was copied. Public/private suffix parsing uses the maintained
MIT dependency `tldts` (7.4.19). Only its dependency entries were added to the
lockfile; unrelated dependency re-resolution was removed.

## Tests added

The domains package adds 22 cases for apex/private-suffix policy, platform
namespace rejection, IDNA and IP rejection, normalization, split TXT values,
expiry/reverification and disabled/dry-run hosting behavior. It retains its
23 existing host-normalization cases.

The platform adds 40 cases covering store transactions and hashed challenges,
permissions/CSRF, tenant binding, custom-host expiry, middleware canonicalization,
OAuth return sanitization, actual root-layout token rendering, hostile brand
values, and six real-Postgres integration cases. The integration cases include
audit-failure rollback and immediate removal. Seven existing pool-boundary and
ten existing middleware cases were included in the dedicated run.

The migration-0029 regression fixture now applies only migration predecessors
before testing the 0029 upgrade. Its former "all except 0029" catalog applied
0048 first and was rejected by the migration runner's ordering guard.

## Exact local commands

Runtime: Node v22.23.2, pnpm 11.13.1. Task container:

```sh
docker run -d --name opentenant-domains-56c36856-55443 \
  -p 127.0.0.1:55443:5432 -e POSTGRES_DB=opentenant_ci \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  --health-cmd 'pg_isready -U postgres -d opentenant_ci' \
  --health-interval 2s --health-timeout 3s --health-retries 20 \
  pgvector/pgvector:0.8.2-pg17-bookworm
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/postgres \
  node tooling/ci/create-integration-databases.mjs
docker exec opentenant-domains-56c36856-55443 psql -U postgres -d postgres \
  -c 'create database opentenant_it_custom_domains'

CUSTOM_DOMAINS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_custom_domains \
  pnpm --filter @opentenant/platform exec vitest run lib/custom-domains \
  lib/control-plane-boundaries.test.ts middleware.test.ts --maxWorkers=2
pnpm --filter @opentenant/domains test
pnpm --filter @opentenant/platform exec vitest run \
  lib/custom-domains-routing.test.ts lib/custom-domains-auth.test.ts --maxWorkers=1

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_ci \
  node tooling/ci/rls-proof.mjs
ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-domains-proof/store-reports-final \
  pnpm database:store-proof
CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test

pnpm turbo typecheck lint test --force
pnpm turbo typecheck lint test --force --concurrency=2
VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=2 \
  pnpm turbo typecheck lint test --force --concurrency=4 --continue
pnpm --filter @opentenant/developer-mcp exec vitest run src/authority.test.ts \
  src/contracts.test.ts src/protocol.test.ts --maxWorkers=1
pnpm --filter @opentenant/platform exec vitest run lib/admission.test.ts \
  lib/control-plane.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
pnpm turbo build --filter=@opentenant/platform
NODE_OPTIONS=--max-old-space-size=2048 pnpm turbo build --filter=@opentenant/platform
git diff --check
docker rm -f opentenant-domains-56c36856-55443
```

Each integration database reset used only the task container. Repeating the
custom suite requires dropping/recreating `opentenant_it_custom_domains` first;
it never resets an externally supplied schema. Logs and JSON scanner/store
reports are under `/tmp/opentenant-domains-proof` on the implementation host.

## Results

- Dedicated platform proof: **57/57**, 10 files, zero skipped.
- Domains package: **45/45**, 3 files.
- Final callback regression rerun: **8/8**, 2 files.
- RLS: **314/314**, 31 tenant tables.
- Database stores: **30/30**, 7 suites, zero skipped. The first attempt hit
  the existing 500 ms grant-expiry fixture under host load; the rerun passed.
- Migrations: **148/148**, 21 files, zero skipped, after the fixture correction.
- Platform build: the final memory-capped run passed **1/1 task**, uncached,
  after an earlier successful run and a subsequent exit-137 resource failure.
  Final standalone platform typecheck and lint also passed after the build.
- Full uncached workspace command was run. Its first attempt stopped at
  **41/63 successful tasks** on two pre-existing Assessment stream-timing tests.
  A reduced-concurrency run exposed and helped fix the new route SQL boundary
  issue and a slow test import. Later bounded checks also encountered unrelated
  worker/module-import timeouts. The final bounded run completed **61/63 tasks**;
  the two failed tasks were platform and Developer MCP tests. All workspace lint
  and typecheck tasks passed. Developer MCP’s three affected files subsequently
  passed **75/75** serially. The affected platform files passed **9/9** with one
  worker and a 30-second test timeout. No test assertion was changed for these
  resource retries. These failed runs are not green workspace gates.
- `git diff --check`: clean.

## Security and structure checks

Gitleaks ran from a snapshot of non-ignored source with repository-relative
paths and the repository allowlist: **zero leaks**. Running with an absolute
snapshot root initially failed those relative allowlists on existing Assessment
storage-key literals; no source allowlist was changed.

Semgrep ran the five local security rules across the repository: zero findings,
with four timeout warnings. The focused changed-production-path scan completed
with **zero findings and zero errors over 15 files**. An earlier unrestricted
parallel scan exhausted the host's io_uring allocation; the rerun used one job
and the POSIX backend. These bounded rules are not a full security assessment.

Trivy's offline cached-database scan reported **zero high/critical
vulnerabilities**. No pre-commit or Promptfoo configuration exists.

Ripwire's middleware contract check found no incompatible calls. Its quality
heuristics reported three gates: a pre-existing form's same-name `submit`
reachability, and two hash-helper duplication classifications involving a
private migration checksum and the new domain hash. These are structural
heuristics; the checksum is not a public reusable API. No unrelated helper or
form was changed to satisfy them.

Graphify AST update completed; its known missing SQL parser and symbol-less
file warnings remain. Generated graph changes describe code relationships,
not production evidence.

The task-owned pgvector container was removed after the database proofs.
