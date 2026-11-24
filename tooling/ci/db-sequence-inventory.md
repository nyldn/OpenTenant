# Wave-6 V1 CI gate inventory

Verified locally on 2026-11-17 against base `9e5a0fb`. All test launchers ran
through foreground `forge-job run` units. No push or hosted Actions run.
Marketing impact: none.

## Mandatory database families

The sequence passed all 17 steps, 358 cases and 93 Vitest suite counters with
zero skipped, pending, todo or failed cases. Suite counters include Vitest's
file and describe counters; they are distinct from file counts.

Every sequence step requires a validated loopback `ADMIN_DATABASE_URL`.
The variables below are assigned by the runner to fixed synthetic databases.
Inherited database URLs are removed. Missing URLs and missing pgvector fail.

| Family | Files | Suite counters | Cases | Additional environment |
| --- | ---: | ---: | ---: | --- |
| store: admission | 1 | 2 | 3 | `ADMISSION_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: usage | 1 | 2 | 2 | `USAGE_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: model-routing | 1 | 2 | 4 | `MODEL_ROUTING_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: module-ownership | 1 | 2 | 1 | `MODULE_OWNERSHIP_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: module-capability | 1 | 2 | 2 | `MODULE_CAPABILITY_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: brand-proposal | 1 | 2 | 12 | `BRAND_PROPOSAL_STORE_DATABASE_URL` → `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| store: helpdesk-projection | 1 | 2 | 7 | `HELPDESK_PROJECTION_STORE_DATABASE_URL` → `HELPDESK_INTEGRATION_DATABASE_URL` |
| store: audit-checkpoints | 1 | 2 | 10 | `AUDIT_CHECKPOINT_DATABASE_URL` → `AUDIT_CHECKPOINT_DATABASE_URL` |
| store: quality-contract | 1 | 2 | 9 | `QUALITY_CONTRACT_STORE_DATABASE_URL` → `QUALITY_CONTRACT_DATABASE_URL` |
| custom-domains | 1 | 3 | 16 | `CUSTOM_DOMAINS_DATABASE_URL` |
| authorization-outbox | 1 | 2 | 10 | `CONTROL_PLANE_INTEGRATION_DATABASE_URL` |
| provisioning-neon | 1 | 2 | 1 | `PROVISIONING_CONTROL_DATABASE_URL`, `PROVISIONING_TENANT_DATABASE_URL` |
| provisioning-postgres | 1 | 2 | 2 | `PROVISIONING_CONTROL_DATABASE_URL`, `PROVISIONING_TENANT_DATABASE_URL` |
| identity | 2 | 7 | 65 | `PROVISIONING_CONTROL_DATABASE_URL` |
| worker | 2 | 4 | 13 | `TENANT_WORKER_DATABASE_URL`, `PROVISIONING_TENANT_DATABASE_URL` |
| support-delivery | 1 | 2 | 8 | `TENANT_SUPPORT_INTEGRATION_DATABASE_URL` |
| support-ai-review | 1 | 2 | 17 | `SUPPORT_AI_DATABASE_URL` |
| tenant-export | 1 | 2 | 3 | `TENANT_WORKER_DATABASE_URL`, `PROVISIONING_TENANT_DATABASE_URL` |
| usage-export | 1 | 2 | 6 | `USAGE_EXPORT_DATABASE_URL` |
| key-rotation | 1 | 2 | 2 | `KEY_ROTATION_DATABASE_URL` |
| rate-limit | 1 | 2 | 3 | `RATE_LIMIT_DATABASE_URL` |
| pg-observability | 1 | 2 | 1 | `OBSERVABILITY_DATABASE_URL` |
| migrations | 16 | 33 | 129 | `CONTROL_PLANE_INTEGRATION_DATABASE_URL`, `TENANT_CORE_INTEGRATION_DATABASE_URL`, `TENANT_SUPPORT_INTEGRATION_DATABASE_URL` |
| developer-mcp | 3 | 6 | 23 | Admin URL only; helper provisions its own databases |
| isolation-fuzz | 1 | 2 | 9 | Admin URL only; helper provisions its own databases |

Separate mandatory CI gates also passed locally:

| Family | Files | Cases | Requirements |
| --- | ---: | ---: | --- |
| restricted PostgreSQL controller | 1 | 2 | Fresh owned pgvector Docker cluster |
| database lifecycle/cleanup | 1 | 2 | Fresh owned pgvector Docker clusters, including controller SIGKILL |
| SMTP transport | 1 | 1 | Real Mailpit; MAILPIT_REQUIRED=1 |
| SMTP application | 1 | 3 | Real Mailpit plus ephemeral control-plane URL; MAILPIT_REQUIRED=1 |

All four gates require exact case counts and zero skips. The repository-wide
AST discovery test covers conventional and nonstandard integration filenames
and sources importing test runners, including database URL helper arguments
and fixture writes. The 41 exact-path exemptions in
`db-sequence-exemptions.mjs` record individual reasons: mocked fixtures,
non-database integration, browser/packed-adopter journeys and the separately
required proofs above. No live PostgreSQL family is silently exempted.

The full migration package was also run with all three CI integration URLs.
Before the approved fixture grant fix: 26 files, 176 passed, 2 failed, 0 skipped.
After: 26 files, 178 passed, 0 failed, 0 skipped.

The sole approved out-of-ownership edit is
`tooling/migrations/src/audit-truncate.integration.test.ts`. Its test role now
has TRUNCATE on all fixture tables in public, brain and support. All assertions
are unchanged. The quality-contract empty-table guard from cb5566b remains
active; cascade permission checks no longer hide the append-only triggers.

## Environment access inventory

`tooling/config/environment-policy.mjs` records 142 exact paths and ceilings
for 409 AST environment accesses. Counts include fixture writes and whole-env
spreads/aliases. Comments and quoted probe strings are excluded. Every entry
has a reason; removed accesses require a lower ceiling. CI compares ceilings
with the PR/push base and rejects new or increased exceptions.

| Category | Files | Accesses |
| --- | ---: | ---: |
| Typed application config | 1 | 6 |
| Typed operator config | 1 | 1 |
| Next instrumentation selectors | 1 | 2 |
| Standalone schema compiler | 1 | 1 |
| Synthetic tests and fixtures | 50 | 143 |
| Standalone build/proof/developer CLI | 30 | 90 |
| Browser fixture launchers/scanners | 20 | 72 |
| Migration operators/guarded fixture config | 3 | 8 |
| Unattended proof controllers | 6 | 14 |
| Vendored developer skill tooling/tests | 29 | 72 |

There are no unreviewed application-runtime reads. The two literal
`process.env.NEXT_RUNTIME` selectors remain because Next must erase Node
imports from edge bundles. Other runtime exemption files have zero direct
environment accesses. Typed operator configuration and the standalone schema
compiler remain explicit exceptions.

Five documented lint limitations remain: module-this and module-arguments
strict-ESM dead ends, deliberate prototype constructor reconstruction, browser
back-references and Linux procfs environment reads. Each has a reason and
a probe in `runtime-env.test.mjs`; lint is not a JavaScript security sandbox.

## Workflow and verification

- Persona accessibility comparison remains unconditional across all 702 cells:
  6 personas × 3 viewports × 39 routes/states, with both authorized and denied
  responses. New violations, worse impact/counts, authorization changes and
  missing/duplicate/unexecuted cells fail. Comparison tests run before scanning.
- All actions are SHA-pinned. upload-artifact v7.0.0 was verified from the
  official tag bbbca2ddaa5d8feaa63e36b76fdaad77386f024f and its action.yml uses
  Node 24. Existing reviewed pgvector/Mailpit/Node digests are retained;
  pgvector services and pre-pulls use the immutable digest, with the compose
  tag explicitly assigned where the harness needs it.
- Database and SMTP JSON receipts upload with missing evidence treated as an
  error. Partial sequence summaries are marked incomplete.
- The microvm-proof job and its KVM caveat are byte-for-byte unchanged.

| Command | Result |
| --- | --- |
| cd tooling/ci && node --test *.test.mjs | 483 passed, zero skips |
| node --test tooling/e2e/audit/*.test.mjs tooling/ci/runtime-env-ci.test.mjs | 12 passed |
| Environment inventory with ENV_INVENTORY_BASE_REF at an existing inventory commit | 5 passed, base comparison exercised |
| pnpm db:ephemeral -- pnpm ci:db-sequence | 17 steps, 358 cases, zero skips |
| node tooling/ci/db-sequence-node-proofs.mjs | 2 + 2 passed, zero skips |
| node tooling/ci/db-sequence-smtp-proof.mjs with owned Mailpit fixture | 1 + 3 passed, zero skips |
| pnpm db:ephemeral -- pnpm rls:proof | 406 checks across 41 tables passed |
| pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test with JSON reporters and 120-second limits | 178 passed after fixture fix |
| pnpm exec turbo typecheck lint test --concurrency=2 | 115/115 tasks passed, 91 cached |
| pnpm exec turbo build --filter=@opentenant/platform --concurrency=2 | 22/22 passed; final workspace gate also rebuilt platform |
| pnpm audit --prod --audit-level high | Zero high/critical; 5 moderate findings |
| node scripts/check-module-special-cases.mjs | 0 special cases |
| Workflow static validation | YAML parsed, 15 jobs; action pins and matrix contract passed; actionlint is not installed |
| Ripwire quality delta against 9e5a0fb | Zero gating regressions; two data-inventory size notes |
| graphify update . | Refreshed, generated output uncommitted; existing SQL-parser/semantic metadata warnings remain |

GitHub Actions execution remains unavailable due to the account billing block.
Hosted runner KVM support and repository required-status settings are not
established by this local/static evidence. No package.json, lockfile or root
script changes are required. The integrator owns central handoff/shiplog updates
and generated-graph integration.
