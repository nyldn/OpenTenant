# Package releases

Public libraries use one fixed 0.x version group. Add a changeset with
`pnpm changeset`; use a minor bump for a breaking change before 1.0.

`pnpm dev` first builds workspace dependencies, then runs tsdown watchers and
Next together, forwarding the configured development environment. Turbo builds dependencies before lint, typecheck and tests.
Consumers resolve the same ESM and declaration exports locally and from npm.
The private root postinstall also builds libraries so the existing direct Vitest
and database CI commands work after a clean install. No source condition or
per-module Next transpilation list is required.

`pnpm package:check` checks every public workspace with publint, ATTW's ESM
profile and pnpm pack file assertions, emits an SPDX SBOM and checks dependency
licences. It also compares the built migration catalogs against the immutable
pre-conversion checksum fixture. The manifest licences follow LICENSING.md,
including its more-specific-directory exception for authz's Apache-2.0 licence.

The release workflow is manual and defaults to dry run. Enabling publication
requires the owner task in docs/OWNER-TASKS.md and the repository variable
`OWNER_NPM_RELEASE_ENABLED=true`. A non-dry dispatch creates a
Changesets version PR if changesets are pending; after that PR is reviewed and
merged, a separate dispatch can publish with npm provenance. Nothing has been
published as part of this implementation.

## Local verification, 2026-11-11

Node 22.23.2 and pnpm 11.13.1. Evidence logs are retained locally in
`/tmp/opentenant-wave4-evidence/`. No push, PR or npm publication occurred.

| Command | Result |
| --- | --- |
| `IDENTITY_PROVIDER=local PORT=43861 pnpm dev` | Pass; 17 library watchers rebuilt, Next ready in 3.8 seconds, `/api/health` HTTP 200; stopped after proof |
| `pnpm install --frozen-lockfile` | Pass, all 28 workspace projects |
| `pnpm --filter @opentenant/platform build` | Pass, 26 pages generated |
| `pnpm turbo build` | 23/23 builds, including the platform and starter |
| `pnpm turbo typecheck lint test --concurrency=2` | 104/104 tasks; 2,010 test passes, 0 failures, 51 skips |
| `pnpm db:ephemeral -- pnpm --filter @opentenant/migrations test` | Initial run: 176/176 pass. Final run: 175 pass, 1 hook timeout at 10 seconds. One identical retry: 176/176 pass, 0 skipped |
| `pnpm db:ephemeral -- pnpm rls:proof` | 314/314 checks, 31 tenant tables |
| `pnpm turbo build --filter='./packages/*' --filter='./modules/*' --filter=@opentenant/migrations --filter=@opentenant/provisioning` | 21/21 library builds |
| `pnpm package:check` | All 21 public packages pass publint, ATTW, file-list assertions, licence checks and unpacked-tarball secret scanning; 629 SPDX SBOM entries; all 55 migration IDs/checksums preserved |
| `pnpm quality:matrix` | 27 workspaces, 81 quality tasks; verifies prerequisite build ordering |
| `pnpm changeset status` | 21 public packages in one initial minor release |
| `pnpm audit --audit-level high` | Pass; critical 2 → 0, high 0 → 0; 10 moderate and 1 low remain |
| `pnpm audit --prod --audit-level high` | Pass; 0 high/critical, 5 moderate and 1 low |
| `pnpm --dir templates/tenant-module-nextjs audit --audit-level high` | Pass; 0 high/critical, 3 moderate |
| `trivy fs --scanners vuln --include-dev-deps --skip-version-check --severity CRITICAL --exit-code 1 .` | Pass, 0 critical. Before: 4 critical across root and standalone starter lockfiles. The separate vendored Archify tool still has high findings outside this task's ownership |
| `pnpm -r publish --dry-run --provenance --access public --no-git-checks` | Pass, 21 dry-run publication skips, 0 packages published |
| `gitleaks git --pre-commit --staged --redact --no-banner` | Pass, 0 findings. An initial directory-wide scan also inspected ignored Next build credentials and known localStorage keys; its 12 matches were false positives, not task secrets |
| `EIO_BACKEND=posix semgrep scan --config packages/auth-better-auth/semgrep.yml --metrics off --jobs 1 --disable-version-check .` | Pass, 2 local rules, 0 findings |
| `ripwire . --quality-delta --legend=compact` | Pass, 0 gating regressions; 5 minor lockfile/config size/churn signals |
| `ripwire . --pr-context` | Completed change-impact review |
| `graphify update .` | Completed; generated graph left uncommitted. Existing extractor warnings include missing SQL grammar and semantic node metadata |
| `git diff --check` | Pass, 0 whitespace errors |

The first unconfigured dev request rejected the absent identity provider. The
configured local proof above passed; `pnpm dev` now forwards caller environment
configuration through Turbo. Watch tasks retain existing output while rebuilding
so concurrent declaration generation does not remove another task's inputs.

The final Semgrep run exhausted the host io_uring allocation. Its single-worker
POSIX retry passed with zero findings.

The first build attempts exposed a missing default ESM condition in Next's
config loader and an incorrect licence-copy destination; both were fixed.
The first quality attempt exposed e2e's undeclared app source imports. Turbo
now orders that typecheck after the platform typecheck. The existing CI
quality validator is reused through a build-aware wrapper; its command and
workspace coverage checks remain active. No e2e source or database CI job
was edited. No pre-commit or Promptfoo configuration exists in this checkout.

The 51 normal-suite skips require database or external-service environments;
they are not counted as database proof. The explicit ephemeral migration and
RLS runs above supply the requested database evidence. Existing Next build
warnings concern rate-limiter dynamic imports and the ESLint plugin notice.

The integrator owns updates to HANDOFF, SHIPLOG and CHANGELOG after combining
parallel work. Publication and actual provenance remain unperformed owner tasks.
