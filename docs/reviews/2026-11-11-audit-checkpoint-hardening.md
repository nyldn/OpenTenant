# Audit checkpoint hardening verification

Date: 2026-11-11. Branch: `t3/audit-checkpoint-hardening`.
Implementation commits: `125e832` and `0598879`. Marketing impact: none.

All five requested deliverables are implemented locally. Forward migrations
block TRUNCATE on eleven control-plane and tenant audit tables and create an
append-only signed-checkpoint receipt table. The security package implements
C2SP-style signed notes with Ed25519 using Node crypto. A provider-neutral sink
contract has filesystem and local Git adapters. The database package supplies
an anchor function and `pnpm audit:anchor` / `pnpm audit:verify`. Key custody,
rotation, scheduler setup, restore behavior, and trust limits are documented in
[the runbook](../security/audit-checkpoints.md).

No existing SQL migration or `apps/platform/lib` file was edited. No dependency
was added, no third-party implementation was copied, and no external service,
push, PR, scheduler activation, or deployment was invoked.

## Tests added

- 22 real-Postgres migration cases reject owner and restricted-role TRUNCATE
  on eleven audit tables, including empty tables and cascades. They run the
  complete control-plane, tenant-core, Brain, and Support migration catalogs.
  The runtime test role gets explicit TRUNCATE grants so the trigger itself is
  tested rather than a missing privilege.
- 10 signed-note cases cover framing, signed origin/sequence/head fields,
  signature corruption, unknown/substituted keys, rotation, invalid sequence
  numbers, non-Ed25519 keys, and unsafe identifiers.
- 4 sink cases cover immutable file publication, retries, overwrite refusal,
  actual local Git commits, dirty repository refusal, and exclusion of signer
  and database credentials from Git subprocess environments.
- 10 real-Postgres checkpoint cases cover anchor receipts, CLI anchor/verify,
  dropped tail, edited row, reordered rows, entire-scope deletion, growth and
  reanchoring, a self-consistent rewritten chain, an empty chain, missing
  external notes, and secret-free failure output. Tamper tests disable row
  triggers as an owner and delete database checkpoint receipts. External notes
  still expose the changes, and anchoring refuses to bless the damaged chain.

The existing 18 audit-store cases still pass against the shared hash/verifier.
The existing 0029 upgrade fixture now applies only migrations before 0029 when
creating its old baseline, so newer forward migrations do not make its setup
out of order. The guarded CI database inventory now requires all ten new
checkpoint cases and rejects skipped assertions.

Tests were written and run before their implementations. Initial missing-module
and missing-migration failures were followed by passing suites. The extra model
event TRUNCATE cases first produced 4 failures with 18 passes; the added guards
made all 22 pass. The Git environment regression first produced 1 failure with
64 passes; an explicit subprocess environment made all 65 security tests pass.

## Runtime and final commands

Node was `v22.23.2`; pnpm was `11.13.1`. Dependencies were installed from the
local store with `pnpm install --offline --frozen-lockfile --ignore-scripts`.

The commands below were run from the repository root. Outputs and JSON reports
are under `/tmp/opentenant-audit-evidence/` on this machine.

```sh
TURBO_TELEMETRY_DISABLED=1 pnpm turbo typecheck lint test
# PASS: 63/63 tasks; 1,643 tests: 1,506 Vitest + 137 node:test.

NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm turbo build --filter=@opentenant/platform
# PASS: 1/1 build task; 27/27 pages generated.

pnpm --filter @opentenant/security test
# PASS: 7 files, 65 tests.

git diff --check
# PASS: no whitespace errors.
```

The default task run leaves destructive database suites gated behind explicit
URLs. All three required database proof commands were therefore run separately
against the agent-owned container below. The final server was PostgreSQL 17.10
with pgvector available. `--pull=never` used a locally cached image.

```sh
docker run --pull=never -d --name opentenant-audit-96743f91-proof-pg17 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55435:5432 pgvector/pgvector:0.8.2-pg17-bookworm

docker exec opentenant-audit-96743f91-proof-pg17 createdb -U postgres opentenant_it_rls

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_rls \
  pnpm rls:proof
# PASS: 314 checks across 31 tenant tables. Runtime role removed by the proof.

ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/postgres \
  node tooling/ci/create-integration-databases.mjs
# PASS: 11 isolated synthetic databases created.

CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test
# PASS: 20 files, 164 tests, 0 skipped.

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_ops06_store_helpdesk_projection \
AUDIT_CHECKPOINT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/opentenant_it_audit \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-audit-evidence/store \
  pnpm database:store-proof
# PASS: 8 suites, 40 assertions, 0 skipped.

docker rm -f opentenant-audit-96743f91-proof-pg17
# PASS: agent-owned proof container removed.
```

An earlier agent-owned `postgres:17-alpine` container used loopback port 55434.
Its store and RLS proof attempts failed because pgvector was unavailable.
Those failures were not counted as proof. The locally cached pgvector image
became available, so the complete proofs were rerun successfully as above. The
initial `opentenant-audit-96743f91-pg17` container was also removed.

## Local security and structural checks

```sh
gitleaks dir . --config /tmp/opentenant-audit-gitleaks.toml --redact \
  --report-format json --report-path /tmp/opentenant-audit-evidence/gitleaks-source.json
# PASS: 0 leaks. The local config extends .gitleaks.toml and excludes only
# generated apps/platform/.next files and graphify-out/cache stat indexes.
# Earlier all-files scans found three generated Next cache tokens and four
# Graphify index hashes; no source finding was suppressed.

SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 semgrep scan \
  --metrics=off --disable-version-check --jobs 2 --timeout 0 \
  --config /tmp/opentenant-semgrep.yaml --error --json \
  --output /tmp/opentenant-audit-evidence/semgrep.json .
# PASS: 5 local rules, 0 findings. Existing partial-parse warnings remain.

trivy fs --offline-scan --skip-db-update --skip-java-db-update \
  --skip-check-update --skip-version-check --disable-telemetry \
  --scanners vuln,misconfig,secret --skip-dirs node_modules --skip-dirs .git \
  --skip-dirs apps/platform/.next --skip-dirs graphify-out --format json \
  --output /tmp/opentenant-audit-evidence/trivy.json .
# Completed offline: 2 existing MEDIUM minimatch findings for CVE-2026-118764;
# 0 high/critical findings, 0 secrets, 0 misconfigurations.

ripwire packages/database --edit-check=verifyChain
ripwire . --quality-delta
ripwire . --pr-context
graphify update .
graphify check-update .
```

Ripwire reports an unchanged `verifyChain` signature. Its name-based quality
scan flags the moved pre-existing hash function as a clone of Brain's existing
hash, the existing callback-based row mapper as dead code, and similarity
between test-only transaction helpers. Source inspection and the original 18
store regressions establish that the moved hash/verifier preserves behavior.
The new comparison and CLI functions also receive complexity advisories; these
are recorded as review signals, not passing structural gates. Graphify was
refreshed with local AST extraction, without semantic API calls. It retains the
existing missing SQL-parser and semantic-node metadata warnings.

There is no `.pre-commit-config.yaml` in this checkout. No prompt, RAG, tool
prompt, or agent behavior was changed. Independent external retention, signer
custody, and production scheduling remain operator responsibilities. Local file
permissions or Git alone cannot resist an administrator who destroys all
external checkpoint evidence.
