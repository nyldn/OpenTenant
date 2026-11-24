# Wave 5 wiring verification

Base: `472840354a9eccbfe3b90fb037773027ed621d26`. Branch: `t3/wave5-wiring`.
The integration branch's later Neon fix is not included or rebased into this work.
No push, live model call, environment-file edit or baseline/remap change occurred.

Configuration and remaining dependencies are documented in
[Wave 5 AI host settings](wave5-ai-wiring.md).

## Approved edits outside the original ownership list

Each has its own commit:

- Support barrel export lines for the existing AI factory and host types.
- Brain public export and optional `BrainCallOptions` forwarding, plus a test
  proving embedding/signal object identity and unchanged omitted defaults.
- Only the platform `@opentenant/quality-contract` workspace dependency and its
  lockfile importer entry. Generated with `pnpm install --lockfile-only` and
  inspected for unrelated lockfile changes.
- Type-only imports and explicit return annotations on `seedQualityModule` and
  `qualityBindingJourney` in the existing database proof helper. No runtime code
  or assertions changed. The dedicated R7 database suite was rerun afterward.
  TypeScript transpilation also confirms its emitted JavaScript is unchanged.

## Local checks

Tests and builds ran in foreground `forge-job run` jobs. Database proofs used
the ephemeral `pgvector/pgvector:0.8.2-pg17-bookworm` image and random loopback
ports. No missing-pgvector skip was accepted.

| Command | Result |
| --- | --- |
| `pnpm --filter @opentenant/platform test lib/server-config.test.ts lib/model-router.test.ts lib/model-router-policy.test.ts lib/model-router-adapters.test.ts lib/brain-host-wiring.test.ts lib/support-ai-composition.test.ts lib/quality-contract-binding.test.ts workflows/tenant-worker-registration.test.ts workflows/support-ai-retention.test.ts` | 104 passed, 0 skipped |
| `pnpm --filter @opentenant/brain --filter @opentenant/support test` | Brain 60 passed; Support 168 passed, 25 database cases deferred to the dedicated proofs |
| `pnpm db:ephemeral -- pnpm ci:db-sequence` | All 12 steps passed; 208 proofs, 0 failures, 0 skips. Includes R6 17, R7 9 and isolation fuzz 9 cases covering 175 family sequences plus malformed IDs |
| `pnpm db:ephemeral -- pnpm rls:proof` | 406 checks passed across 41 tenant tables |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/database test src/quality-contract-store.integration.test.ts` | After the approved type-only fix: 9 passed, 0 skipped |
| `pnpm --filter @opentenant/e2e typecheck` | Passed after the approved type-only fix |
| `pnpm --filter @opentenant/platform test` | 693 passed, 36 database cases skipped in this mode |
| `pnpm exec turbo typecheck lint test --concurrency=2` | 115 of 115 tasks passed; fresh platform build included. Vitest task summaries total 2289 passed and 139 routine skips |
| `pnpm exec turbo build --filter=@opentenant/platform --concurrency=2` | 22 of 22 tasks passed from the cache populated by the successful fresh build |
| `CI=1 pnpm e2e brain-state.spec.ts support-ai-review.spec.ts quality-contract-binding.spec.ts support.spec.ts support-email.spec.ts developer-mcp.spec.ts` | Requested files: 9 passed. The substring filter also selected `managed-support.spec.ts`, which failed, so the command exited 1 with 9 passed, 1 failed, 0 skipped |
| `CI=1 pnpm e2e specs/brain-state.spec.ts specs/support-ai-review.spec.ts specs/quality-contract-binding.spec.ts specs/support.spec.ts specs/support-email.spec.ts specs/developer-mcp.spec.ts` | Exactly the six requested files: 9 passed, 0 failed, 0 skipped across three phases |
| `node scripts/check-module-special-cases.mjs` | 0 special cases; existing exclusions unchanged |
| `gitleaks git .` with redacted, private reports | 0 branch findings; 32 historical findings |
| `git diff --check 4728403 HEAD` | Passed |

The managed-support failure showed the unchanged entry form's "Action accepted."
status instead of the expected "Managed support for" banner after session start.
The page, generic form and support-session route are outside this wiring and are
unchanged. This result is reported separately from the six requested spec files.
A retry with fully qualified spec paths hit an occupied randomly allocated port.
The harness timed out and cleaned up; no process holding that port was killed.

The full platform suite also rejected a new retention pool under its existing
pool-ownership rule. The worker now uses one short-lived `pg.Client` per purge;
all seven pool-boundary tests and 17 retention/registration tests pass unchanged.

The first browser attempt overlapped the platform build and failed because both
used `.next`. Subsequent build and browser runs were serialized. Initial focused
runs also caught a mock returning `undefined` instead of a Promise, a valid model
name incorrectly used as an invalid fixture, and an optional route fixture type.
Those test fixture errors were corrected. The full type gate then exposed R7's
inferred-return portability failure, resolved by the separately approved type-only
proof-helper change.

Routed Support generation remains unavailable because independent recorded router
preparation/parent/consent provenance and the encrypted owner quarantine are absent.
Verified current voice is composed. Suggestions have no sending or ticket mutation
port. Retention is off without explicit privileged per-tenant configuration; its
existing SQL function has no row-limit argument, so the worker bounds tenant
fan-out and SQL execution time. No individual hard-ticket-delete scheduler exists;
the registered post-purge hook and minute reconciliation cover missing tickets.
Quality evidence has no HTTP caller and refuses missing trusted artifact custody
or live permissions. No authorization grant was weakened or introduced.

Graphify was refreshed with AST extraction and no model/API call. Its optional
SQL parser is missing, so 67 SQL files contributed no nodes; extraction also
reported nine existing nodes without `source_file`. Generated graph files remain
uncommitted, as required.

Marketing impact: none.
