# Local deployment verification

Date: 2026-11-11. Scope: deployment definitions in the
`t3/add-deployment-definitions` worktree. No cloud resource was created,
changed or deployed. No Vercel CLI, push or PR was used. The shared
`apps/platform/lib` directory and migrations were not edited.

## Commands and results

Commands ran from the repository root with Node v22.23.2, pnpm 11.13.1 and
Docker Compose v2.40.3. External source research read the official Next.js
example and licence at the revision in `THIRD_PARTY_NOTICES.md`, the Vercel
REST documentation/schema and Kamal documentation. No authenticated provider
API request was made. Every Vercel apply test used mocked fetch.

| Exact command | Result |
| --- | --- |
| `node -v` | v22.23.2 |
| `pnpm -v` | 11.13.1 |
| `pnpm install --frozen-lockfile` | Passed, lockfile unchanged |
| `pnpm turbo typecheck lint test` | Passed, 63 of 63 tasks; platform 61 files, 400 tests |
| `taskset -c 0-3 pnpm turbo typecheck lint test` | Final pass, 63 of 63 tasks; 400 platform tests; limits worker contention without changing timeouts |
| `pnpm turbo build --filter=@opentenant/platform` | Passed, standalone production output |
| `pnpm --filter @opentenant/ci typecheck` | Passed |
| `pnpm quality:matrix` | Passed, 21 workspaces, 63 quality tasks, zero builds |
| `node --test tooling/ci/vercel-preview.test.mjs` | Passed, six tests |
| `pnpm exec eslint scripts/smoke-deploy.mjs tooling/ci/vercel-preview.mjs tooling/ci/vercel-preview.test.mjs tooling/ci/migrate-deploy.mjs` | Passed |
| `node --check scripts/smoke-deploy.mjs` | Passed |
| `node tooling/ci/vercel-preview.mjs domain-add --dry-run --domain '*.example.test'` | Passed, no network request |
| `pnpm --filter @opentenant/platform exec vitest run lib/tenant.test.ts` | Passed, six tests |
| `git diff --check` | Passed |
| `git diff --cached --check` | Passed |
| `gitleaks dir . --redact --no-banner --report-format json --report-path /tmp/opentenant-deployment-gitleaks.json` | Initial source scan passed; a later scan was stopped while walking generated standalone output |
| `git diff --cached --no-ext-diff \| gitleaks stdin --redact --no-banner --report-format json --report-path /tmp/opentenant-deployment-gitleaks-diff.json` | Final staged changes passed, no secrets found |
| `semgrep scan --config p/ci --metrics off --jobs 1 --exclude node_modules --exclude graphify-out --exclude .agents --json --output /tmp/opentenant-deployment-semgrep-serial.json .` | Completed, eight existing policy findings; none in deployment changes |
| `trivy fs --scanners vuln,misconfig,secret --skip-dirs node_modules,graphify-out,.agents --format json --output /tmp/opentenant-deployment-trivy.json .` | Two existing medium minimatch advisories; no secrets or Dockerfile misconfiguration |
| `ripwire . --quality-delta` | No gating regression; new helper complexity and existing workflow size remain descriptive findings |
| `ripwire . --edit-check=runVercel` | New symbol, no incompatible callers found |
| `ripwire . --test-gate=tooling/ci/vercel-preview.mjs` | Exit 4, names the executed partner test but cannot infer its run command; zero untested impacted symbols |
| `graphify update .` | AST graph refreshed; optional SQL parser unavailable; nine inherited nodes lack source-file fields |
| `graphify check-update .` | Passed |

The platform build retains upstream warnings about Next's ESLint plugin
detection and webpack string-cache serialization. An initial CI-tooling
typecheck required `--allowImportingTsExtensions` because the deployment
adapter imports the canonical TypeScript migration runner under Node 22.

Several loaded full-test retries timed out while importing the tenant module;
follow-on assertions then used reset mocks. The focused tenant retest and
the subsequent full run passed without changing tenant code or test timeouts.
The final full run passed all 63 tasks.

Semgrep first rejected `--config auto --metrics off`. An explicit `p/ci`
configuration worked. A later parallel scan exhausted host io_uring memory;
the single-worker scan completed. Its existing findings concern Dependabot
cooldowns and pnpm supply-chain policy in the root and starter workspaces.
Trivy reports CVE-2026-118764 in minimatch 9.0.9 and 10.2.5. This change does
not update dependencies. No pre-commit or Promptfoo configuration exists.

## Container smoke

`node scripts/smoke-deploy.mjs` first exercised the legacy builder on ports
3300 and 55435. The first BuildKit attempt used 3301 and 55436. Both built
their images but found that non-root migration could not read the host's
owner-only source permissions. Cleanup completed. The Dockerfile now sets
ownership on copied source and notices explicitly.

For faster local iteration, an official Docker Buildx v0.39.0 binary was
downloaded into `/tmp/opentenant-deployment-docker/cli-plugins/`. This temporary
Docker config contains no credentials and does not change the user's config.
The final verification command is:

```sh
DOCKER_CONFIG=/tmp/opentenant-deployment-docker SMOKE_APP_PORT=3303 SMOKE_POSTGRES_PORT=55438 node scripts/smoke-deploy.mjs
```

Smoke result: passed. Output summary:

```text
Smoke health: /api/health 200; migration completed before app startup; non-root image user verified.
Smoke tenant hosts: verified tenant.localhost 200; unknown.example.test and unknown.localhost 404; no tenant branding leaked.
Smoke migration: second run succeeded with the canonical checksum/lock runner.
Smoke PASS: local deployment only; no cloud calls or provider credentials.
Smoke cleanup: containers, network, database volume and tagged images removed.
```

The smoke creates a uniquely named Compose project and image tags, verifies the
non-root image user, waits for successful migration and app health, registers
one synthetic verified `tenant.localhost` fixture and checks unknown-host
denial. It re-executes the canonical migration runner to verify an unchanged
catalog. It then removes its containers, network, database volume and image
tags. Shared Docker build caches and unrelated containers are preserved.

Vercel and Kamal have configuration and local/mock evidence only. Neither
hosted path was deployed or verified. `/api/health` remains liveness only.

Marketing impact: truth.
