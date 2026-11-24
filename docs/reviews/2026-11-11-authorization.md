# Authorization adapter verification

Date: 2026-11-11. Local implementation on `t3/authorization-openfga-adapter`. No push, PR, production
provider activation or genuine tenant data. Marketing impact: truth.

## Delivered scope

- `@opentenant/authz` exports the port, in-process adapter, optional provider
  factory, and membership/entitlement sync helpers. SDK imports stay in the
  OpenFGA adapter. Shared policy and decision deadlines fail closed.
- `ModuleManifest.rolePermissions` is optional for source compatibility.
  Built-ins and fresh database seeds use maps; omitted maps remain a clearly
  documented legacy exception. Claims only narrow elevated mapped grants.
- The resolver checks enabled `tenant_modules` and trusted manifest snapshots.
  The only other platform source change adds configuration names.
- The five-type OpenFGA DSL is compiled and accepted by a real server in tests.
  The SDK is 0.9.7; a scoped Axios 1.20.0 override fixes its pinned transport.
  The optional compose profile and test image pin OpenFGA 1.11.0 by digest.
- Migration 0063 adds catalog snapshots and optional installation-bound store
  and model IDs. Environment configuration is the active composition source.
  Migration 0064 remains reserved and unused.
- Both adapters run the exported conformance suite. Sync is exported for the
  integration owner, without modifying membership, provisioning or settings
  routes. Wiring points are in [the architecture guide](../architecture/authorization.md).

## Commands and evidence

Runtime: Node v22.23.2, pnpm 11.13.1. Commands run with
`pnpm_config_verify_deps_before_run=false` after explicit dependency installation.
CPU affinity and Turbo concurrency limit competition with other worktrees.

| Command | Result |
| --- | --- |
| `taskset -c 4,5 pnpm --filter @opentenant/authz test` | 38 passed, 0 skipped; 20 in-process and 18 real-container tests |
| `pnpm --filter @opentenant/platform exec vitest run lib/module-access.test.ts --maxWorkers=1 --minWorkers=1` | 18 passed |
| `taskset -c 4,5 pnpm --filter @opentenant/authz typecheck` | Passed |
| `taskset -c 4,5 pnpm --filter @opentenant/authz lint` | Passed |
| `TURBO_CONCURRENCY=2 taskset -c 6,7 pnpm turbo typecheck lint test --force` | 55/69 tasks successful before two platform tests hit their 5s timeout; platform 430 passed, 2 timed out |
| `taskset -c 4,5 pnpm --filter @opentenant/platform exec vitest run lib/admission.test.ts lib/control-plane.test.ts --maxWorkers=1 --minWorkers=1` | 9 passed, including both timed-out cases, with default test timeouts |
| `TURBO_CONCURRENCY=2 taskset -c 6,7 pnpm turbo typecheck lint test --continue` | 69/69 tasks passed, 52 cached; 1,709 tests reported across workspace summaries; platform 432/432 passed |
| `taskset -c 2,3 pnpm --filter @opentenant/platform build` | Passed production build |
| `taskset -c 0,1 pnpm --filter @opentenant/migrations test` | 144 passed, 6 skipped after one suite's setup failed; 21 files passed, 1 failed. Both new authorization migration tests passed |
| `taskset -c 0,1 pnpm database:store-proof` | 7 suites, 30 assertions, 0 skipped |
| `pnpm audit --prod --audit-level high` | Exit 0: 0 high/critical, 1 existing moderate |
| `git diff --check` | Passed |
| `graphify update .` | AST update passed; output intentionally uncommitted |

Database commands ran through `/tmp/opentenant-authz-db-proof.py` and
`/tmp/opentenant-authz-store-proof.py`. Each launched
`docker run --rm -d --name opentenant-authz-pg-<uuid> -p 127.0.0.1::5432`
with `pgvector/pgvector:0.8.2-pg17-bookworm`. The scripts created dedicated
loopback databases, set the three migration integration URL variables and all
seven store-proof URL variables, and removed their containers in `finally`.
The OpenFGA suite independently used unique names and random loopback ports;
it does not skip when Docker is unavailable.

Initial verification caught and corrected malformed OpenFGA subject IDs,
missing platform type-import resolution, and the vulnerable SDK transport.
An initial concurrent pnpm setup left missing Vitest executable links; explicit
installation and local bin-link repair restored the test environment. The
final results above supersede those setup attempts.

## Remaining migration gate

`tooling/migrations/src/control-plane-model-routing-store.integration.test.ts`
applies every migration except 0029, inserts legacy fixtures, then applies 0029.
With migration 0063 present, the canonical runner correctly rejects this as
out-of-order. Six cases skip because their suite's setup failed; this is a
failed gate, not a successful proof. Pgvector is present and the new migration
and store proofs execute against the required CI image.

That older fixture is outside this task's assigned paths. Its owner must apply
migrations before 0029, insert the legacy fixtures, then apply 0029 and later
history in order. No production runner behavior or historical SQL was changed
to accommodate the fixture.

## Security and structural checks

- `gitleaks dir . --redact --config /tmp/opentenant-authz-gitleaks.toml --report-format json --report-path /tmp/opentenant-authz-security/gitleaks.json`
  passed with zero source leaks. The temporary config extends repository rules
  and excludes `.next`, `node_modules` and `.turbo`. The initial unrestricted
  scan found six findings confined to ignored Next build artifacts. The source
  scan had no findings.
- `SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 EIO_BACKEND=posix taskset -c 8 semgrep scan --jobs 1 --timeout 0 --exclude .agents/skills/archify --config /tmp/opentenant-authz-semgrep.yaml --metrics off --disable-version-check --json --output /tmp/opentenant-authz-security/semgrep-final.json .`
  ran five local JS/TS rules against 566 files. It reported 22 interpolation
  findings in unchanged database/proof/provisioning code, none in the changed
  authorization code. Nine partial-parsing warnings remain, including unsupported
  type-export/import syntax in two changed files. This is a limited scan, not a
  clean full security audit. The first attempt failed to allocate the engine's
  io_uring resources. One-worker mode completed a 604-file scan with two timeouts;
  the final run excludes bundled Archify code and disables per-rule timeouts.
- `trivy fs --offline-scan --skip-db-update --skip-java-db-update --scanners vuln,secret,misconfig --format json --output /tmp/opentenant-authz-security/trivy.json .`
  completed with the cached database: two medium findings in the root lockfile,
  zero high/critical or secrets; the template lockfile had no findings. No
  misconfiguration targets were detected, so this is not a compose security
  certification. The npm audit above uses the current registry advisory data.
- `ripwire . --edit-check=resolvePermissions` reported an unchanged public
  signature and zero incompatible callers. `ripwire . --quality-delta` flags
  generic scalar-validator shapes as clones of existing unrelated guards.
  Those guards are not semantically interchangeable and were not coupled to
  authentication just to satisfy the structural heuristic.
- No pre-commit or Promptfoo configuration is present.

Raw local logs use `/tmp/opentenant-authz-*.log` and
`/tmp/opentenant-authz-security/`. Graphify warns about unavailable SQL grammar
and test files without extracted symbols; these do not replace compiler or
real-database evidence. Generated graph output is excluded from the commit.
