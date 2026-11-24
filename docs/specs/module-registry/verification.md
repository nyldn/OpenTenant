# Module registry verification and integration handoff

Date: 2026-11-11. Branch: `t3/module-registry-extensibility`.
Marketing impact: truth.

## Wave 4 integration

The handoffs below are historical. Wave 4 wires registry installation seeding
and fleet plans, removes the legacy adapters, moves module-owned host behavior
into module packages, and supplies built packages and SQL assets. The audit is
150 matching lines before integration follow-up, zero after six documented
app exclusions; an extended shared-runtime audit removes 20 further matches
with one shared rate-budget type exclusion. Packed-tarball installation proof and runtime package/module env
lint are CI checks. See the [integration review](../../reviews/2026-11-11-integration-wave4a.md)
for the complete verification record.

## Result and ownership limits

The SDK contract, installed composition, generic host consumption, SDK-only
Hello package, live-host installation regression tests and migration parity
checks are implemented. This branch does **not** meet the zero-special-case
criterion. Existing module-specific adapters and installation wiring outside
assigned ownership remain for the integrator. No push or PR was made.

No control-plane schema change was needed; 0070–0072 remain unused. The sample
uses its own tenant-hello/0001 namespace. No historical SQL was edited.

## Required checks

Counts are passing / failing / skipped tests or assertions, except rows explicitly
counted as tasks or commands. Skips are not counted as proof. The ordinary root
suite omits database and external-service suites; the requested database proofs
below ran against the pinned pgvector/Postgres 17 image with zero skips.

| Exact command | Outcome |
| --- | --- |
| `pnpm turbo typecheck lint test --concurrency=2` run 1 | Failed after 60/84 tasks succeeded. Completed package summaries: 1,229 passed, 1 failed, 42 skipped. The existing mounted Assessment demo stream assertion failed under load. Remaining tasks were canceled. |
| Same command run 2 | 84/84 tasks succeeded; 2,015 passed, 0 failed, 52 skipped. |
| Same command run 3, including the new host-entrypoint installation tests | 84/84 tasks succeeded; 2,018 passed, 0 failed, 52 skipped. |
| Same command run 4, after restoring the manifest-declared header shortcut | 84/84 tasks succeeded; 2,018 passed, 0 failed, 52 skipped. |
| `pnpm --filter @opentenant/platform build` run 1 | Failed on Next lint's reserved `module` variable name in two changed files. Both declarations were renamed. |
| Same build command run 2 | Passed, 1 command, 0 failures. Existing rate-limiter dynamic-require and Next ESLint-plugin warnings remain. |
| Same build command run 3, after the header contribution | Passed, 1 command, 0 failures, 0 skipped. |
| `pnpm db:ephemeral -- pnpm rls:proof` | 314 passed, 0 failed, 0 skipped across 31 installed tenant tables. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | 177 passed, 0 failed, 0 skipped in 25 files. Includes sample SQL execution, RLS, replay, and built-in disk/checksum parity. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts lib/provisioning-postgres.integration.test.ts` | 3 tests passed, 0 failed, 0 skipped, but the command failed on one 10-second teardown-hook timeout. This run is not a pass. |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/platform exec vitest run lib/provisioning.integration.test.ts lib/provisioning-postgres.integration.test.ts --fileParallelism=false --hookTimeout=60000` | The one timeout rerun passed: 3 passed, 0 failed, 0 skipped in 2 files. |
| `pnpm e2e` run 1 | Failed in global setup, 0 browser tests executed. Running this beside the build caused conflicting `.next` artifacts. |
| `pnpm e2e` run 2, after build completion | 11 passed, 0 failed, 0 skipped; Playwright Chromium, 3.9 minutes. |
| `git diff --check` | Passed, 0 whitespace errors. |

The first focused platform development run found two stale expectations: a
home test needed mocks for new navigation dependencies, and a legacy catalog
expectation exceeded the installed role ceiling. Both were corrected. A later
host-entrypoint test initially failed 2 of 3 cases because the sample used
`hello.read` without a claim. It now follows the existing `hello.use` base
permission convention. Its rerun with the projection tests passed 5/5.

Full-check totals combine each package's final Vitest/TAP summary, including
cached summaries. Suites reporting zero tests when their database environment
is absent are additionally visible in the logs, not converted into assertions.

## Special-case audit

The exact case-sensitive pattern was
`assessment|ASSESSMENT_MANIFEST|"support"|"brain"`, applied to `apps/platform`
with the composition file excluded. Before: **172 matching lines**. After:
**151 matching lines**. `git grep` against the initial HEAD independently
confirmed the baseline. These counts include tests, CSS and legacy module code.

The remaining matches are saved in [special-cases.txt](special-cases.txt).
They include Assessment pages/readout/CSS, support services and route classes,
logout cookie handling, test fixtures, configuration, Next configuration, and
MCP routes. No claim is made that moving the registry removed these adapters.

## Platform files changed

- `apps/platform/app/[...modulePath]/page.tsx`
- `apps/platform/app/access/[module]/page.tsx`
- `apps/platform/app/api/module-access/[module]/route.test.ts`
- `apps/platform/app/api/module-access/[module]/route.ts`
- `apps/platform/app/api/module-access/assessment/route.test.ts` (removed; replaced by the generic `[module]` route)
- `apps/platform/app/api/module-access/assessment/route.ts` (removed; replaced by the generic `[module]` route)
- `apps/platform/app/api/settings/module-access/route.ts`
- `apps/platform/app/api/settings/navigation/route.ts`
- `apps/platform/app/page.test.tsx`
- `apps/platform/app/page.tsx`
- `apps/platform/app/settings/modules/page.tsx`
- `apps/platform/app/settings/navigation/page.tsx`
- `apps/platform/lib/assessment-access.ts`
- `apps/platform/lib/module-access-gate.ts`
- `apps/platform/lib/module-access.test.ts`
- `apps/platform/lib/module-access.ts`
- `apps/platform/lib/module-installation.test.ts`
- `apps/platform/lib/module-navigation.ts`
- `apps/platform/lib/module-registry.ts`
- `apps/platform/lib/module-third-party-access.test.tsx`
- `apps/platform/lib/module-view.tsx`
- `apps/platform/opentenant-modules.ts`
- `apps/platform/package.json`

## Integrator wiring

- `tooling/migrations/src/hosted.mjs` must plan fleet migrations with
  `TENANT_MODULE_CATALOGS`, following tenant core. The apply path already calls
  the now registry-derived `migrateTenantModules`; dry-run planning still uses
  two deprecated built-in aliases.
- Installation/control-plane setup must apply
  `installedModules.migrations.controlPlane` and call `seedModuleCatalog`
  transactionally after the platform schema. The host exports
  `seedInstalledModuleCatalog`, which reuses `withControlPlaneTransaction`.
  Default tenant assignments and local seeding must derive from the registry.
- Module-specific host adapters outside assigned ownership must move to module
  packages before the 151-match remainder can reach zero. The existing explicit
  Assessment and Support Next pages take precedence over the native catch-all.
- The package-build agent must build SDK/module entrypoints before the host,
  bundle or ship the manifests' existing raw SQL assets, preserve manifest
  entrypoints, bundle the migration tooling with its host-composition import,
  and remove per-module `transpilePackages`. The Hello module is
  executable ESM JavaScript and needs no new transpilation entry. No existing
  package build/exports/private fields, `next.config.ts`, CI, e2e tooling or
  `app/api/mcp/**` were modified.

## Security and structural checks

- Gitleaks: repository source snapshot, repository-relative paths, redacted JSON,
  0 leaks. The first scan used absolute snapshot paths and reported 11 existing
  browser-storage-key false positives because anchored allowlists did not match;
  rerunning from the snapshot root resolved all 11 without changing allowlists.
- Semgrep: `EIO_BACKEND=posix semgrep scan --config packages/auth-better-auth/semgrep.yml --jobs 1 --metrics off --disable-version-check --json --output /tmp/module-semgrep-final.json packages/module-sdk packages/platform-core modules apps/platform tooling/migrations examples/module-hello`.
  Two local rules, 397 targets, 0 findings. The final header contribution was
  rescanned over its four changed source files with the same rules and no findings.
  This is a limited rule scan.
- `trivy fs --offline-scan --skip-db-update --skip-java-db-update --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format json --output /tmp/module-trivy.json .` failed with two existing critical cached advisories for `tinypool@1.1.1`, CVE-2026-104848 and CVE-2026-104849. No dependency upgrade is included here.
- `pnpm audit --prod --audit-level high` passed the requested threshold:
  0 high/critical, 5 moderate and 1 low advisory.
- No `.pre-commit-config.yaml` or Promptfoo configuration exists.
- `ripwire . --quality-delta` initially reported five gating findings. Extracting
  the home navigation projection and reusing the existing transaction helper
  removed the complexity and duplication findings. Two historical churn signals
  remain on the deprecated migration catalog aliases; no finding was suppressed.
  `ripwire . --edit-check=resolveModuleAccess` found two callers and no incompatible
  signatures. Ripwire is not a substitute for compiler/runtime validation.
- `graphify update .` refreshed the AST graph with no API calls. Existing SQL
  parser and semantic-node metadata warnings remain. Generated graph files are
  deliberately uncommitted.

## Provenance

The API follows explicit extension registration ideas from Backstage
backend-plugin-api, Apache-2.0. The documents follow spec-kit's MIT layout.
No third-party source code was copied or new vendor SDK installed.
