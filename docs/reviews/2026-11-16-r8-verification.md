# R8 local verification and integration handoff

Base: `41adc71`. Branch: `t3/wave5-r8`. Marketing impact: none.

All implementation changes stay in the assigned paths. No package manifest,
lockfile, historical review, migration, application composition root or generated
graph is committed. No push, publish, live Neon call or global installation was
performed. The frozen-lockfile installation reused all 1,024 installed packages
with zero downloads and ignored lifecycle scripts; subsequent builds used
Turbo concurrency 2.

## Evidence

- E16: `2026-11-16-r8-e16-sql-navigation.md`.
- O17: `2026-11-16-r8-o17-artifact-obligations.md`.
- O19: `2026-11-16-r8-o19-candidate-audit.md`.
- O27: `2026-11-16-r8-o27-credential-rotation.md`.

Every test/build/scan launcher ran inside a foreground `forge-job run` job.
Commands below omit only that wrapper. The exact candidate archives and
count-only audit are regenerated after the final commit and autosquash, in
ignored `dist/release-evidence/`. Check the generated report's revision against
HEAD; this narrative does not substitute for that exact-candidate report.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` | Passed; no manifest or lockfile change, zero downloads. |
| `node --test tooling/graphify/sql-navigation.test.mjs tooling/build/release-obligations.test.mjs tooling/build/audit-candidate.test.mjs` | 8 passed, zero failed/skipped. |
| `pnpm --filter @opentenant/provisioning test` | 24 passed, zero failed/skipped, including 9 API rotation cases. |
| `pnpm --filter @opentenant/provisioning typecheck` and owned-file ESLint | Passed. Full quality gate also covers the final provisioning changes. |
| `pnpm package:check` | All 23 actual artifacts inspected; licence policy, publint, ATTW, SQL hashes and artifact Gitleaks passed. Exit 1 on 3 unattributed-copy files across 2 packages; preparation material retained. |
| `pnpm db:ephemeral -- pnpm ci:db-sequence` | Passed against `pgvector/pgvector:0.8.2-pg17-bookworm`; all ordered stages executed, zero skips. Includes both provisioning paths and 9 isolation fuzz cases, 175 family sequences plus 5 malformed-ID sequences. |
| `./node_modules/.bin/turbo run build --concurrency=2 --output-logs=errors-only` | 25/25 build tasks passed, including platform/template builds. |
| `./node_modules/.bin/turbo typecheck lint test --concurrency=2` with root `node_modules/.bin` on PATH | 115/115 tasks passed, 97 cached. Ordinary database-dependent tests skip without URLs; the dedicated sequence above executed its entire inventory. |
| `node scripts/check-module-special-cases.mjs` | 0 special cases. |
| Repository-scoped `gitleaks git . --log-opts=HEAD --redact=100` | 0 findings at the implementation checkpoint; repeated by the exact-candidate audit after autosquash. No matching values emitted. |
| `graphify update .`, then `node tooling/graphify/sql-navigation.mjs .` | AST refresh and source-linked navigation passed. Missing SQL grammar and unresolved semantic metadata remain documented. Generated files are left out of commits. |
| `git diff --check 41adc71 HEAD` | Passed; repeated after final autosquash. |

Earlier broad attempts failed while build outputs were changing or because the
standalone template could not find the root ESLint binary. The final successful
run used `PATH="$PWD/node_modules/.bin:$PATH"` with the same requested Turbo
arguments. A cleanup-control-flow lint failure in this change was corrected
and covered by an added normalization test before the successful full run.
No failing check or skipped database proof is counted as a pass.

Ripwire's provisioning contract check found no arity/publicness change or
incompatible caller for `createAppRole`. Its current-diff quality check reported
zero gating regressions after cleanup handling was corrected. Its graph is
name based and does not index the new build scripts sufficiently; the static
selection is not a coverage claim. Executable tests and ESLint cover those
scripts. No full `pnpm e2e` or `pnpm a11y:scan` was run. The root quality task
runs the harness's unit/collection safety tests, not browser journeys.

## Integrator wiring

The existing `package:check` script already uses the extended checker. Add these
optional root scripts or their equivalent CI invocations in the integrator's
owned manifest:

```json
{
  "graphify:sql": "node tooling/graphify/sql-navigation.mjs .",
  "release:audit": "node tooling/build/audit-candidate.mjs",
  "release:tool-tests": "node --test tooling/graphify/sql-navigation.test.mjs tooling/build/release-obligations.test.mjs tooling/build/audit-candidate.test.mjs"
}
```

Run the SQL overlay after normal Graphify regeneration; the integrator owns
final graph/report regeneration after merging. JSON query navigation is
repaired locally; HTML/report clustering needs regeneration to include it.

For Neon, review the missing password-reset response/operation schema and supply
the injected API transport. Then compose the real cipher, target/branch
resolution, durable target reservation/checkpoint store and encrypted idempotent
activation callback in platform provisioning. The legacy local SQL factory now
rejects Neon hosts. Do not enable that provider before the composition is wired
and its separately authorized live recovery proof passes. Postgres-local behavior
and all existing grants are retained.

## Owner gates

Resolve the copied-code provenance and pre-import authorship/assignment before
release. Classify every redacted history/artifact finding, approve source offers
and legal material for the actual target matrix, and review security boundaries
and hosted records outside this local audit. This evidence covers current-host
unbundled Node ESM packages; containers, native distributions and other host
targets require their own material. Any live provider validation and public
release still need explicit owner approval. No existing owner gate is cleared.
