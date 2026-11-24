# Wave 2 credential rotation and transactional email

Branch: `t3/credential-rotation-email-transport`. Local implementation only;
no push, PR or production operation. Marketing impact: truth.

## Delivered behavior

- AES-GCM envelopes carry a version and key ID and authenticate the routing
  header plus tenant AAD. Legacy ciphertext still decrypts under `k0`.
- Rotation covers every durable cipher consumer: tenant database connections,
  OAuth access/refresh tokens, and tenant/installation model credentials.
  Batches commit ciphertext, progress and hash-chained audit together. A failed
  first batch leaves a recoverable run; resume checks operator, mode and target
  key fingerprint. Dry-run leaves credential columns intact.
- Migration `0045_credential_rotation.sql` adds checkpoints. No migrations
  numbered 0046 or 0047 were needed.
- Notifications has a provider-neutral email contract, a Nodemailer SMTP
  adapter and React Email templates. Support's composition root resolves
  tenant-scoped directory references and keeps addresses/provider errors out
  of its delivery evidence. The existing synthetic transport remains usable.
- Compose adds loopback Mailpit SMTP/HTTP on 11026/18026. The module still uses
  its existing in-memory Support Depth store; no durable email worker is
  claimed. No SaaS adapter was added.

The envelope extends the existing Node crypto boundary, using @47ng/cloak's
MIT envelope pattern as a design reference without copied source. This keeps
legacy decoding and AAD behavior within one implementation instead of adding
AWS's separate message format. Dependency licences and sources are recorded
in `THIRD_PARTY_NOTICES.md`; a local SBOM contains 1,052 components.

## Regression coverage

Twenty-four cases were added across cipher, rotation, typed config,
notifications and support delivery tests. With the dedicated database URL,
23 pass and the Mailpit case skips because no local Mailpit image/service is
available. The SMTP proof uses the actual installed Nodemailer client with a
loopback test server and checks multipart HTML/text output. Mailpit's separate
HTTP read-back test supports `MAILPIT_REQUIRED=1`, which fails instead of
skipping in CI.

The rotation proof starts from actual legacy ciphertext, dry-runs all five
credential values, commits one batch, stops, resumes, verifies plaintext
preservation internally, checks completed-run replay, rejects a changed target
key, verifies the audit chain, and recovers from a failed first batch.
Only synthetic fixture values are used. No plaintext is written to logs.

An existing migration test previously applied every migration except 0029
before applying 0029 itself. Migration 0045 exposed that out-of-order setup.
Its fixture now applies only the catalog before 0029, then tests that upgrade.
The database-store proof retains its exact seven-suite inventory; the separate
rotation proof uses the `.postgres.test.ts` suffix.

## Verification

Final results are recorded below. Logs, local
licence inventory, security reports and SBOM are retained under
`/tmp/opentenant-wave2-proof` on this host.

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS; already up to date. |
| `pnpm turbo typecheck lint test --force --concurrency=2` | PASS; 66/66 uncached tasks, 1,548 Vitest and 137 Node tests. |
| `pnpm turbo build --filter=@opentenant/platform` | PASS; 1/1 task, no cache hit. |
| `pnpm --filter @opentenant/database exec vitest run src/credential-cipher.test.ts src/credential-cipher-rotation.postgres.test.ts --testTimeout=60000 --hookTimeout=60000` | PASS; 17 tests, no skips. |
| `pnpm --filter @opentenant/notifications exec vitest run` | PASS; 8 tests, Mailpit 1 explicitly skipped. |
| `pnpm --filter @opentenant/support exec vitest run src/email-delivery.test.ts` | PASS; 4 tests. |
| `pnpm --filter @opentenant/platform exec vitest run lib/server-config.test.ts` | PASS; 21 tests. |
| `pnpm keys:rotate --dry-run --batch-size 2` | PASS; 5 scanned, 0 candidates after the apply proof. |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_ci node tooling/ci/rls-proof.mjs` | PASS; 314 checks, 31 tenant tables. |
| `pnpm database:store-proof` | PASS; 30 assertions, 7 suites, zero skipped. |
| `pnpm --filter @opentenant/migrations test --testTimeout=60000 --hookTimeout=60000` | PASS; 148 tests, 21 files, zero skipped. |
| `git diff --check` and `git diff --cached --check` | PASS. |
| `graphify update .` | PASS; AST only, 6,279 nodes and 13,826 edges. |

Commands use `pnpm_config_verify_deps_before_run=false` to stop pnpm's implicit
install step. Focused proof runs also use `VITEST_MAX_FORKS=1` and
`VITEST_MIN_FORKS=1`. The final full gate was invoked with both fork and thread
bounds set to 1 and Turbo concurrency 2. The final build passed on the unchanged implementation, with 1/1 uncached task. The build was invoked with
`NODE_OPTIONS=--max-old-space-size=2048` and `NEXT_TELEMETRY_DISABLED=1`.
Turbo's strict environment filtering may omit non-allowlisted worker settings;
concurrency 2 is the enforced Turbo bound. No project-wide test configuration
was weakened to accommodate the host load.

The task-owned Postgres container used exactly
`pgvector/pgvector:0.8.2-pg17-bookworm`, named
`opentenant-wave2-rotation-a62d10cb-55442`, on `127.0.0.1:55442`.
It was removed after database proofs. Exact database setup and proof variables:

```sh
ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/postgres \
  node tooling/ci/create-integration-databases.mjs

KEY_ROTATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_rotation \
  pnpm --filter @opentenant/database exec vitest run \
  src/credential-cipher.test.ts src/credential-cipher-rotation.postgres.test.ts \
  --testTimeout=60000 --hookTimeout=60000

ADMISSION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_store_admission \
USAGE_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_store_usage \
MODEL_ROUTING_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_store_model_routing \
MODULE_OWNERSHIP_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_ops04_store_ownership \
MODULE_CAPABILITY_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_ops05_store_capability \
BRAND_PROPOSAL_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_store_brand_proposal \
HELPDESK_PROJECTION_STORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_ops06_store_helpdesk_projection \
DATABASE_STORE_REPORT_DIRECTORY=/tmp/opentenant-wave2-proof/store-reports \
  pnpm database:store-proof

CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_control_plane \
TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_tenant_core \
TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/opentenant_it_tenant_support \
  pnpm --filter @opentenant/migrations test --testTimeout=60000 --hookTimeout=60000
```

## Security scans and limits

- Gitleaks scanned a non-ignored source snapshot from its own directory so the
  repository's path-specific allowlists applied correctly. Zero leaks.
- Semgrep ran five existing local security rules on 402 production files with
  zero findings. The first attempt exhausted io_uring resources; the retry used
  `EIO_BACKEND=posix` and one job.
- Trivy used the cached vulnerability DB with networking disabled by offline
  and skip-update flags. Zero high/critical findings. This is a cached advisory
  snapshot, not a current online audit.
- Ripwire's whole-branch quality delta reports heuristic gates for a short
  wrapper matching an unrelated diagram helper and cipher class length. Its
  contract check found no incompatible calls. These do not replace TypeScript,
  regression tests or the database proofs.
- Graphify reports the pre-existing missing SQL parser and nine semantic nodes
  lacking `source_file`; no API was used for the refresh.
- No pre-commit or Promptfoo configuration is present.

Initial full runs had a sanitization lint error, worker-startup/timeouts under
load and one build terminated with exit 137. The lint error was corrected;
subsequent runs use fewer concurrent tasks. Migration retries increased test
and hook timeouts after the host exceeded load 100 with swap exhausted.

The no-external-services constraint had one deviation: pnpm's automatic
pre-test installation contacted the npm registry despite an offline environment
setting. Those installs were stopped. Explicit `pnpm install --offline` was
used afterward, importing existing local dependency caches where needed. The
successful explicit offline install downloaded zero packages. No product or
production service was contacted, no secret was printed, and no push or PR
was performed.
