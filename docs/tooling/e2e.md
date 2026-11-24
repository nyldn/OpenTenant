# Browser end-to-end tests

## Current collection and evidence, 2026-11-17

Commit `d818389` records `pnpm e2e --list` collecting legacy 16, Better Auth
journeys 41, reset 24 and audit 702 cases. The built production phase lists six
cases separately; it runs only through
`node tooling/e2e/production/run.mjs --build`, not the dev runner. Its dedicated
CI job builds and measures sequentially. Listing starts no stack and is not
an execution receipt for all collected cases.

[V3](../reviews/2026-11-17-wave6-v3.md) records 6/6 production tests passing
frozen no-regression limits. Assessment still misses the product LCP/CLS targets,
and UAT-015 remains open. The historical B0 702-cell run allowed existing
accessibility defects; it is not a wave-7 UAT pass. Current wave-7 UAT pass rate
and ECS are **PENDING integrator receipts**. Older eleven/nineteen-case summaries
below describe their earlier revisions. See the
[E11 receipt ledger](../plans/2026-11-17-e11-reconciliation.md).
GitHub Actions is billing-blocked, so configured jobs have no hosted receipt
for these waves. KVM CI remains gated by OWNER-KVM-CI-01. Marketing impact: none.

`tooling/e2e` uses Playwright Test and Chromium against the real platform,
canonical migrations, and synthetic local data. No identity, database, model,
or deployment provider account is needed.

Use Node 22 and pnpm 11.13.1. Install dependencies with
`pnpm install --frozen-lockfile`. Provision the local prerequisites once:

```sh
docker pull pgvector/pgvector:0.8.2-pg17-bookworm@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966
docker tag pgvector/pgvector:0.8.2-pg17-bookworm@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966 pgvector/pgvector:0.8.2-pg17-bookworm
docker pull axllent/mailpit:v1.27.8@sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707
pnpm --filter @opentenant/e2e exec playwright install --with-deps chromium
```

These installation commands download public dependencies. With a populated
package store, Docker image cache, browser cache, and system libraries, runs
need no external services:

```sh
pnpm install --offline --frozen-lockfile --trust-lockfile
pnpm e2e
pnpm e2e --grep 'settings'
```

`--trust-lockfile` prevents pnpm 11 from rechecking registry metadata during
an offline install of this reviewed lockfile.

The runner selects free loopback ports for Postgres, Next, the DNS control,
and the HTTPS stub.
`E2E_POSTGRES_PORT=55433 pnpm e2e` pins the database port if it is free.
Port 5432 is rejected. Each run names its container and databases uniquely.
Playwright global setup starts `pgvector/pgvector:0.8.2-pg17-bookworm` with
`--pull=never`. It creates one control-plane and four separate tenant databases,
runs `pnpm local:migrate`, applies the canonical tenant-core and tenant-support
catalogs through the existing migration runner, and seeds `tenant_e2e`,
`user_e2e`, and `admin@example.test`. It also seeds active `alpha`,
`beta`, and `hostile` tenants with verified `*.example.test` platform domains,
separate encrypted database connections and support entitlements. Alpha and beta
use `#123456` and `#abcdef`; hostile colors and fonts contain CSS/HTML injection
attempts. Each extra tenant has its own synthetic owner session token and a
host-only browser cookie. Chromium maps only the named synthetic hosts to
loopback. No development tenant-override cookie is used for these hosts.
Support uses a restricted login role with forced RLS and an encrypted local
connection record. The record's legacy `neon` provider label is metadata only;
all SQL goes to the isolated loopback Postgres server.

Playwright's `webServer` owns `next dev`. Its static-asset readiness check does
not access the database before global setup. Setup then waits for the local auth
redirect chain to compile before browser clicks, avoiding a cold Next dev reload
during sign-in. Local identity explicitly refuses
production mode, so the legacy phase cannot use `next start`. The separate
production helper uses real Better Auth sessions and the built app. The dev suite authenticates
through the real sign-in link and tests real sign-out forms. The launcher asserts
the verified `https://workspace.example.test` link without navigating externally.

The proxy upstream is a tiny local HTTPS server with a fresh self-signed
certificate. A test-only Undici connector maps exactly `module.example.test` to
its loopback port and trusts that certificate. This keeps the production module
URL policy intact. Other external fetches fail closed, browser routes block
external requests, host credentials are excluded from child environments, and
Next/Turbo telemetry is disabled. The connector is loaded only by the test app
process. Host DNS configuration stays unchanged.

The launcher sets `OPENTENANT_E2E=1`. In that mode the Next webpack composition
replaces only the domain POST entry with its DNS stub in `tooling/e2e`.
The runner configures four `LOCAL_USERS` accounts. The normal local gateway
and `lib/session.ts` validate their distinct tenant-bound tokens. Both `next.config.ts` and `lib/server-config.ts` reject any defined
`OPENTENANT_E2E` value when `NODE_ENV=production`; unit tests cover build and
runtime rejection. Ordinary development and production use their existing
identity and DNS composition.

The test domain entry calls `domainMutation(stubResolveTxt)`. It restores the
allowlisted synthetic Host in Next dev's absolute request URL before the real
same-origin check. The resolver reads a run-owned in-memory TXT map through a
separate loopback server at `http://127.0.0.1:$E2E_DNS_PORT/__e2e/dns`.
`POST` replaces `{ record, records }`; `GET ?record=...` returns an answer or an
empty array. Controls reject browser Origin headers, non-loopback Host headers,
invalid payloads and oversized bodies. The production app has no control route.
No browser response interception supplies a verification result. The browser
case checks real persisted challenge hashes, activation and tenant-scoped audit
rows, then proves removal stops routing. No public DNS or hosting API is called.

Global teardown stops the HTTPS stub and closes setup database pools. The test
app process closes the DNS control on exit. After Playwright stops the app, the outer runner removes the container and its
volumes, including on setup failure or interruption, and deletes temporary
certificates and keys. SIGKILL or a host crash cannot run
cleanup; remove a stranded `opentenant-e2e-*` container manually with
`docker rm --force --volumes <name>`.

CI uses its Postgres 17 service at loopback port 55433, selected with
`E2E_USE_POSTGRES_SERVICE=1`, `E2E_POSTGRES_PORT=55433`, and
`E2E_SERVICE_PASSWORD`. Setup creates uniquely named databases and the outer runner drops
only those databases and the run's role. GitHub owns service-container cleanup.
The job caches Chromium and uploads failure traces and the HTML report for seven
days. Local failure artifacts stay in ignored `tooling/e2e/test-results` and
`tooling/e2e/playwright-report`. Traces contain synthetic session cookies; treat
them as test credentials. Open a report with
`pnpm --filter @opentenant/e2e exec playwright show-report`.

All 11 local-identity browser cases are active, with no skips or fixmes. The specs cover
unknown-host rejection with an authenticated browser, local
sign-in/out, tenant home and launcher, admin branding/members settings, support
list/create, and module sandbox CSP and cookie stripping. The proxy cache-policy
case asserts `private, no-store` as the R11-06 regression. Custom-domain coverage
adds pending/failed DNS, activation, canonical sign-in redirection and removal.
Theming coverage checks inherited tokens on home, domain settings and support
for alpha and beta, plus hostile persisted CSS/HTML values. Earlier browser journeys in
`docs/reviews` are manual evidence, not runs of this suite.

The existing quality matrix stays build-free. This workspace supplies
`eslint .`, `tsc --noEmit`, and Node tests for port safety, environment
filtering and DNS control boundaries. Browser execution is a separate
`pnpm e2e` command and CI job.

The harness is original repository code using Playwright's configuration,
global setup/teardown, webServer, locator, and fixture APIs. No third-party
source was copied. Playwright and Undici are Apache-2.0 and MIT dependencies,
respectively.

The [2026-11-11 verification record](e2e-verification-2026-11-11.md) lists the
11 passing cases, earlier failed attempts, exact commands and scan limits.

For a stack that stays up for human or remote browser testing, use
[`pnpm uat:serve`](uat.md). It shares the production fixture bootstrap.

## Persona audit and fixture reset

`pnpm a11y:scan` runs 702 Better Auth persona × route/state × viewport cells
in eight bounded server batches with one worker. `--counts` also prints the
current counts by impact and rule. Every cell must execute exactly once.
New violations, increased impact/node counts and fixed but stale baseline
entries fail. Review and remove fixed entries in
`tooling/e2e/audit/baseline.json`; the scanner cannot overwrite it. See the
[versioned scan and fixture contract](../../tooling/e2e/audit/README.md) for the
exact inventory delta from the scratch run and exported page-spec helpers.
The separate CI job uploads sanitized matrix/comparison/timing JSON only.
Private manifests, logs, mail, cookies and traces must not be uploaded there.

Mailpit is a standard uniquely named, digest-pinned loopback fixture in both
legacy/journey E2E and UAT. Setup requires a healthy HTTP API and message
read-back. Specs can use `MAILPIT_HTTP_URL` in the normal runner or
`mailMessages`/`mailMessage` with a UAT manifest. Cleanup removes the exact
run-owned container even on failure. Real identity hooks send invitation mail;
Support durable delivery now has separate database and browser receipts in the
[E11 ledger](../plans/2026-11-17-e11-reconciliation.md).

`pnpm e2e` runs legacy, Better Auth journeys, standalone reset verification and
the complete `pnpm a11y:scan` accessibility comparison. In CI the dedicated
`a11y-ratchet` job owns the full audit; the existing E2E job owns the first
three phases to retain its time budget. All new specs have explicit phases;
unregistered specs fail with an instruction to select a phase in `audit/phases.mjs`.
`uat-reset.spec.ts` owns its standalone service and proves restoration plus a
fresh restart. For manual BrowserOS work use `pnpm uat:start`, `uat:status`,
`uat:reset` and `uat:down` as described in the [UAT guide](uat.md#browseros-runbook).
The tmux service expires after eight hours. Since 2026-11-17 the persona
baseline holds zero violations across 702 cells. Any new violation fails.
Q1 still
requires all manual journeys passing, and the hosted CI receipt is pending
because Actions is billing-blocked.

Run platform builds and Turbo quality checks separately from live E2E/UAT
servers. Cached Turbo build outputs include `.next`; restoring them during a
browser run can overwrite the dev compiler output.

The [B0 verification record](../../tooling/e2e/audit/verification-2026-11-16.md)
records baseline counts, failed attempts, batch measurements and cleanup proof.
