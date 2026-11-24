# UAT verification, 2026-11-14

All data, accounts and sessions were synthetic. Work started at `fcc6efc` on
`t3/uat-serve`. No push, PR, hosted resources or provider credentials were used.
Marketing impact: none.

Temporary commands ran in named `forge-job` units with a two-hour expiry.
No stack is retained for handoff. The live probes below are committed scripts
so another tester can reproduce the HTTP, browser and listener checks.

| Command | Result |
| --- | --- |
| `forge-job run opentenant-uat-final-dev -- pnpm uat:serve` | Started seven provisioned tenants, ten LOCAL_USERS personas, Postgres, Mailpit, worker and Next dev. |
| `node tooling/uat/probe.mjs` | curl with Host headers returned 200 for all seven tenant homes; all ten persona cookies were accepted; suspended API POST returned 423; Mailpit received seven owner invitations. |
| `ss -ltnH`, executed by the probe | Every recorded application, internal Next, Postgres, SMTP, Mailpit, DNS and module-stub port listened on 127.0.0.1. No wildcard or IPv6 binding. |
| `node tooling/uat/browser-proof.mjs` | Chromium proved persona sign-in, tenant-bound seeded Assessment and reload, five ticket states, member roles, tunnel-preserving launcher link and fresh tenant's empty support list. In Better Auth dev mode it also issued a real member invitation. |
| `node -e 'process.kill(require("./.uat/active/owner.json").pid,"SIGTERM")'` | The final default dev launcher stopped its child processes, removed both containers and the manifest. All seven recorded ports closed. |
| `pnpm uat:serve --start` | A built Next server started on loopback; all seven homes and ten signed Better Auth sessions passed the HTTP probe. Chromium passed seeded Assessment, reload, five ticket states and fresh empty state with Secure localhost cookies. |
| `pnpm uat:serve --better-auth` | The same dev stack and personas worked with real Better Auth cookies, including a member invitation through the platform route and Mailpit. |
| `pnpm uat:down` | Gracefully stopped running controllers with zero orphan removals. A separate bounded, network-disabled Alpine container with this worktree's UAT labels was then removed by label: exactly one orphan removed. |
| `pnpm turbo lint typecheck --concurrency=2` | 83/83 tasks passed. Platform production build passed as a required dependency. |
| `pnpm db:ephemeral -- pnpm turbo test --concurrency=2` | 54/54 tasks passed using the pinned pgvector image. Existing opt-in integration skips remain in the general test task; this is not a zero-skip integration claim. |
| `pnpm --filter @opentenant/auth test` | 157 tests passed, including explicit installation authority, no-membership users and per-persona permissions. |
| `pnpm --filter @opentenant/platform exec vitest run lib/server-config.test.ts lib/tenant-launcher.test.ts next.config.test.ts middleware.test.ts` | 57 tests passed, including production rejection of LOCAL_USERS and OPENTENANT_E2E and loopback link generation. |
| `pnpm --filter @opentenant/e2e test` | 9 Node tests passed, zero skips. Includes manifest/tunnel shape, idempotent teardown after failure, real child termination, host/origin boundaries and public-origin redirects. |
| `gitleaks dir . --config .gitleaks.toml --redact --no-banner` | Zero leaks in a temporary repository source snapshot, excluding generated graph output. Run from the snapshot root so repository-relative allowlists apply. |
| `env EIO_BACKEND=posix semgrep scan --config packages/auth-better-auth/semgrep.yml --disable-version-check --metrics=off --jobs=1 --error tooling/uat tooling/e2e tooling/db-ephemeral packages/auth/src/local apps/platform/lib/server-config.ts apps/platform/lib/tenant-launcher.ts apps/platform/app/admin/page.tsx apps/platform/middleware.ts` | Two local security rules, 54 files, zero findings. This is a scoped scan, not an exhaustive security audit. |
| `trivy fs --skip-db-update --offline-scan --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git --skip-dirs .uat .` | Zero high/critical dependency vulnerabilities against the cached database. |
| `graphify update .` | Updated the local graph using AST extraction. Generated graph files are excluded from the commit. |
| `git diff --check` and `git diff --cached --check` | Passed. |

There is no pre-commit or Promptfoo configuration in this repository. Ripwire
contract checks found no incompatible callers. Its quality check retains
history-based churn flags on the local parser and e2e setup; the parser's
complexity regression was removed by separating validation and parsing.

The first startup attempts exposed a workspace import, SMTP sender validation,
production readiness Host handling and a premature orphan cleanup fallback.
Those failures were corrected and the affected live checks repeated. The real
browser form test also exposed Next dev's internal localhost origin and
absolute redirects; the proxy now validates the public origin, adapts it for
Next and restores public redirect URLs. A regression test covers that behavior.
An initial Gitleaks snapshot scan reported existing storage-key false positives
because the snapshot's absolute prefix bypassed relative allowlists. Running
from the snapshot root passed without changing those allowlists.

See [the operating guide](uat.md) for limits: default LOCAL_USERS membership
mutations are unavailable, so use `--better-auth` for those journeys; built
production identity forms retain their HTTPS requirement. Hosted model/provider
paths remain unconfigured. The included [manifest example](uat-manifest.example.json)
contains fixed synthetic values and cannot authenticate to a running stack.
