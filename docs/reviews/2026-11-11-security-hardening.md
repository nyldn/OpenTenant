# Local security hardening evidence

Scope: the eight verified static-review findings on `t3/harden-security-batch`.
Node 22.23.2 and pnpm 11.13.1. All identity-provider calls in tests use mocks.
No Docker Compose, hosted resources, push or pull request was used.
Marketing impact: none.

## Findings and decisions

1. Updated both Next manifests and the matching root ESLint plugin to 15.5.29,
   the latest 15.5 release returned by the npm registry during this run.
   Updated existing overrides and added same-major transitive patches. Kept
   Workflow on 4.8.0 and Clerk on 7.6.4 to avoid unrelated major migrations.
   Updated both the workspace and copy-out template lockfiles and notices.
2. Replaced the module response denylist with five content-metadata headers
   and a separately validated relative Location. Canonical redirects must stay
   under `/m/<module>/`; external URLs, encoded separators, nested escapes,
   traversal and backslashes are dropped. Every handled response, including
   access-gate redirects and denials, has `private, no-store`. Upstream CDN and
   origin-wide browser policy headers cannot pass through. Mutating requests
   use the shared same-origin helper before any context is signed. The opaque
   sandbox remains in place.
3. SSO and directory-sync portals require a tenant owner or the existing
   platform-admin authority. Domain verification remains admin-accessible:
   this intent verifies a domain and does not grant the SSO/dsync setup intent.
   No provider-side configuration or behavior was tested externally.
4. Membership enumeration, identity mapping and removal use the advisory-lock
   client. Account creation respects the enclosing transaction, so it cannot
   issue a nested COMMIT that releases the lock or obtain another pool client.
5. Invite-attempt audit evidence commits before the provider call, following
   the identity-portal convention. Audit failure prevents issuance. Provider,
   mapping or completion-audit failures return a normalized form error. If the
   provider succeeded before a later failure, the attempt remains auditable;
   the UI asks the operator to check the members list before retrying.
6. Production requires `MODULE_ACCESS_SECRET` for passcode grants and
   `CONNECTIONS_STATE_SECRET` for OAuth state. Development retains the previous
   fallbacks. Only an empty variable name was added to `.env.example`.
7. Platform response configuration adds `frame-ancestors 'self'` and
   `X-Frame-Options: SAMEORIGIN`. The proxy combines frame protection with its
   own sandbox CSP rather than replacing the sandbox.
8. The development tenant selector returns 404 in production. Preview suffixes
   match only the exact configured host or dot-delimited subdomains. Raw
   localhost matching also has a hostname boundary.

## Audit counts

Counts are advisory records returned by `pnpm audit --prod --json`.

| Lockfile | Critical before/after | High before/after | Moderate before/after | Low before/after |
| --- | --- | --- | --- | --- |
| Workspace | 6 / 0 | 18 / 0 | 19 / 1 | 4 / 0 |
| Standalone template | 3 / 0 | 4 / 0 | 2 / 0 | 0 / 0 |

The remaining moderate advisory affects `minimatch` 9/10 through Workflow's
queue, Oclif and SWC CLI dependencies. Its patched range starts at 11.0.1.
An untested cross-major override of matching behavior is deferred; no high or
critical advisory remains. Raw `pnpm audit --prod` therefore still exits 1 in
the workspace, while `pnpm audit --prod --audit-level high` exits 0.

## Regression coverage

Added 61 cases across colocated Vitest suites and extended existing assertions:

- Module proxy metadata allowlist, browser-policy stripping, private caching,
  same-origin mutation rejection before signing, legitimate forms, unsafe and
  module-local redirects, sandbox/framing coexistence and gate redirects.
- Portal owner/admin role checks and preserved domain-verification access.
- Lock-client propagation, five simultaneous same-tenant mutations with a
  five-client pool, WorkOS/Clerk store binding, and new-user mapping without
  nested checkout, commit, rollback or release.
- Audit-before-invite ordering, audit failure before issuance, normalized
  provider failures, durable attempts after completion-audit failure, and
  escaped/normalized form error rendering.
- Missing/empty dedicated production keys and preserved development fallbacks.
- Platform framing configuration and production/development host boundaries.

The initial test-first runs produced 37 failing/44 passing platform cases,
then 1 failing/3 passing page/composition cases and 2 failing/10 passing store
cases before their corresponding fixes. A subsequent fixture-order assertion
failure was corrected by applying the shared reset hook to the added tests.
An intermediate typecheck exposed two errors, both corrected before the full
gates passed.

## Verification

Final successful commands, run from the repository root unless stated:

```sh
TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm turbo typecheck lint test
NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm --filter @opentenant/platform build
NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 pnpm --filter @opentenant/tenant-module-nextjs-template build
pnpm install --frozen-lockfile --ignore-scripts --offline
pnpm --filter @opentenant/platform exec vitest run 'app/m' app/api/settings/members app/api/settings/identity-portal lib/member-mutation-lock.test.ts lib/module-access.test.ts lib/connections-secret.test.ts lib/identity-client.test.ts app/dev/tenant next.config.test.ts app/settings/members/page.test.tsx
pnpm --filter @opentenant/database exec vitest run src/control-plane-stores.test.ts
pnpm audit --prod --audit-level high
pnpm --dir templates/tenant-module-nextjs audit --prod --json
git diff --check
```

- Full quality run: 63/63 tasks successful, 1,492 Vitest and 137 Node TAP tests
  passed, zero failed. Platform: 400 tests. Eighteen database integration
  suite files skipped because isolated database test URLs were not supplied.
- Focused platform run: 90/90 cases across ten files. Store run: 12/12 cases.
- Platform production build: passed, Next 15.5.29, 27/27 static pages. Existing
  ESLint-plugin detection and Webpack cache-size warnings remain non-blocking.
- Standalone template build: passed, 4/4 generated pages. Offline frozen
  workspace install passed without changing the lockfile.
- No database integration or provider-production evidence is claimed.

## Local security and graph checks

```sh
SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 DO_NOT_TRACK=1 semgrep scan --config /tmp/opentenant-semgrep.yaml --metrics off --disable-version-check --exclude node_modules --exclude graphify-out --exclude '*.test.ts' --exclude '*.test.tsx' --exclude apps/platform/.next --json --output /tmp/opentenant-semgrep.json .
TRIVY_SKIP_VERSION_CHECK=true trivy fs --offline-scan --skip-db-update --skip-java-db-update --skip-check-update --scanners vuln --severity HIGH,CRITICAL --skip-dirs node_modules --skip-dirs .git --skip-dirs apps/platform/.next --format json --output /tmp/opentenant-trivy.json .
graphify update .
graphify check-update .
ripwire . --quality-delta --legend=compact
ripwire . --edit-check=withTenantMemberMutationLock
ripwire . --test-gate
```

Semgrep used five local rules, with telemetry and version checks disabled:
JavaScript/TypeScript dynamic code execution, disabled TLS verification,
credential-object logging, shell-enabled subprocesses, and module sandbox
same-origin bypass. It scanned 386 production files and found zero issues.
This bounded rule set is not a complete application security audit.

Trivy used the cached database from November 9 with updates disabled and found
zero high/critical vulnerabilities in either lockfile. The registry audit is
the fresher advisory source for this run.

Gitleaks scanned a temporary copy of every tracked and untracked, non-ignored
regular repository file with repository-relative paths. From that snapshot:

```sh
gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json --report-path /tmp/opentenant-gitleaks.json
```

Result: zero leaks. The first absolute-path snapshot invocation did not apply
the repository's anchored Assessment-storage-key allowlist and reported eleven
existing storage-key false positives; rerunning from the snapshot root applied
the existing configuration correctly. No values were printed.

Ripwire's quality delta had zero gating regressions. The lock helper's arity
was unchanged, with one caller and zero incompatible calls; TypeScript verifies
the intentionally widened callback contract. The heuristic test gate exits 4
and requests 40 affected tests while listing 113 name-based untested symbols,
including unrelated route handlers named POST. The full repository tests were
run; this static gate does not observe their execution or replace test results.

Graphify refreshed the local AST graph. It still warns about missing SQL
parser support and existing semantic nodes without source-file fields; no
semantic provider was invoked. No `.pre-commit-config.yaml` or Promptfoo
configuration exists, so those conditional checks do not apply.
