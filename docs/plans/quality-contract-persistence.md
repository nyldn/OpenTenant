# Quality-contract persistence

Status: Accepted for implementation (engineering scope)

Owner decision 2026-11-17: Option 1

Quality-contract and evaluation records are insert-only and audited during the
tenant's lifetime. Authorized hard erasure deletes them with the tenant's other
evidence and audit rows. The existing platform-scoped erasure receipt remains
authoritative. This decision supersedes the original proposal's permanent
retention assumption and the blocked reconciliation recorded in commit 2dca40c.
Acceptance was recorded separately before implementation.

Scope: wave-5 R7, backlog E18. Marketing impact: none.

## Reconciliation with the current implementation

Phase 0 already validates immutable contract values, computes canonical SHA-256
digests, rejects weakened contracts and stale run digests, composes an effective
contract, and evaluates runs deterministically. Persistence adds durable binding
to those values without changing the evaluator's decisions.

`ModuleManifest` and the installed registry describe module contributions and
permissions. They provide no artifact evidence. `seedModuleCatalog` seeds
platform-owned `legacy_identity` versions, which remain ineligible. Migration
0014 and `PgModuleOwnershipStore` already distinguish tenant-private ownership,
installation ownership, artifact SHA-256 and legacy identities. The new store
uses that boundary rather than changing registry or manifest semantics.

`PgAuditStore.appendWithClient` supports an evidence row and matching audit
event in one transaction. Neighbouring control-plane stores use explicit tenant
binding rather than session RLS. The new store follows that pattern, checks
ownership on every access and uses composite tenant/artifact foreign keys.
It must only be composed in trusted host code.

R2's migration 0084 and `authz-outbox.ts` publish membership and entitlement
desired state. Quality evidence changes neither. It does not enqueue
authorization work, replace reviewed manifests or bypass the live
authorization fence. Existing permissions and active-tenant checks belong at
the trusted binding boundary.

The original proposal conflicted with migrations 0043-0044. Their owner-only
`hard_erase_tenant` / `tenant_erase_rows` procedures follow foreign keys and
relax immutable user triggers within the erasure transaction. New tenant-bound
tables automatically enter that traversal, including their audit references.
Option 1 resolves this conflict without changing the offboarding policy.

The smallest E18 design is one immutable contract per exact tenant/module
version/artifact tuple, followed by immutable deterministic baseline/candidate
evaluation envelopes. No Lab execution, publishing, UI, route, model call or
cross-tenant reuse is introduced.

## Persisted records and trusted computation

Migration 0090 adds `module_quality_contracts` and
`module_quality_evaluations`. Contract rows contain the validated body, logical
contract ID/version, canonical SHA-256, exact artifact tuple, submission ID,
request fingerprint, actor, reason, timestamp and audit sequence.

The artifact tuple is `tenant_id`, `module_key`, `module_version`,
`artifact_digest`. A unique key on `module_versions` supports the exact artifact
foreign key. Insert guards and store lookups require `ownership_scope=tenant`,
the same owner tenant and installation, and `digest_kind=sha256_artifact`.
Platform-owned, installation-owned, legacy, unknown and mismatched versions are
ineligible. One artifact tuple has one contract. Reusing a logical contract
ID/version for another artifact is allowed only with identical body and digest.

Each evaluation references both immutable contract rows through composite keys
that include their tenant and exact artifact. Baseline and candidate must use
the same module and tenant, different versions and different artifact digests.
Its versioned JSON envelope stores both bindings, both contract digests,
normalized runs and their digests, the effective contract and digest, and the
complete evaluator result and digest. The envelope itself has a SHA-256 digest.
The evaluator version is pinned to `quality-contract.phase0.v1`.

`qualityContractPersistenceCodec` owns schema validation, canonical digests,
effective-contract composition and deterministic evaluation. The database
store receives this trusted codec as a structural dependency. Callers supply
contracts and runs, never verdicts or effective contracts. This avoids an
unowned dependency or barrel edit in the database package.

Malformed, duplicate, oversized or non-finite run data is refused. Artifact or
tenant mismatch aborts the transaction. Well-shaped runs with stale contract
digests and proposals that weaken the baseline can be retained only as rejected
evaluator evidence. They cannot become accepted evidence. Rejected and
`no_change` comparisons remain attributable history.

## Audit, concurrency and mutation guarantees

A tenant advisory transaction lock serializes quality writes with audit appends.
The store appends the exact audit event on the same checked-out client before
inserting evidence. A database insert trigger requires the same tenant, actor,
action, subject, timestamp and exact metadata, and requires the audit row to
have been inserted by the current transaction. Foreign keys retain that link.
Failure rolls back both the audit event and evidence row.

Submission IDs replay only when the normalized request fingerprint matches.
Conflicting replay, a second contract on one artifact or a duplicate evaluation
envelope under another submission ID is refused. Store reads bind the full
artifact tuple, recheck ownership, recompute body digests and evaluator output,
verify the matching audit event and append a read audit before returning data.
No caller receives evidence if its read audit fails.

Statement triggers reject ordinary UPDATE, DELETE and TRUNCATE on both tables,
including direct SQL. The database is a trusted control plane: its owner can
alter triggers, as with neighbouring immutable evidence tables. The store's
codec and host composition are part of the trusted computing boundary; SQL
constraints do not independently implement the TypeScript evaluator.

## Authorized erasure

The normal retention deadline and provider-erasure checkpoint still gate
`hard_erase_tenant`. Its foreign-key traversal deletes quality evaluations,
contracts and tenant audit rows with the rest of the tenant's evidence. The
worker and the platform-scoped receipt are unchanged.

The proof exposed a pre-existing cycle between `module_catalog` and
`module_versions`. Migration 0091 bounds recursion by the current relation path,
so a back-edge is left for the outer invocation instead of expanding recursive
SQL indefinitely. It preserves all foreign keys and the existing four-argument
`tenant_erase_rows` entry point. Unresolved references still fail closed.

Traversal disables user guards before descending and collects the guarded
relations. After deleting the complete root, it checks the deferred catalog
initial-version FK, restores user triggers and restores that FK's normal
initially-deferred mode. This avoids PostgreSQL's refusal to ALTER a table with
pending deferred trigger events. Trigger changes and deletes roll back together;
exclusive table locks protect the temporary relaxation. Both helper functions
remain invoker-rights and have PUBLIC execution revoked. No general session flag
or application-role bypass is added.

The DB proof checks lifecycle denial, future retention, missing provider
erasure, rollback restoring rows and guards, committed erasure of populated
quality lineage, preservation of a second tenant and its audit chain, and
ordinary mutation rejection after erasure.

## Integrator wiring

These files are outside R7 ownership and were deliberately not edited.

1. Include `qualityContractPersistenceCodec`, `validateEvaluationRun`,
   `QUALITY_EVALUATOR_VERSION` and the persistence types in the quality-contract
   barrel. Include `PgQualityContractStore`, `QualityPersistenceError`,
   `QualityPersistenceCodec`, input, reference and record types in the database
   barrel. The existing unbundled build emits reachable source after these
   exports are wired; no new package dependency is needed.
2. Compose `new PgQualityContractStore(controlPlanePool(),
   qualityContractPersistenceCodec)` in the trusted host. Derive active tenant,
   authenticated actor and write authority from live host context. Check the
   existing `module.dev.contract.read` / `module.dev.evidence.read` permissions
   on reads and appropriate live write authority before mutation. Supply a
   real tenant-private module version and SHA-256 of its artifact bytes.
   Manifests, entitlements and legacy identity hashes are not artifact proof.
3. Register the 0090 and 0091 checksums below in the migration inventory and
   checksum baseline. The canonical SQL directory loader already discovers the
   forward migrations. Update the reservation status when integrating.
4. Add a `STORE_SUITES` entry in
   `tooling/ci/run-database-store-tests.mjs` with id `quality-contract`,
   testPath `src/quality-contract-store.integration.test.ts`,
   database `opentenant_it_store_quality_contract`,
   urlVariable **`QUALITY_CONTRACT_DATABASE_URL`**, testEnvironment
   **`QUALITY_CONTRACT_DATABASE_URL`**, setup `self`, and all nine exact `it`
   titles from the test. Add **`QUALITY_CONTRACT_DB_REQUIRED=1`** to that child's
   environment so missing configuration fails instead of skipping. Register
   the fixed database in `tooling/ci/create-integration-databases.mjs` and update
   its inventory tests. The existing `stores` step in `ci:db-sequence` then runs
   it; no duplicate sequence step is needed.
5. Use a dedicated synthetic loopback database URL on the ephemeral random
   port, never 5432. The fixture creates its own uniquely named child database,
   applies the full canonical catalog and drops it afterward, so its login also
   needs CREATEDB. It never resets a shared schema. `QUALITY_CONTRACT_DATABASE_URL`
   is the preferred fixture URL; direct ephemeral execution falls back to
   `CONTROL_PLANE_INTEGRATION_DATABASE_URL`. The Playwright journey also accepts
   `CONTROL_PLANE_DATABASE_URL` in the shared harness.

`quality-contract-binding.spec.ts` is already registered in the journeys phase,
raising that phase's inventory to 41. It exercises the server-side store against
PostgreSQL because E18 has no host route or UI.

## Migration checksums

| Control-plane migration | SHA-256 |
| --- | --- |
| `0090_quality_contract_persistence.sql` | `728a54c3e4ddb76411c95855868680fdc9a09339ecdd6023dc46d46f20b4cefd` |
| `0091_quality_lineage_erasure.sql` | `97fec72ada41740f280a2da8c6a9cd95ad42d2c0e7bf85c44f1657008deb72da` |

## Verification, 2026-11-17

Every test and build runs through a foreground `forge-job run`. The mandatory
DB and server-side journey use `pnpm db:ephemeral` with
`pgvector/pgvector:0.8.2-pg17-bookworm`. No full E2E or accessibility scan runs.

| Command inside `forge-job run` | Result |
| --- | --- |
| `env QUALITY_CONTRACT_DB_REQUIRED=1 pnpm db:ephemeral -- pnpm --filter @opentenant/database exec vitest run src/quality-contract-store.integration.test.ts --hookTimeout=120000 --testTimeout=120000` | 9 passed, zero skipped, including authorized erasure. |
| `env PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/turbo typecheck lint test --filter=@opentenant/database --filter=@opentenant/quality-contract --concurrency=2` | 12 tasks passed. Optional DB suites skip without URLs; the mandatory invocation above covers all nine quality cases. |
| `pnpm --filter @opentenant/quality-contract test` | Final standalone run: 58 passed. An earlier attempt overlapped a security dependency rebuild and failed to resolve that package; rerun passed after the rebuild. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/e2e exec playwright test --config=/tmp/r7-playwright.config.ts` | 1 passed. Temporary config selected only the binding spec, with one worker and no browser or server. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/tenant-worker.integration.test.ts lib/tenant-lifecycle.integration.test.ts --hookTimeout=120000 --testTimeout=120000` | 13 passed, zero skipped. Existing worker/lifecycle regression proof for 0091. |
| `pnpm db:ephemeral -- pnpm ci:db-sequence` | Stops at the exhaustive store inventory because the new integration suite is unregistered. The integrator wiring above is required; later sequence steps did not run. |
| `./node_modules/.bin/turbo typecheck lint test --concurrency=2` | Stops at the existing standalone-template `eslint: not found` PATH issue. |
| `env PATH="$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/turbo typecheck lint test --concurrency=2 --continue=always` | 114 of 115 tasks passed. Only the expected migration checksum inventory check failed for new 0090/0091. Includes database, quality and E2E typecheck/lint/test, and a successful platform build. |
| `./node_modules/.bin/turbo build --filter=@opentenant/platform --concurrency=2` | 21 tasks passed from cache after the successful aggregate build. |
| `node scripts/check-module-special-cases.mjs` | `specialCases: 0`. |
| `git diff --check 41adc71 HEAD` | Passed. |

The initial erasure runs exposed the catalog/version traversal cycle and then
PostgreSQL's pending-trigger ALTER restriction. Both were corrected in 0091
before the final nine-test DB run and thirteen-test worker/lifecycle run.

Ripwire's store contract check found no incompatible caller. Its quality delta
flagged eight duplication findings involving tuple mappings and canonical hash
helpers, plus new-store size and parameter-count observations. The mappings
cross database/domain boundaries. Existing generic hash helpers are private or
use a `sha256:` prefix; `qualityContractDigest` validates a contract rather than
arbitrary evidence. R7 retains small local helpers instead of adding an unowned
security-package export or a database-to-quality package dependency. The
automated duplication gate is not reported as passing.

`graphify update .` completed with the existing missing SQL-parser and nine
metadata warnings. Generated graph output is excluded from the branch.

All recorded R7 forge units were stopped and verified inactive. The ephemeral
proof containers were removed; unrelated running containers were preserved.
`forge-job audit` found no unmanaged development servers, and
`agent-fleet status` reported no baseline drift. No push occurred.
