# Wave 2 observability and rate-limit verification

Branch: `t3/observability-rate-limits`. Marketing impact: truth.
Runtime: Node 22.23.2, pnpm 11.13.1. Local synthetic data only. No push, PR,
cloud operation, provider call, collector export or Sentry event was performed.
Only npm-registry package downloads, metadata and audit requests were allowed.

## Delivered behavior

- `instrumentation.ts` opts into OTLP only with `OPENTENANT_OTLP_ENDPOINT`.
  Vercel uses `@vercel/otel`; other Node deployments use the Node SDK. pg
  instrumentation covers transactions; identity validation and the module
  proxy have explicit spans. A strict exporter allowlist strips query text,
  URLs, headers, exceptions, resource metadata, links and tenant/user IDs.
- One pino logger factory accepts a fixed event vocabulary and numeric fields,
  injects the active trace ID and drops arbitrary messages/objects. Telemetry
  now uses this factory and does not log client-supplied values. An AST test
  rejects `console` access in authored platform server source. The generated,
  gitignored Workflow SDK endpoints are excluded.
- Both Next error boundaries render generic text. Optional server error capture
  uses the MIT Sentry SDK and any valid Sentry-protocol DSN, including a
  self-hosted reverse-proxy path. Default integrations, breadcrumbs, SDK logs,
  PII and Sentry tracing are disabled. SDK 11 uses explicit per-category
  `dataCollection` controls and drops logs in `beforeSendLog`; the requested
  legacy `sendDefaultPii` flag remains explicitly false. Only a fixed error message and event
  ID/time survive scrubbing. Client-only exception reporting is not enabled.
- PostgreSQL-backed limits share the control-plane database through a separate
  maximum-one-connection pool, independent of the app's five connections. Keys
  hash verified tenant/user/route-class scope. Installation controls aggregate
  under a server-owned installation scope. Passcode/proxy traffic also uses a
  stricter ingress-IP budget. Without a configured trusted proxy header it
  shares the strict unattributed bucket. Exhaustion gives 429 and Retry-After;
  store errors give a secret-free 503. There is no memory fallback or runtime DDL.
- Migration 0050 installs the store schema. 0051 is unused. The model-routing
  migration test now applies only migrations preceding its target, so future
  migrations do not make its upgrade fixture fail as out-of-order.
- `docs/runbooks/slo.md` defines proposed availability/readiness/p95 objectives,
  bounded trace indicators, generic example alerts and deployment limitations.
- Platform raw `process.env` access is an ESLint warning: 17 occurrences remain,
  including Next's compile-time runtime selectors and files owned by other
  agents. This is not the ECS zero-ad-hoc-env-read criterion.

## Dependency and reuse review

New dependencies use exact versions in their package manifests. OpenTelemetry
API is pinned across adapters to 1.9.1; Node SDK/exporter 0.223.1, pg
instrumentation 0.76.0 and trace-base 2.12.1 use the compatible SDK line.
`@vercel/otel` is 2.3.0, pino 10.4.0, `@sentry/nextjs` 11.12.0 and
rate-limiter-flexible 11.4.1. SDK packages are external in Next so pg's runtime
module remains patchable. No provider-specific application contract was added.

The initial production audit exposed a high Vite advisory through Sentry's
Cloudflare optional peer. Pinning Vite 7.3.7 fixes it. The final audit has
zero high and zero critical findings, with one moderate remaining. The
protobufjs postinstall only prints version-scheme advice; it is explicitly
not executed. The lockfile is committed. The adapted Postgres store schema
has its ISC copyright, source URL and exact commit in THIRD_PARTY_NOTICES.md.

## Tests added

44 new tests: 40 run in the ordinary gate and four in the dedicated DB proofs.

- Startup adapter selection and disabled-by-default behavior, including edge.
- Logger allowlisting, arbitrary-value rejection and active trace correlation.
- Trace/PII scrubbing and execution with no collector; invalid collector URLs.
- Real pg BEGIN/query/COMMIT spans with an in-memory exporter, never a collector.
- Generic React error markup and optional Sentry initialization/scrubbing.
- Route-class/key separation, Retry-After, fail-closed errors and ingress trust.
- A real member-route 429 before reading its body.
- A real PostgreSQL 40-attempt race with exactly five admissions, persistence
  across limiter instances, cross-tenant/user separation and window expiry.
- A production-entrypoint proof that 12 rotating users on one ingress IP share
  five admissions and seven 429 responses.

## Commands and evidence

The host was heavily loaded and exhausted swap. The first unconstrained build
was killed with exit 137. Some initial SDK pins were incompatible; the real pg
proof caught this and the pins were aligned. The full gate also caught SDK 11 option/event type changes; the adapter now
uses its supported collection and OpenTelemetry controls. A migration run hit two inherited
five-second hosted-test deadlines. Successful reruns use CPU affinity, bounded
workers and explicit migration-test deadlines. The build and typecheck were then serialized after a retry raced on Next
regenerating `.next/types`. The console-policy guard excludes only the SDK
Workflow output directory generated during builds. No assertion was removed.
The initial required command `pnpm turbo typecheck lint test --force` failed
on the incompatible pg instrumentation before the pins were corrected.

Exact final commands run from the repository root:

```sh
taskset -c 0,1 env NODE_OPTIONS=--max-old-space-size=2048 pnpm install --offline --frozen-lockfile --child-concurrency 1
pnpm audit --prod --audit-level high

taskset -c 0-5 env VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm turbo typecheck lint test --force --concurrency=4

taskset -c 6,7 env NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1 WORKFLOW_DISABLE_TELEMETRY=1 pnpm turbo build --filter=@opentenant/platform

taskset -c 0,1 env OBSERVABILITY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_it_observability_migrations VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 pnpm --filter @opentenant/observability test

taskset -c 2,3 env RATE_LIMIT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_it_rate_limit VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 pnpm --filter @opentenant/platform exec vitest run lib/rate-limit.integration.test.ts

taskset -c 0,1 env CONTROL_PLANE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_it_observability_migrations TENANT_CORE_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_it_observability_core TENANT_SUPPORT_INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_it_observability_support VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 pnpm --filter @opentenant/migrations test --testTimeout=30000 --hookTimeout=30000

git diff --check
```

| Gate | Result |
| --- | --- |
| Frozen offline install | PASS |
| Production audit | PASS, 0 high, 0 critical, 1 moderate |
| Workspace typecheck/lint/test | PASS, 63/63 uncached tasks; 1,567 Vitest + 137 Node tests |
| Platform build | PASS, 1/1 task, 27 static pages |
| Observability including real pg tracing | PASS, 33 tests, 5 files, no skips |
| Real rate-limit DB proofs | PASS, 3 tests, no skips |
| Full canonical migration proofs | PASS, 148 tests, 21 files, no skips |
| Restricted-role RLS regression | PASS, 314 checks across 31 tenant tables |
| Whitespace | PASS |

The task container used `pgvector/pgvector:0.8.2-pg17-bookworm`, unique name
`opentenant-obs-wave2-56ace715-55441`, and `127.0.0.1:55441:5432`. It was
created with synthetic CI credentials and removed after the DB proofs. A second
container, `opentenant-obs-wave2-final-56ace715-55441`, used the same approved
image and port for the final RLS regression and was also removed.

## Bounded local scans

Gitleaks scanned a snapshot of tracked and untracked non-ignored source with
repository-relative paths and `.gitleaks.toml`: zero leaks. Semgrep used five
local rules with metrics/version checks disabled: zero findings, including
new logger, capture and rate-limit source. Four inherited partial-parser
warnings remain in Assessment/Support files. The vendored `.agents` tooling
was excluded from the final application scan. Trivy used its cached DB with
updates and network checks disabled: zero high/critical vulnerabilities.
These scoped scans do not establish a full security verdict.

Ripwire quality delta reported zero gating findings. It flags the added route
branches and framework error-boundary duplication as minor/new-symbol shapes.
The qualified currentSession contract check found 16 callers and zero
incompatible calls. Graphify was refreshed with AST extraction only; missing
SQL parser and semantic-node metadata warnings remain. No pre-commit or
Promptfoo configuration exists.

Local logs and JSON evidence are under `/tmp/ot-wave2-proof` and
`/tmp/ot-wave2-*.log`.

## Route inventory

```text
Rate-limit wiring:
POST /api/settings/branding
POST /api/settings/navigation
POST /api/settings/module-access
POST /api/settings/members
POST /api/settings/identity-portal
POST /api/settings/routine-configuration
POST /api/settings/connections/[provider]/start
POST /api/settings/connections/[provider]/disconnect
GET /api/settings/connections/[provider]/callback (OAuth mutation)
POST /api/support/tickets
POST /api/admin/brand-proposals (both upload and action paths)
POST /api/admin/support-policy
POST /api/admin/support-sessions
POST /api/admin/support-sessions/exit
POST /api/module-access/assessment
POST /m/[module]/[[...path]] (GET is traced; page/asset reads do not spend mutation budget)

Not wired:
POST /api/admin/tenants (lifecycle ownership; exported tenant-creation policy ready)
POST /api/workflows/heartbeat (explicitly excluded workflow spike)
POST /api/assessment-readout (existing admission store; outside target mutations)
POST /api/telemetry (existing admission store; logging changed only)
POST /api/mcp/brain (read-only MCP POST; outside target mutations)
POST /api/module-broker/[module]/support/tickets (reads summaries only; outside mutation scope)
POST /auth/logout (identity logout; outside target scope)
```

## Merge wiring reserved for other owners

Tenant resolution: import `traceSpan` from `@opentenant/observability` or its
`/tracing` subpath, then wrap the tenant resolver callback with
`traceSpan("tenant.resolve", callback)`. This branch leaves `lib/tenant.ts`
and `middleware.ts` unchanged.

Tenant creation: after the verified installation-owner gate in
`app/api/admin/tenants/route.ts`, before any provisioning/provider operation:

```ts
const limited = await enforceRateLimit(req, {
  tenantId: "installation",
  userId: gate.context.authority.userId,
  routeClass: "tenant-creation",
});
if (limited) return limited;
```

Import `enforceRateLimit` from `lib/rate-limit`. The server-owned installation
scope prevents submitted tenant IDs from splitting the owner's budget. The
limiter grants five attempts per 60 seconds and fails closed if the store is
unavailable. Apply migration 0050 first. No migration 0051 was used.

## Exact local scan commands

The source snapshot contains tracked and untracked non-ignored files, preserving
repository-relative paths. No installed SDK or generated Next output was copied.

```sh
python3 /tmp/ot-wave2-snapshot.py
cd /tmp/ot-wave2-proof/source
taskset -c 8 gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json --report-path /tmp/ot-wave2-proof/gitleaks.json

taskset -c 8 env SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 SEMGREP_APP_TOKEN= semgrep scan --jobs 1 --timeout 30 --max-memory 500 --config /tmp/opentenant-semgrep.yaml --metrics off --disable-version-check --exclude .agents --exclude node_modules --exclude graphify-out --exclude '*.test.ts' --exclude '*.test.tsx' --exclude apps/platform/.next --error --json --output /tmp/ot-wave2-proof/semgrep.json .

# From the repository root:
taskset -c 3 env TRIVY_SKIP_VERSION_CHECK=true trivy fs --offline-scan --skip-db-update --skip-java-db-update --skip-check-update --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs .git --skip-dirs apps/platform/.next --format json --output /tmp/ot-wave2-proof/trivy.json .

taskset -c 9 ripwire . --quality-delta --legend=compact
taskset -c 0 ripwire . --edit-check=apps/platform/lib/session.ts:currentSession --legend=compact
taskset -c 9 graphify update .
```

## Final RLS regression

```sh
docker run -d --name opentenant-obs-wave2-final-56ace715-55441 -p 127.0.0.1:55441:5432 -e POSTGRES_DB=opentenant_ci -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres --health-cmd 'pg_isready -U postgres -d opentenant_ci' --health-interval 2s --health-timeout 3s --health-retries 20 pgvector/pgvector:0.8.2-pg17-bookworm
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/opentenant_ci taskset -c 8,9 node tooling/ci/rls-proof.mjs
docker rm -f opentenant-obs-wave2-final-56ace715-55441
```

PASS: all 314 RLS checks across 31 tenant tables. Cleanup ran through an EXIT
trap, including on a failed proof. No other container or port was used.
