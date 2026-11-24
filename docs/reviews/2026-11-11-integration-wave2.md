# Local integration wave 2 verification

Date: 2026-11-11. Branch: `t3/integration-wave2`, created from `378c98c`.
The tested code revision is `76f7594`; subsequent changes record evidence only.
Node 22.23.2, pnpm 11.13.1. No push, PR, hosted API mutation or production operation.
All database runs use `pnpm db:ephemeral` with the cached CI image
`pgvector/pgvector:0.8.2-pg17-bookworm`, random non-5432 ports, and automatic removal.
`pnpm e2e` now uses the same database harness internally. OpenFGA conformance uses
its existing local container test runner. Synthetic identity ports replace hosted APIs.

## Merge order and conflicts

```text
cf64d71 merge: integrate cross-tenant test hardening
fa6218e merge: integrate authorization adapters
76dc414 merge: integrate durable tenant lifecycle
cbe356a merge: integrate ephemeral database verification
b2632db merge: integrate sandbox and usage adapters
```

All five merges use `--no-ff`. Their messages end with the required marketing
classification and Claude co-author trailer. Source branch refs were preserved.

- Generated graph conflicts: retained ours. Graph regeneration is local and is not committed.
- HANDOFF and capability documents: preserved both sets of entries; the provider
  table combines HEAD's deployment options with the new sandbox adapters.
- SHIPLOG, CHANGELOG and notices: retained both sides' entries. Logs used union merging.
- Root scripts: kept the union, including worker, owner-invite, audit, rotation,
  database harness, browser and unattended commands.
- Migration reservations: retained used authorization 0063 and usage 0065,
  with 0064 and 0066 still reserved. No applied SQL was changed.
- Lockfiles: re-resolved with `pnpm install` after each conflicting merge and
  confirmed the final frozen install. Explicitly disabled unused cpu-features,
  protobufjs and ssh2 install scripts after pnpm rejected undecided build policies.
- Tenant resolution: kept custom-domain verification and expiry checks, combined
  with fresh platform-domain lifecycle state so suspension bypasses no cache.
- The model-routing upgrade fixture retains HEAD's `id < 0029` selection.
  `packages/usage-export/testing/migration-upgrade-fixture.patch` was not applied.
- Database count checks derive from the merged list of 15 databases. Both tenant
  module catalogs and tenant-core now have directory-to-catalog parity tests.

## Integration commits

```text
1c14419 fix(platform): remove obsolete Workflow build integration
a0157ff feat(worker): schedule receipt-backed usage export
170d108 test(review): refresh all eighteen R11 regression entries
ad9d7b2 test(identity): verify token-gated owner grants with hardened gateways
c6aecb8 test(integration): cover merged database catalogs and proof environments
f289aee test(platform): reconcile custom-domain and lifecycle coverage
da4886b fix(lifecycle): preserve other tenants usage export receipts on erase
1d7d60b fix(usage-export): align PostgreSQL pool type declarations
76f7594 test(ci): run merged integration proofs through the shared database harness
```

Usage export runs every minute with five Graphile attempts and the package's
bounded drains. Private local files are the default. OpenMeter requires both
endpoint and API key, and an explicit file selection keeps local delivery.
Destination hashes distinguish receipt identities. A regression verifies that
hard erase detaches the shared cursor hint and preserves another tenant's receipts.

The owner proof runs issue, token claim, queued elevation and audit verification
through real hardened WorkOS and Clerk gateways with synthetic provider ports.
Ordinary owner invites remain blocked. Local, WorkOS and Clerk all run the
shared identity suite; in-process and real local OpenFGA run authorization conformance.
Every fixed R11 index entry names an existing regression test.

## Exact commands and outcomes

Exit codes are process results. Test columns are passed/failed/skipped counts;
`n/a` means the command is not an assertion suite, or failed before registering tests.
The quality runs set `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1` and retain the requested
Turbo concurrency of two. Counts for interrupted runs include completed package summaries only.

| Run | Command | Exit | Tests P/F/S |
| --- | --- | --- | --- |
| frozen-final | `pnpm install --frozen-lockfile` | 0 | n/a |
| audit-final | `pnpm audit --prod --audit-level high` | 0 | n/a |
| quality | `pnpm turbo typecheck lint test --force --concurrency=2` | 1 | 1062/3/41 |
| quality-retry | `pnpm turbo typecheck lint test --force --concurrency=2` | 2 | 1793/0/42 |
| quality-final | `pnpm turbo typecheck lint test --force --concurrency=2` | 0 | 1939/0/48 |
| matrix | `pnpm quality:matrix` | 0 | n/a |
| build | `pnpm turbo build --filter=@opentenant/platform` | 1 | n/a |
| build-retry | `pnpm turbo build --filter=@opentenant/platform` | 0 | n/a |
| rls | `pnpm db:ephemeral -- pnpm rls:proof` | 0 | 314/0/0 |
| stores | `pnpm db:ephemeral -- pnpm database:store-proof` | 0 | 40/0/0 |
| migrations | `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | 0 | 175/0/0 |
| provisioning | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts` | 0 | 1/0/0 |
| worker | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts` | 0 | 8/0/0 |
| worker-usage | `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts` | 0 | 8/0/0 |
| isolation | `pnpm db:ephemeral -- env ISOLATION_FUZZ_SEED=20261111 node packages/testing/scripts/isolation-proof.mjs` | 1 | n/a |
| isolation-retry | `pnpm db:ephemeral -- env ISOLATION_FUZZ_SEED=20261111 node packages/testing/scripts/isolation-proof.mjs` | 0 | 9/0/0 |
| usage-db | `pnpm db:ephemeral -- pnpm --filter @opentenant/usage-export test` | 0 | 14/0/0 |
| identity | `pnpm --filter @opentenant/testing exec vitest run src/identity-adapters.test.ts` | 0 | 39/0/0 |
| authz | `pnpm --filter @opentenant/authz test` | 0 | 38/0/0 |
| e2e | `pnpm e2e` | 0 | 8/0/0 |
| custom-domains | `pnpm db:ephemeral -- sh -c 'CUSTOM_DOMAINS_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" exec pnpm --filter @opentenant/platform exec vitest run lib/custom-domains.integration.test.ts'` | 0 | 6/0/0 |
| key-rotation | `pnpm db:ephemeral -- sh -c 'KEY_ROTATION_DATABASE_URL="$CONTROL_PLANE_INTEGRATION_DATABASE_URL" exec pnpm --filter @opentenant/database exec vitest run src/credential-cipher-rotation.postgres.test.ts'` | 0 | 2/0/0 |
| gitleaks | `gitleaks dir /tmp/opentenant-wave2-source-scan --redact --no-banner --config .gitleaks.toml` | 1 | n/a |
| gitleaks-final | `gitleaks dir . --redact --no-banner --config .gitleaks.toml` | 0 | n/a |
| semgrep-final | `semgrep scan --jobs 2 --timeout 15 --config packages/usage-export/testing/security-rules.yml --metrics=off --disable-version-check --error --exclude graphify-out --exclude node_modules --exclude .next .` | 0 | n/a |
| trivy-final | `trivy fs --offline-scan --skip-db-update --skip-check-update --skip-version-check --scanners vuln,misconfig --severity HIGH,CRITICAL --skip-dirs node_modules --skip-dirs .git --skip-dirs graphify-out --skip-dirs apps/platform/.next .` | 0 | n/a |

The final quality run completed 78/78 tasks across 26 package workspaces, with
1,939 passing tests, zero failing tests and 48 skipped tests. The quality matrix
also reports 78 tasks and zero builds. The build generated 26 static pages.
The browser run passed all eight Chromium journeys, with no retries or skips.
The RLS proof passed 314 checks over 31 tenant tables. Store proof ran eight
suites and 40 assertions. Isolation fuzz ran nine tests covering 175 family
sequences and five malformed-ID sequences with seed 20261111.

The 48 generic-run skips comprise 22 audit TRUNCATE tests, ten audit checkpoint
tests, two key-rotation tests, six custom-domain tests, six usage-export tests,
one microsandbox test and one SMTP test. The 46 database tests all ran successfully
in the dedicated proofs above. The zero-test environment-gated provisioning,
worker, isolation and other migration/store files also ran through their dedicated
commands. The two remaining skips are unverified, not passes.

## Earlier failures and reruns

- First quality run: three stale custom-domain test failures, 29/78 tasks completed.
  Updated assertions to require fresh lifecycle reads and added the new layout mock.
- Second quality run: no failed tests, but platform typecheck rejected Pool values
  from incompatible `@types/pg` versions. It completed 66/78 tasks. Aligned usage-export
  to exactly 8.20.4. The third full run passed all tasks.
- First build failed on the same Pool type mismatch. The corrected build passed.
- The first R11-focused run passed 19 tests and failed one because lifecycle replaced
  an indexed tenant-creation test. Its replacement asserts empty brand defaults in
  real PostgreSQL. The corrected focused run passed all 20.
- Initial isolation run failed before tests because its connection guard did not
  recognize the harness's Unix-socket server endpoint. It now accepts that endpoint
  only with the explicit ephemeral transport marker, preserving loopback checks.
  The corrected run passed with zero skips.
- Initial Gitleaks scan used an absolute snapshot target and reported 11 synthetic
  fixture canaries because relative path allowlists did not match. Running from
  the snapshot root with `gitleaks dir .` passed. No allowlist was weakened.
- No test timed out, so no timeout-specific rerun was necessary.

## Security and structural checks

The production dependency audit reports zero high/critical findings, with one low
and five moderate advisories. Gitleaks reports zero leaks. Semgrep ran the repository's
five local security rules over 725 source files with zero findings and no timeout.
Trivy used the cached vulnerability and check databases in offline mode, with zero
high/critical vulnerabilities or misconfigurations. This is local cached scan evidence.
Ripwire reports zero gating quality regressions; two minor verbosity changes describe
new CI proof steps. Its erase contract check reports unchanged. There is no
`.pre-commit-config.yaml` or Promptfoo configuration in this checkout.

Raw command logs and timing metadata remain under `/tmp/opentenant-wave2-evidence/`.
The checked-in [structured results](2026-11-11-integration-wave2-results.json)
record commands, exits, counts and timing without generated credentials.

## Left open

- R11-12: AP production provisioning is unsupported.
- R11-18: production configuration still requires NEON_API_KEY and NEON_ORG_ID
  for self-hosted installations.
- Real microsandbox lifecycle is unverified without an approved cached image.
  The test prohibits image pulls. Hosted sandbox execution remains owner-gated.
- Real Mailpit SMTP delivery is unverified because the local service was unavailable.
- Optional hosted provider activation, billing, authorization relationship lifecycle
  synchronization and sandbox composition retain their existing integration/owner gates.

Marketing impact: truth.
