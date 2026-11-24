# Runtime environment lint family evidence

Branch: `t3/env-lint-families`, created from
`e5995e93ed3303138c975ca8f322a3bce0d3ceee`. Node `v22.23.2`, pnpm `11.13.1`.
Marketing impact: none.

The runtime globs and previous exclusions are unchanged. The only new exclusion
is `packages/platform-core/src/runtime-globals.ts`. It exposes narrow operations,
never the global object or environment. Browser callers use its dedicated
`@opentenant/platform-core/runtime-globals` export so client bundles do not load
the server-only model router through the main package export.

The lint bans every computed process member, ambient global references,
process env/getBuiltinModule access and bare process aliases, process/module
imports and re-exports, literal process/module requires and dynamic imports,
nonliteral dynamic imports, eval/Function and common constructor chains.
Reflective calls receiving ambient globals or process are rejected through
the argument reference bans, leaving ordinary-object descriptors intact.
Core no-eval, no-implied-eval, no-new-func and no-with are enabled.

Refactors cover the three platform pool/store singletons, Assessment storage,
UI events, confirmations, location and timers, design-system mobile/theme/brand
operations, brand upload navigation, Support hashing, and Notifications SMTP.
The singleton helper keeps the existing Symbol.for keys, truthiness checks,
lazy factory evaluation and delete-before-teardown behavior. SMTP has no loader
import and uses a literal await import only when the first valid send needs it.

## Residuals

The policy contains a reason for each ID, and probes exercise each in every root.

- `module-this`: top-level and lexical-arrow this are undefined in strict ESM.
- `module-arguments`: no ESM module arguments binding; strict-mode callee/caller
  recovery throws. Tests execute these dead ends in real ESM data modules.
- `prototype-constructor`: reconstructing a code compiler through prototype
  traversal or split/computed constructor lookups is deliberate bypass code
  that review would plainly reject.
- `browser-back-reference`: document.defaultView or event-target global recovery
  followed by process lookup is deliberate bypass code that review would reject.
- `indirect-loader`: aliasing require or synthesizing loader paths to recover
  process/module is deliberate bypass code that review would reject.

The rule prevents ad-hoc and accidental configuration reads. Review and the
untrusted-module sandbox address deliberate obfuscation. It is not a sandbox.

## Verification

Raw logs and scanner JSON are in `/tmp/opentenant-env-lint-evidence/` on the
implementation host. Counts below are test cases unless labelled tasks/checks.

| Exact command | Passed | Failed | Skipped | Evidence |
| --- | ---: | ---: | ---: | --- |
| `pnpm e2e` | 19 | 0 | 0 | e2e-1.log; 11 legacy + 8 journeys, both phases use disposable pgvector/Postgres 17 |
| `git diff --check e5995e9 HEAD` | 1 check | 0 | 0 | git-diff-check.log; checked after the local commit |
| `pnpm turbo lint --force` | 49 tasks | 0 | 0 | lint-3.log; 45.023s, zero cache hits |
| `pnpm --filter @opentenant/platform build` | 1 build | 0 | 0 | platform-build-2.log; 29 static pages generated |
| `node --test tooling/ci/runtime-env.test.mjs` | 320 | 0 | 0 | runtime-env-final.log |
| `pnpm turbo typecheck lint test --force --concurrency=2` | 2376 | 0 | 75 | quality-3.log; 112/112 tasks, 4m11.358s, zero cache hits |

The general suite's skips require optional live database/service fixtures.
The standalone runtime test includes 42 grader regressions across the three roots,
126 further rejected probes, 57 original probes, 60 allowed probes, 27 accepted
residual probes and three with rejections, plus five parent/ESM/inventory tests.
No test timed out in any run, including both browser phases, so no timeout retry
was needed. No push, PR, publication or production operation was performed.

## Development failures and retries

- `node --test tooling/ci/runtime-env.test.mjs`, initial matrix: 308 passed,
  12 failed, zero skipped. Three leaf failures per root were test assertions:
  unused interface/class fixtures and TypeScript's permissive parsing of with.
  Exported the fixtures and asserted the no-with diagnostic. The corrected
  matrix passed 320 tests without skips; repeated after the ESM test fix below.
- `pnpm turbo typecheck lint test --force --concurrency=2`, run 1: 42 successful
  tasks of 63 scheduled at cancellation. CI typecheck had five TS2307 errors
  resolving literal data URLs in the new ESM tests. Constructed their URLs in a
  tooling-only test helper. Observed completed tests: 719 passed, zero failed,
  eight skipped. This was a typecheck failure, not a timeout.
- Same full gate, run 2: 108 successful tasks of 109, then Next raised an internal
  null.length error. It overlapped a forced lint dependency rebuild. Observed
  completed tests: 1,876 passed, zero failed, 66 skipped; platform tests did not
  run because their build failed.
- `pnpm --filter @opentenant/platform build`, run 1, serialized: failed with a
  node:crypto webpack URI error through platform-core's main export. Added the
  dedicated browser-safe runtime-globals export and switched callers to it.
- Initial unfiltered `gitleaks dir . --redact --no-banner --report-format json
  --report-path /tmp/opentenant-env-lint-evidence/gitleaks.json`: 10 findings in
  generated dist/Next output. A first source scan mistakenly extended rather
  than copied the existing allowlists and reported 11 existing Assessment
  storage-key false positives. The final source scan copies `.gitleaks.toml`
  including its exact key allowlists, and excludes generated .next, dist,
  graphify-out and installed node_modules. It reports zero findings.

## Runtime implementation files

- `apps/platform/lib/rate-limit.ts`
- `apps/platform/lib/admission.ts`
- `apps/platform/lib/control-plane.ts`
- `apps/platform/app/admin/tenants/[tenantId]/brand-proposals/brand-document-upload-form.tsx`
- `packages/platform-core/src/runtime-globals.ts`
- `packages/notifications/src/smtp.ts`
- `packages/design-system/src/components/theme-provider.tsx`
- `packages/design-system/src/components/ui/sidebar.tsx`
- `packages/design-system/src/hooks/use-mobile.ts`
- `packages/design-system/src/lib/brand.ts`
- `modules/assessment/src/persistence/assessment-repository.ts`
- `modules/assessment/src/runtime.ts`
- `modules/assessment/src/assessment-shell.tsx`
- `modules/assessment/src/assessment-responses.tsx`
- `modules/assessment/src/host-mount.tsx`
- `modules/assessment/src/assessment-exports.ts`
- `modules/support/src/support-ai-policy.ts`

## Source and dependency checks

- `gitleaks dir . --config /tmp/opentenant-env-lint-evidence/gitleaks-source.toml --redact --no-banner --report-format json --report-path /tmp/opentenant-env-lint-evidence/gitleaks-final.json`: passed, zero findings. The temporary config is a copy of the repository's `.gitleaks.toml` plus one generated-output path exclusion for `node_modules`, `.next`, `dist` and `graphify-out`.
- `semgrep scan --config packages/auth-better-auth/semgrep.yml --metrics off --disable-version-check --error --json --output /tmp/opentenant-env-lint-evidence/semgrep-final.json .`: passed, two rules on 884 files, zero findings. Two unchanged files have partial-parse warnings, `.agents/skills/archify/renderers/shared/utils.mjs` and `modules/support/src/support-ai.ts`. Semgrep also skips 128 ignored files and one file larger than its limit.
- `trivy fs --scanners vuln --offline-scan --skip-db-update --skip-java-db-update --severity HIGH,CRITICAL --exit-code 1 --format json --output /tmp/opentenant-env-lint-evidence/trivy.json .`: passed, zero HIGH/CRITICAL findings using the cached database.
- `pnpm audit --prod --audit-level high`: passed, zero high/critical findings; one low and five moderate advisories remain.
- `ripwire . --quality-delta`: passed, zero gating regressions and three minor pre-existing-shape/churn observations. `ripwire . --edit-check=controlPlanePool` reports its contract unchanged. The bounded change report's name-based graph does not resolve every test edge; the actual package suites and loopback SMTP proof pass in the forced gate.
- `graphify update .`: passed with existing missing SQL grammar and extraction warnings. Generated graph files are deliberately uncommitted on this feature branch.
- Pre-commit is not applicable because `.pre-commit-config.yaml` is absent. Promptfoo is not applicable because there is no project configuration and no prompt/RAG change.
